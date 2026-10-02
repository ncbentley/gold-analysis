import { ArrowLeft, Layers } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LockedPanel } from "@/components/locked";
import { PageHeader } from "@/components/page-header";
import { DirectionBadge } from "@/components/signal-bits";
import { SignalList } from "@/components/signal-list";
import { fmtEntry, fmtPrice } from "@/lib/format";
import { can, lowestTierWith } from "@/server/entitlements/access";
import { getViewer } from "@/server/entitlements/service";
import { getIdeaForViewer } from "@/server/ideas/service";
import type { IdeaPhase } from "@/server/ideas/phase";
import { getRecentBars } from "@/server/market-data";

export const metadata: Metadata = { title: "Idea" };

const PHASE_LABEL: Record<IdeaPhase, string> = {
  available: "Available",
  "playing-out": "Playing out",
  history: "History",
};

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
  const { idea, items } = result;

  return (
    <>
      {back}
      <PageHeader
        size="sm"
        icon={Layers}
        title={
          <>
            {idea.direction === "LONG" ? "Long" : "Short"} · <span className="tabular-nums">{fmtEntry(idea.entryMin, idea.entryMax)}</span>
          </>
        }
        description={`${PHASE_LABEL[idea.phase]} · ${idea.sourceCount} source${idea.sourceCount === 1 ? "" : "s"} · stop ${fmtPrice(idea.stopLoss)} · targets ${idea.targets.length ? idea.targets.map((price) => fmtPrice(price)).join(", ") : "—"}`}
      >
        <div className="mt-3">
          <DirectionBadge direction={idea.direction} />
        </div>
      </PageHeader>
      <SignalList items={items} empty="None of the counting signals for this idea are still in the database." />
    </>
  );
}
