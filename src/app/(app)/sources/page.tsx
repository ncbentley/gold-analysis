import { ChartCandlestick, Scale, Trophy } from "lucide-react";
import type { Metadata } from "next";
import { LockedPanel } from "@/components/locked";
import { PageHeader } from "@/components/page-header";
import { TopSources } from "@/components/top-sources";
import { can, lowestTierWith } from "@/server/entitlements/access";
import { getViewer } from "@/server/entitlements/service";
import { listTopSourcesForViewer } from "@/server/signals/queries";
import { TOP_SOURCES_MIN_TRADES } from "@/server/statistics/compute";

export const metadata: Metadata = { title: "Top sources" };

const FEATURES = [
  { icon: ChartCandlestick, label: "Every trade replayed on minute data" },
  { icon: Scale, label: `Ranked once a source has ${TOP_SOURCES_MIN_TRADES} closed trades` },
  { icon: Trophy, label: "Ordered by expectancy per trade" },
];

export default async function TopSourcesPage() {
  const viewer = await getViewer();
  const header = (
    <PageHeader
      title="Top sources"
      icon={Trophy}
      features={FEATURES}
      description="Tracked sources ranked by how their signals actually played out against XAU/USD market data."
    />
  );
  if (!can(viewer.access, "signals.core")) {
    return (
      <>
        {header}
        <LockedPanel feature="signals.core" requiredTier={lowestTierWith("signals.core", viewer.config)} title="Source rankings are available to members" userId={viewer.user?.id} />
      </>
    );
  }
  const ranking = await listTopSourcesForViewer(viewer, 50);
  return (
    <>
      {header}
      <TopSources
        rows={ranking.rows}
        eligibleCount={ranking.eligibleCount}
        sourceCount={ranking.sourceCount}
        lockedHref="/upgrade?tier=silver&feature=sources.stats.summary"
        hrefBase="/sources"
      />
    </>
  );
}
