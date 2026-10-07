import { eq } from "drizzle-orm";
import { ArrowLeft, Crosshair, Layers } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LiveRefresh } from "@/components/live-refresh";
import { LockedPanel } from "@/components/locked";
import { PageHeader } from "@/components/page-header";
import { downsample, PriceChart } from "@/components/price-chart";
import { DirectionBadge, Stat } from "@/components/signal-bits";
import { SignalList } from "@/components/signal-list";
import { fmtDateTime, fmtEntry, fmtPrice } from "@/lib/format";
import { nowMs } from "@/lib/clock";
import { tradeMarkers } from "@/lib/trade-markers";
import { cn } from "@/lib/utils";
import { currentBoard } from "@/server/board/service";
import { getDb } from "@/server/db";
import { consolidatedIdeas, goldBookEntries, type BoardPick } from "@/server/db/schema";
import { can, lowestTierWith } from "@/server/entitlements/access";
import { getViewer } from "@/server/entitlements/service";
import { goldSection } from "@/server/gold/close";
import type { IdeaPhase } from "@/server/ideas/phase";
import { replayIdea } from "@/server/ideas/replay";
import { getEngineBars, getRecentBars } from "@/server/market-data";
import type { EngineOutcome } from "@/server/outcomes/engine";
import { listSignalListItemsByIds } from "@/server/signals/queries";

export const metadata: Metadata = { title: "Gold idea" };

const PHASE_LABEL: Record<IdeaPhase, string> = {
  available: "Available",
  "playing-out": "Playing out",
  history: "History",
};

function tradeLine(outcome: EngineOutcome) {
  if (!outcome.entered) return "Not filled";
  const hits = outcome.targets.filter((target) => target.hitAt !== null).map((target) => `TP${target.index}`);
  if (outcome.stopHitAt) hits.push("stop");
  if (outcome.exitReason === "TARGETS") return "Targets complete";
  if (outcome.exitReason === "STOP") return hits.length ? `Stop hit after ${hits.filter((hit) => hit !== "stop").join(", ") || "the fill"}` : "Stop hit";
  if (!hits.length) return "Filled, still open";
  return `${hits.join(", ")} hit`;
}

function sameZone(pick: BoardPick, row: { direction: string; entryMin: number; entryMax: number; stopLoss: number | null; targets: number[] }) {
  return (
    pick.direction === row.direction &&
    pick.entryMin === row.entryMin &&
    pick.entryMax === row.entryMax &&
    pick.stopLoss === row.stopLoss &&
    pick.targets.join(",") === row.targets.join(",")
  );
}

