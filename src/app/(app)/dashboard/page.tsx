import { Activity, ChartCandlestick, Coins, History, Hourglass, LayoutDashboard, Radar, Radio, Trophy } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { AffiliateStrip } from "@/components/affiliate-strip";
import { DirectionPanel } from "@/components/direction-panel";
import { IdeaList } from "@/components/idea-list";
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
import { listIdeasForViewer } from "@/server/ideas/service";
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

  const silver = access.tier === "silver";
  const spot = lastBar?.close ?? null;
  const [open, closed, ideas, ranking, direction] = await Promise.all([
    silver ? null : listSignalsForViewer(viewer, { status: "OPEN" }, { limit: 20, segment: true }),
    silver ? null : listSignalsForViewer(viewer, { status: "CLOSED" }, { limit: 10, segment: true }),
    silver ? listIdeasForViewer(viewer, spot) : null,
    listTopSourcesForViewer(viewer, 5),
    latestMarketDirection(),
  ]);
  const activeCount = open?.items.filter((s) => s.status !== "PENDING").length ?? 0;
  const pendingCount = open?.items.filter((s) => s.status === "PENDING").length ?? 0;
  const liveIdeas = ideas?.filter((idea) => idea.phase !== "history") ?? [];
  const historyIdeas = ideas?.filter((idea) => idea.phase === "history") ?? [];
  const sourceCount = ideas?.reduce((sum, idea) => sum + idea.sourceCount, 0) ?? 0;

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
        {silver ? (
          <>
            <Stat label="Available" value={ideas?.filter((idea) => idea.phase === "available").length ?? 0} hint="can still be filled" icon={Hourglass} />
            <Stat label="Playing out" value={ideas?.filter((idea) => idea.phase === "playing-out").length ?? 0} hint="entered, not closed" icon={Activity} tone="gold" />
            <Stat
              label="History"
              value={historyIdeas.length}
              hint={access.historyDays ? `last ${access.historyDays} days` : "full history"}
              icon={History}
            />
            <Stat label="Source count" value={sourceCount} hint="across these ideas" icon={Radar} />
          </>
        ) : (
          <>
            <Stat label="Active trades" value={activeCount} hint="entered, not closed" icon={Activity} tone="gold" />
            <Stat label="Pending entries" value={pendingCount} hint="waiting for fill" icon={Hourglass} />
            <Stat label="Tracked sources" value={ranking.sourceCount} icon={Radar} />
            <Stat
              label="Signals in your window"
              value={(open?.total ?? 0) + (closed?.total ?? 0)}
              hint={access.historyDays ? `last ${access.historyDays} days` : "full history"}
              icon={History}
            />
          </>
        )}
      </div>

      {silver ? (
        <>
          <section className="mt-8">
            <SectionTitle icon={Activity} title="Available & playing out" />
            <IdeaList items={liveIdeas} now={now} empty="No ideas are available or playing out right now." />
          </section>
          <section className="mt-8">
            <SectionTitle icon={History} title="History" />
            <IdeaList items={historyIdeas} now={now} empty="No ideas in your history window yet." />
          </section>
        </>
      ) : (
        <>
          <section className="mt-8">
            <SectionTitle icon={Activity} title="Active & pending" action={<ViewAll href="/signals" />} />
            <SignalList items={open?.items ?? []} now={now} empty="No open signals right now. New signals appear here within moments of being posted." />
          </section>
          <section className="mt-8">
            <SectionTitle icon={History} title="Recently closed" action={<ViewAll href="/signals" />} />
            <SignalList items={closed?.items ?? []} now={now} empty="No closed signals in your history window yet." />
          </section>
        </>
      )}

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
