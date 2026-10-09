import { History } from "lucide-react";
import type { Metadata } from "next";
import { IdeaList } from "@/components/idea-list";
import { LockedPanel } from "@/components/locked";
import { PageHeader } from "@/components/page-header";
import { SignalList } from "@/components/signal-list";
import { nowMs } from "@/lib/clock";
import { can, lowestTierWith } from "@/server/entitlements/access";
import { getViewer } from "@/server/entitlements/service";
import { byNewest, goldBookCards } from "@/server/gold/sections";
import { annotateIdeaGlance } from "@/server/ideas/glance";
import { listIdeasForViewer } from "@/server/ideas/service";
import { getRecentBars } from "@/server/market-data";
import { listSignalsForViewer } from "@/server/signals/queries";

export const metadata: Metadata = { title: "History" };

export default async function HistoryPage() {
  const viewer = await getViewer();
  const { access, config, user } = viewer;
  const header = <PageHeader title="History" icon={History} description="Every trade that has left the live book, newest first." />;
  if (!can(access, "signals.core")) {
    return (
      <>
        {header}
        <LockedPanel feature="signals.core" requiredTier={lowestTierWith("signals.core", config)} title="History is available to members" userId={user?.id} />
      </>
    );
  }

  const now = nowMs();
  const [lastBar] = (await getRecentBars(1)).slice(-1);
  const spot = lastBar?.close ?? null;

  if (access.tier === "gold" && !access.isAdmin) {
    const history = byNewest((await goldBookCards(viewer, spot, now)).filter((card) => card.section === "history"));
    return (
      <>
        {header}
        <div className="mt-8">
          <IdeaList items={history} now={now} empty="No Gold ideas in your history yet." />
        </div>
      </>
    );
  }

  if (access.tier === "silver") {
    const history = await annotateIdeaGlance(
      byNewest((await listIdeasForViewer(viewer, spot)).filter((idea) => idea.phase === "history")),
      spot,
    );
    return (
      <>
        {header}
        <div className="mt-8">
          <IdeaList items={history} now={now} empty="No ideas in your history window yet." />
        </div>
      </>
    );
  }

  const closed = await listSignalsForViewer(viewer, { status: "CLOSED" }, { limit: 500, segment: true });
  return (
    <>
      {header}
      <div className="mt-8">
        <SignalList items={closed.items} now={now} empty="No closed signals in your history window yet." />
      </div>
    </>
  );
}
