import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { AffiliateStrip } from "@/components/affiliate-strip";
import { LockedPanel } from "@/components/locked";
import { PageHeader } from "@/components/page-header";
import { RValue, Stat } from "@/components/signal-bits";
import { SignalList } from "@/components/signal-list";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fmtAge, fmtPct, fmtPrice } from "@/lib/format";
import { can, lowestTierWith } from "@/server/entitlements/access";
import { getViewer } from "@/server/entitlements/service";
import { getRecentBars } from "@/server/market-data";
import { presentSourceStats } from "@/server/presenters";
import { listSignalsForViewer, listSources } from "@/server/signals/queries";
import { getSourceStats } from "@/server/statistics/service";
import { nowMs } from "@/lib/clock";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const viewer = await getViewer();
  const { access, config, user } = viewer;
  const [lastBar] = (await getRecentBars(1)).slice(-1);
  const now = nowMs();

  const header = (
    <PageHeader
      title="Dashboard"
      description="Live gold signals from tracked sources, replayed against XAU/USD minute data."
      actions={
        lastBar && (
          <div className="rounded-md border bg-card/60 px-3 py-1.5 text-right">
            <div className="text-[11px] text-muted-foreground">XAU/USD · last bar {fmtAge(lastBar.timestamp, now)} ago</div>
            <div className="font-mono text-lg font-semibold tabular-nums">{fmtPrice(lastBar.close)}</div>
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

  const [open, closed, sources] = await Promise.all([
    listSignalsForViewer(viewer, { status: "OPEN" }, { limit: 20 }),
    listSignalsForViewer(viewer, { status: "CLOSED" }, { limit: 10 }),
    listSources(),
  ]);
  const sourceCards = await Promise.all(
    sources.map(async (s) => ({ source: s, stats: presentSourceStats(await getSourceStats(s.id), access, config) })),
  );
  const activeCount = open.items.filter((s) => s.status !== "PENDING").length;
  const pendingCount = open.items.filter((s) => s.status === "PENDING").length;

  return (
    <>
      {header}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Active trades" value={activeCount} hint="entered, not closed" />
        <Stat label="Pending entries" value={pendingCount} hint="waiting for fill" />
        <Stat label="Tracked sources" value={sources.length} />
        <Stat label="Signals in your window" value={open.total + closed.total} hint={access.historyDays ? `last ${access.historyDays} days` : "full history"} />
      </div>

      <section className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Active &amp; pending</h2>
          <Link href="/signals?status=OPEN" className="text-sm text-muted-foreground hover:text-foreground">
            View all
          </Link>
        </div>
        <SignalList items={open.items} now={now} empty="No open signals right now. New signals appear here as sources publish them." />
      </section>

      <section className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Recently closed</h2>
          <Link href="/signals?status=CLOSED" className="text-sm text-muted-foreground hover:text-foreground">
            View all
          </Link>
        </div>
        <SignalList items={closed.items} now={now} empty="No closed signals in your history window yet." />
      </section>

      <section className="mt-8">
        <h2 className="mb-3 text-lg font-semibold">Sources</h2>
        <div className="grid gap-3 md:grid-cols-3">
          {sourceCards.map(({ source, stats }) => (
            <Card key={source.id} className="bg-card/60">
              <CardHeader>
                <CardTitle className="flex items-center justify-between text-base">
                  {source.name}
                  <Link href={`/sources/${source.slug}`} className={buttonVariants({ variant: "ghost", size: "icon-sm" })} aria-label={`Open ${source.name}`}>
                    <ArrowRight />
                  </Link>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-xs text-muted-foreground">
                  {stats.totalSignals} tracked signals · {stats.closedTrades} closed
                </div>
                {stats.summary.locked ? (
                  <p className="mt-3 text-xs text-muted-foreground">
                    Win rate, average R and expectancy are included with{" "}
                    <Link href="/upgrade?tier=gold&feature=sources.stats.summary" className="text-primary hover:underline">
                      Gold
                    </Link>
                    .
                  </p>
                ) : (
                  <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
                    <div>
                      <div className="text-[11px] text-muted-foreground">Win rate</div>
                      <div className="font-semibold">{fmtPct(stats.summary.data.winRate)}</div>
                    </div>
                    <div>
                      <div className="text-[11px] text-muted-foreground">Avg R</div>
                      <RValue value={stats.summary.data.avgR} className="font-semibold" />
                    </div>
                    <div>
                      <div className="text-[11px] text-muted-foreground">Expectancy</div>
                      <RValue value={stats.summary.data.expectancy} className="font-semibold" />
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <div className="mt-8">
        <AffiliateStrip placement="dashboard" />
      </div>
    </>
  );
}
