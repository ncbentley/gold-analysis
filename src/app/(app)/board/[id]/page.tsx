import { ArrowLeft, Crosshair, Layers } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LiveRefresh } from "@/components/live-refresh";
import { LockedPanel } from "@/components/locked";
import { PageHeader } from "@/components/page-header";
import { downsample, PriceChart } from "@/components/price-chart";
import { DirectionBadge, Stat } from "@/components/signal-bits";
import { fmtDateTime, fmtEntry, fmtPrice } from "@/lib/format";
import { nowMs } from "@/lib/clock";
import { cn } from "@/lib/utils";
import { boardPick } from "@/server/board/service";
import { can, lowestTierWith } from "@/server/entitlements/access";
import { getViewer } from "@/server/entitlements/service";
import type { IdeaPhase } from "@/server/ideas/phase";
import { getEngineBars, getRecentBars } from "@/server/market-data";
import type { EngineOutcome } from "@/server/outcomes/engine";

export const metadata: Metadata = { title: "Board" };

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

export default async function BoardPickPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ pick?: string }>;
}) {
  const { id } = await params;
  const { pick: slot = "primary" } = await searchParams;
  const viewer = await getViewer();
  const allowed = viewer.access.isAdmin || viewer.access.tier === "platinum";
  if (!allowed || !can(viewer.access, "signals.core")) {
    return (
      <>
        <PageHeader title="Board" icon={Layers} description="The primary idea and its alternates." />
        <LockedPanel feature="signals.core" requiredTier={lowestTierWith("signals.core", viewer.config)} title="The board is a Platinum feature" userId={viewer.user?.id} />
      </>
    );
  }
  const [lastBar] = (await getRecentBars(1)).slice(-1);
  const result = await boardPick(id, slot, lastBar?.close ?? null);
  if (!result) notFound();
  const { pick, phase, outcome, ideas, startedAt } = result;
  const endMs = Math.min(nowMs(), (outcome.exitTime ?? nowMs()) + 90 * 60_000);
  const bars = await getEngineBars(new Date(startedAt - 120 * 60_000), new Date(endMs + 60_000));
  const levels = [
    { price: pick.entryMin, label: pick.entryMin === pick.entryMax ? "Entry" : "Zone", tone: "entry" as const },
    ...(pick.entryMin !== pick.entryMax ? [{ price: pick.entryMax, label: "Zone", tone: "entry" as const }] : []),
    ...(pick.stopLoss !== null ? [{ price: pick.stopLoss, label: "SL", tone: "stop" as const }] : []),
    ...pick.targets.map((price, index) => ({ price, label: `TP${index + 1}`, tone: "target" as const })),
  ];
  const markers = [
    { t: startedAt, label: "Call" },
    ...(outcome.entryTime ? [{ t: outcome.entryTime, label: "Fill" }] : []),
    ...outcome.targets.flatMap((target) => (target.hitAt ? [{ t: target.hitAt, label: `TP${target.index}` }] : [])),
    ...(outcome.stopHitAt ? [{ t: outcome.stopHitAt, label: "Stop" }] : []),
  ];

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
            {pick.direction === "LONG" ? "Long" : "Short"} · <span className="tabular-nums">{fmtEntry(pick.entryMin, pick.entryMax)}</span>
          </>
        }
        description={`${slot === "primary" ? "Primary" : `Alternate ${Number(slot) + 1}`} · ${PHASE_LABEL[phase]} · ${tradeLine(outcome)}`}
      >
        <div className="mt-3">
          <DirectionBadge direction={pick.direction} />
        </div>
      </PageHeader>
      <p className="mb-6 max-w-3xl text-sm leading-relaxed text-foreground/90">{pick.writeup}</p>
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Entry" value={<span className="font-mono text-base">{fmtEntry(pick.entryMin, pick.entryMax)}</span>} tone="gold" />
        <Stat label="Stop" value={<span className={cn("font-mono text-base", outcome.stopHitAt && "text-loss")}>{fmtPrice(pick.stopLoss)}</span>} tone="loss" />
        <Stat
          label="Targets"
          tone="win"
          value={
            <span className="flex flex-col font-mono text-sm">
              {pick.targets.length
                ? pick.targets.map((price, index) => (
                    <span key={index} className={cn(outcome.targets[index]?.hitAt && "text-win")}>
                      TP{index + 1} {fmtPrice(price)}
                    </span>
                  ))
                : "—"}
            </span>
          }
        />
        <Stat icon={Crosshair} label="Path" value={tradeLine(outcome)} hint={outcome.entryTime ? `Filled ${fmtDateTime(new Date(outcome.entryTime))}` : "Waiting for the entry to trade"} />
      </div>
      <div className="mb-8 rounded-xl bg-[#050c1c]/80 p-2 ring-1 ring-glow/25 shadow-[inset_0_0_30px_-12px_rgb(47_123_255/0.4)]">
        <PriceChart points={downsample(bars)} levels={levels} markers={markers} />
      </div>
      <section>
        <h2 className="mb-3 font-heading text-lg font-bold">Ideas behind this pick</h2>
        {ideas.length === 0 ? (
          <p className="text-sm text-muted-foreground">This pick does not cite a stored idea.</p>
        ) : (
          <ul className="space-y-2">
            {ideas.map((idea) => (
              <li key={idea.id}>
                <Link href={`/ideas/${idea.id}`} className="block rounded-xl px-4 py-3 ring-1 ring-glow/30 hover:ring-primary/55">
                  <span className="font-semibold">{idea.direction === "LONG" ? "Long" : "Short"}</span>
                  <span className="ml-2 font-mono tabular-nums">{fmtEntry(idea.entryMin, idea.entryMax)}</span>
                  <span className="ml-2 text-sm text-muted-foreground">
                    {idea.sourceCount} source{idea.sourceCount === 1 ? "" : "s"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
