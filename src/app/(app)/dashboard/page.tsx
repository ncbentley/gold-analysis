import { Activity, ChartCandlestick, Coins, History, Hourglass, LayoutDashboard, Radar, Radio, Trophy } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { AffiliateStrip } from "@/components/affiliate-strip";
import { DirectionPanel } from "@/components/direction-panel";
import { LiveRefresh } from "@/components/live-refresh";
import { LockedPanel } from "@/components/locked";
import { PageHeader, SectionTitle } from "@/components/page-header";
import { Stat } from "@/components/signal-bits";
import { SignalList } from "@/components/signal-list";
import { TopSources } from "@/components/top-sources";
import { fmtAge, fmtPrice } from "@/lib/format";
import { can, lowestTierWith } from "@/server/entitlements/access";
import { getViewer } from "@/server/entitlements/service";
import { latestMarketDirection } from "@/server/direction/service";
import { getRecentBars } from "@/server/market-data";
import { listSignalsForViewer, listTopSourcesForViewer } from "@/server/signals/queries";
import { nowMs } from "@/lib/clock";

export const metadata: Metadata = { title: "Dashboard" };

const FEATURES = [
  { icon: Radio, label: "Live signals from tracked sources" },
  { icon: ChartCandlestick, label: "Replayed against XAU/USD minute data" },
  { icon: Trophy, label: "Source track records" },
];

function ViewAll({ href }: { href: string }) {
  return (
    <Link href={href} className="rounded text-sm font-medium text-[#8db6ff] outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring">
      View all
    </Link>
  );
}

export default async function DashboardPage() {
  const viewer = await getViewer();
  const { access, config, user } = viewer;
  const [lastBar] = (await getRecentBars(1)).slice(-1);
  const now = nowMs();

  const header = (
    <PageHeader
      title="Dashboard"
      icon={LayoutDashboard}
      description="Live gold signals from tracked sources, replayed against XAU/USD minute data."
      features={FEATURES}
      actions={
        lastBar && (
          <div className="panel-gold flex items-center gap-3 rounded-xl py-2.5 pl-2.5 pr-4 shadow-[0_0_26px_-8px_rgb(245_197_66/0.6)] ring-1 ring-primary/55">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/55">
              <Coins className="size-5" />
            </span>
            <div className="text-right">
              <div className="text-[11px] text-muted-foreground">
                <span className="font-semibold text-foreground/90">XAU/USD</span> last bar {fmtAge(lastBar.timestamp, now)} ago
              </div>
              <div className="gold-text font-mono text-2xl font-bold tabular-nums tracking-tight">{fmtPrice(lastBar.close)}</div>
            </div>
          </div>
        )
      }
    />
  );

  if (!can(access, "signals.core")) {
    return (
      <>
        {header}
        <LockedPanel
          feature="signals.core"
          requiredTier={lowestTierWith("signals.core", config)}
          title="Signals are available to members"
          userId={user?.id}
        />
        <div className="mt-6">
          <AffiliateStrip placement="dashboard" />
        </div>
      </>
    );
  }

  const [open, closed, ranking, direction] = await Promise.all([
    listSignalsForViewer(viewer, { status: "OPEN" }, { limit: 20 }),
    listSignalsForViewer(viewer, { status: "CLOSED" }, { limit: 10 }),
    listTopSourcesForViewer(viewer, 5),
    latestMarketDirection(),
  ]);
  const activeCount = open.items.filter((s) => s.status !== "PENDING").length;
  const pendingCount = open.items.filter((s) => s.status === "PENDING").length;

  return (
    <>
      <LiveRefresh />
      {header}
      <DirectionPanel
        direction={direction}
        now={now}
        empty={access.isAdmin ? "Star a channel on the Telegram page. Its posts feed this read." : "No direction read yet."}
      />
      <div className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Active trades" value={activeCount} hint="entered, not closed" icon={Activity} tone="gold" />
        <Stat label="Pending entries" value={pendingCount} hint="waiting for fill" icon={Hourglass} />
        <Stat label="Tracked sources" value={ranking.sourceCount} icon={Radar} />
        <Stat
          label="Signals in your window"
          value={open.total + closed.total}
          hint={access.historyDays ? `last ${access.historyDays} days` : "full history"}
          icon={History}
        />
      </div>

      <section className="mt-8">
        <SectionTitle icon={Activity} title="Active & pending" action={<ViewAll href="/signals?status=OPEN" />} />
        <SignalList items={open.items} now={now} empty="No open signals right now. New signals appear here within moments of being posted." />
      </section>

      <section className="mt-8">
        <SectionTitle icon={History} title="Recently closed" action={<ViewAll href="/signals?status=CLOSED" />} />
        <SignalList items={closed.items} now={now} empty="No closed signals in your history window yet." />
      </section>

      <section className="mt-8">
        <SectionTitle icon={Trophy} title="Top sources" action={<ViewAll href="/sources" />} />
        <TopSources
          rows={ranking.rows}
          hrefBase="/sources"
          eligibleCount={ranking.eligibleCount}
          sourceCount={ranking.sourceCount}
          lockedHref="/upgrade?tier=silver&feature=sources.stats.summary"
        />
      </section>

      <div className="mt-8">
        <AffiliateStrip placement="dashboard" />
      </div>
    </>
  );
}
