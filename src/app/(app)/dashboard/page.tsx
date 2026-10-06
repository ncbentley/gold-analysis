import { Activity, ChartCandlestick, Coins, History, Hourglass, LayoutDashboard, Radar, Radio, Trophy } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { AffiliateStrip } from "@/components/affiliate-strip";
import { BookSections } from "@/components/book-sections";
import { DirectionPanel } from "@/components/direction-panel";
import { IdeaList } from "@/components/idea-list";
import { FeedRefresh } from "@/components/feed-refresh";
import { LockedPanel } from "@/components/locked";
import { PageHeader, SectionTitle } from "@/components/page-header";
import { Stat } from "@/components/signal-bits";
import { SignalList } from "@/components/signal-list";
import { TopSources } from "@/components/top-sources";
import { fmtAge, fmtPrice } from "@/lib/format";
import { can, lowestTierWith } from "@/server/entitlements/access";
import { dashboardViewFor, readDashboardSnapshot } from "@/server/feed/snapshot";
import { getViewer } from "@/server/entitlements/service";
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
  const snap = await readDashboardSnapshot(dashboardViewFor(access));
  const now = nowMs();
  const lastBar = snap?.spot;

  const header = (
    <PageHeader
      title="Dashboard"
      icon={LayoutDashboard}
      description="Available trades, trades that are working, and a short history. Each membership is a smaller, more curated set."
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
  const goldBook = access.tier === "gold" && !access.isAdmin;
  const direction = snap?.direction ?? null;
  const ranking = snap?.ranking ?? { rows: [], eligibleCount: 0, sourceCount: 0 };
  const ideas = goldBook ? snap?.gold : silver ? snap?.ideas : null;
  const signals = snap?.signals;
  const pending = (signals?.open ?? []).filter((item) => item.status === "PENDING");
  const activeSignals = (signals?.open ?? []).filter((item) => item.status !== "PENDING");
  const availableCount = ideas ? ideas.available.length : pending.length;
  const activeCount = ideas ? ideas.active.length : (signals?.active ?? activeSignals.length);
  const historyCount = ideas ? ideas.historyCount : (signals?.historyCount ?? 0);

  return (
    <>
      <FeedRefresh />
      {header}
      {!snap ? (
        <p className="text-sm text-muted-foreground">The dashboard is being prepared.</p>
      ) : (
        <>
      <DirectionPanel
        direction={direction}
        now={now}
        empty={access.isAdmin ? "Star a channel on the Telegram page. Its posts feed this read." : "No direction read yet."}
      />
      <div className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Available" value={availableCount} hint="can still be filled" icon={Hourglass} />
        <Stat label="Active" value={activeCount} hint="entered, not closed" icon={Activity} tone="gold" />
        <Stat
          label="History"
          value={historyCount}
          hint={access.historyDays ? `last ${access.historyDays} days` : "full history"}
          icon={History}
        />
        <Stat label="Tracked sources" value={ranking.sourceCount} icon={Radar} />
      </div>

      {ideas ? (
        <BookSections
          historyCount={ideas.historyCount}
          available={<IdeaList items={ideas.available} now={now} empty="Nothing is waiting to fill." />}
          active={<IdeaList items={ideas.active} now={now} empty="Nothing is active right now." />}
          history={<IdeaList items={ideas.history} now={now} empty="No trades in your history window yet." />}
        />
      ) : (
        <BookSections
          historyCount={signals?.historyCount ?? 0}
          available={<SignalList items={pending} now={now} empty="No entries are waiting to fill." />}
          active={<SignalList items={activeSignals} now={now} empty="No trades are active right now." />}
          history={<SignalList items={signals?.closed ?? []} now={now} empty="No closed signals in your history window yet." />}
        />
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
      )}
    </>
  );
}
