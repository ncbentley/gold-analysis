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
import { cn } from "@/lib/utils";
import { can, lowestTierWith } from "@/server/entitlements/access";
import { getViewer } from "@/server/entitlements/service";
import { getIdeaForViewer } from "@/server/ideas/service";
import type { IdeaPhase } from "@/server/ideas/phase";
import { getEngineBars, getRecentBars } from "@/server/market-data";
import type { EngineOutcome } from "@/server/outcomes/engine";

export const metadata: Metadata = { title: "Idea" };

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

export default async function IdeaPage({ params }: PageProps<"/ideas/[id]">) {
  const { id } = await params;
  const viewer = await getViewer();
  if (!can(viewer.access, "signals.core")) {
    return (
      <>
        <PageHeader title="Idea" icon={Layers} description="Signals consolidated onto one entry." />
        <LockedPanel
          feature="signals.core"
          requiredTier={lowestTierWith("signals.core", viewer.config)}
          title="Signals are available to members"
          userId={viewer.user?.id}
        />
      </>
    );
  }
  const [lastBar] = (await getRecentBars(1)).slice(-1);
  const result = await getIdeaForViewer(id, viewer, lastBar?.close ?? null);
  if (result.kind === "not_found") notFound();
  const back = (
    <Link
      href="/dashboard"
      className="mb-3 inline-flex items-center gap-1.5 rounded-md text-sm font-medium text-muted-foreground outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring"
    >
      <ArrowLeft className="size-4" /> Dashboard
    </Link>
  );
  if (result.kind === "history_locked") {
    return (
      <>
        {back}
        <LockedPanel
          feature="sources.history.full"
          requiredTier={result.requiredTier}
          title="This idea is older than your plan’s history window"
          userId={viewer.user?.id}
        />
      </>
    );
  }
  const { idea, items, startedAt, outcome } = result;
  const startedMs = Date.parse(startedAt);
  const endMs = Math.min(nowMs(), (outcome.exitTime ?? nowMs()) + 90 * 60_000);
  const bars = await getEngineBars(new Date(startedMs - 120 * 60_000), new Date(endMs + 60_000));
  const levels = [
    { price: idea.entryMin, label: idea.entryMin === idea.entryMax ? "Entry" : "Zone", tone: "entry" as const },
    ...(idea.entryMin !== idea.entryMax ? [{ price: idea.entryMax, label: "Zone", tone: "entry" as const }] : []),
    ...(idea.stopLoss !== null ? [{ price: idea.stopLoss, label: "SL", tone: "stop" as const }] : []),
    ...idea.targets.map((price, index) => ({ price, label: `TP${index + 1}`, tone: "target" as const })),
  ];
  const markers = [
    { t: startedMs, label: "Call" },
    ...(outcome.entryTime ? [{ t: outcome.entryTime, label: "Fill" }] : []),
    ...outcome.targets.flatMap((target) => (target.hitAt ? [{ t: target.hitAt, label: `TP${target.index}` }] : [])),
    ...(outcome.stopHitAt ? [{ t: outcome.stopHitAt, label: "Stop" }] : []),
  ];

  return (
    <>
      {idea.phase !== "history" && <LiveRefresh />}
      {back}
      <PageHeader
        size="sm"
        icon={Layers}
        title={
          <>
            {idea.direction === "LONG" ? "Long" : "Short"} · <span className="tabular-nums">{fmtEntry(idea.entryMin, idea.entryMax)}</span>
          </>
        }
        description={`${PHASE_LABEL[idea.phase]} · ${tradeLine(outcome)} · ${idea.sourceCount} source${idea.sourceCount === 1 ? "" : "s"} · call ${fmtDateTime(startedAt)}`}
      >
        <div className="mt-3">
          <DirectionBadge direction={idea.direction} />
        </div>
      </PageHeader>
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Entry" value={<span className="font-mono text-base">{fmtEntry(idea.entryMin, idea.entryMax)}</span>} tone="gold" />
        <Stat label="Stop" value={<span className={cn("font-mono text-base", outcome.stopHitAt && "text-loss")}>{fmtPrice(idea.stopLoss)}</span>} tone="loss" />
        <Stat
          label="Targets"
          tone="win"
          value={
            <span className="flex flex-col font-mono text-sm">
              {idea.targets.length
                ? idea.targets.map((price, index) => (
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
      <SignalList items={items} empty="None of the counting signals for this idea are still in the database." />
    </>
  );
}