export default async function GoldIdeaPage({ params }: PageProps<"/gold/[id]">) {
  const { id } = await params;
  const viewer = await getViewer();
  const allowed = viewer.access.isAdmin || viewer.access.tier === "gold";
  if (!allowed || !can(viewer.access, "signals.core")) {
    return (
      <>
        <PageHeader title="Gold idea" icon={Layers} description="A curated zone on the Gold book." />
        <LockedPanel feature="signals.core" requiredTier={lowestTierWith("signals.core", viewer.config)} title="The Gold book is a Gold feature" userId={viewer.user?.id} />
      </>
    );
  }
  const db = await getDb();
  const [row] = await db.select().from(goldBookEntries).where(eq(goldBookEntries.id, id));
  if (!row) notFound();
  const [lastBar] = (await getRecentBars(1)).slice(-1);
  const startedMs = row.createdAt.getTime();
  const played = replayIdea(
    {
      direction: row.direction,
      entryMin: row.entryMin,
      entryMax: row.entryMax,
      stopLoss: row.stopLoss,
      targets: row.targets,
      startedAt: startedMs,
    },
    await getEngineBars(new Date(startedMs), new Date(Date.now() + 60_000)),
    lastBar?.close ?? null,
    true,
  );
  const now = nowMs();
  const section = goldSection(
    {
      sectionAtCall: row.sectionAtCall,
      closeCalledAt: row.closeCalledAt ? row.closeCalledAt.getTime() : null,
      phase: played.phase,
      finished: played.outcome.entered && played.outcome.exitTime !== null && played.phase === "history",
    },
    now,
  );
  const phase: IdeaPhase = section === "active" ? "playing-out" : section;
  const outcome = played.outcome;
  const idea = row.ideaId ? (await db.select().from(consolidatedIdeas).where(eq(consolidatedIdeas.id, row.ideaId)))[0] : null;
  const items = idea ? await listSignalListItemsByIds(idea.signalIds, viewer) : [];
  const expired = !outcome.entered && items.length > 0 && items.every((item) => item.status === "EXPIRED" || item.status === "CANCELLED");
  const closedUnfilled = row.closeCalledAt !== null && !outcome.entered && !expired;
  const path = expired ? "Sources expired" : closedUnfilled ? "Closed" : tradeLine(outcome);
  const pathHint = expired
    ? "Every source expired before the entry traded"
    : closedUnfilled
      ? "Taken off before the entry traded"
      : outcome.entryTime
        ? `Filled ${fmtDateTime(new Date(outcome.entryTime))}`
        : "Waiting for the entry to trade";
  const board = await currentBoard(null);
  const writeup = board.post ? [board.post.primary, ...board.post.alternates].find((pick) => sameZone(pick, row) || (row.ideaId !== null && pick.ideaIds.length === 1 && pick.ideaIds[0] === row.ideaId))?.writeup : null;
  const endMs = Math.min(now, (outcome.exitTime ?? row.exitTime?.getTime() ?? now) + 90 * 60_000);
  const bars = await getEngineBars(new Date(startedMs - 120 * 60_000), new Date(endMs + 60_000));
  const levels = [
    { price: row.entryMin, label: row.entryMin === row.entryMax ? "Entry" : "Zone", tone: "entry" as const },
    ...(row.entryMin !== row.entryMax ? [{ price: row.entryMax, label: "Zone", tone: "entry" as const }] : []),
    ...(row.stopLoss !== null ? [{ price: row.stopLoss, label: "SL", tone: "stop" as const }] : []),
    ...row.targets.map((price, index) => ({ price, label: `TP${index + 1}`, tone: "target" as const })),
  ];
  const markers = tradeMarkers({
    calledAt: startedMs,
    timeline: outcome.timeline,
    goldClose: row.closeCalledAt ? { calledAt: row.closeCalledAt.getTime(), exitTime: row.exitTime ? row.exitTime.getTime() : null } : null,
  });
  const sources = idea?.sourceCount ?? 0;

  return (
    <>
      {phase !== "history" && <LiveRefresh />}
      <Link
        href="/dashboard"
        className="mb-3 inline-flex items-center gap-1.5 rounded-md text-sm font-medium text-muted-foreground outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft className="size-4" /> Dashboard
      </Link>
      <PageHeader
        size="sm"
        icon={Layers}
        title={
          <>
            {row.direction === "LONG" ? "Long" : "Short"} · <span className="tabular-nums">{fmtEntry(row.entryMin, row.entryMax)}</span>
          </>
        }
        description={`${PHASE_LABEL[phase]} · ${path} · ${sources === 0 ? "composed by the model" : `${sources} source${sources === 1 ? "" : "s"}`} · call ${fmtDateTime(row.createdAt)}`}
      >
        <div className="mt-3">
          <DirectionBadge direction={row.direction} />
        </div>
      </PageHeader>
      {writeup ? <p className="mb-6 max-w-3xl text-sm leading-relaxed text-foreground/90">{writeup}</p> : null}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Entry" value={<span className="font-mono text-base">{fmtEntry(row.entryMin, row.entryMax)}</span>} tone="gold" />
        <Stat label="Stop" value={<span className={cn("font-mono text-base", outcome.stopHitAt && "text-loss")}>{fmtPrice(row.stopLoss)}</span>} tone="loss" />
        <Stat
          label="Targets"
          tone="win"
          value={
            <span className="flex flex-col font-mono text-sm">
              {row.targets.length
                ? row.targets.map((price, index) => (
                    <span key={index} className={cn(outcome.targets[index]?.hitAt && "text-win")}>
                      TP{index + 1} {fmtPrice(price)}
                    </span>
                  ))
                : "—"}
            </span>
          }
        />
        <Stat icon={Crosshair} label="Path" value={path} hint={pathHint} />
      </div>
      <div className="mb-8 rounded-xl bg-[#050c1c]/80 p-2 ring-1 ring-glow/25 shadow-[inset_0_0_30px_-12px_rgb(47_123_255/0.4)]">
        <PriceChart points={downsample(bars)} levels={levels} markers={markers} />
      </div>
      {items.length ? (
        <SignalList items={items} empty="None of the counting signals for this idea are still in the database." />
      ) : (
        <p className="text-sm text-muted-foreground">The model composed this zone. It does not copy a silver idea.</p>
      )}
    </>
  );
}
