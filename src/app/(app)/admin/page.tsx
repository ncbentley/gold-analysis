import Link from "next/link";
import { enqueueJobAction, runJobsAction } from "@/app/actions/admin";
import { Notice } from "@/components/admin-bits";
import { PageHeader } from "@/components/page-header";
import { Stat } from "@/components/signal-bits";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fmtAge, fmtDateTime } from "@/lib/format";
import { getAdminOverview } from "@/server/admin";
import { getAiProvider } from "@/server/ai/service";
import { billingMode } from "@/server/billing/config";
import { requireAdmin } from "@/server/auth/guards";
import { TIER_LABEL, TIER_ORDER } from "@/server/entitlements/config";
import { getMarketDataProvider } from "@/server/market-data";
import { nowMs } from "@/lib/clock";
import { telegramStatus } from "@/server/telegram";

export const metadata = { title: "Overview" };

export default async function AdminOverviewPage({ searchParams }: PageProps<"/admin">) {
  await requireAdmin();
  const sp = await searchParams;
  const [o, provider, tg] = await Promise.all([getAdminOverview(), getMarketDataProvider(), telegramStatus()]);
  const open = (o.signals.PENDING ?? 0) + (o.signals.ACTIVE ?? 0) + (o.signals.PARTIAL ?? 0);
  const closed = (o.signals.WON ?? 0) + (o.signals.LOST ?? 0) + (o.signals.BREAKEVEN ?? 0);
  const staleMinutes = o.market.last ? (nowMs() - new Date(o.market.last).getTime()) / 60_000 : null;

  return (
    <>
      <PageHeader
        title="Operations"
        description="Pipeline health across ingestion, parsing, outcome replay, jobs and billing."
        actions={
          <>
            <form action={enqueueJobAction}>
              <input type="hidden" name="type" value="MARKET_DATA_SYNC" />
              <input type="hidden" name="returnTo" value="/admin" />
              <Button type="submit" variant="outline" size="sm">Sync market data</Button>
            </form>
            <form action={runJobsAction}>
              <input type="hidden" name="returnTo" value="/admin" />
              <Button type="submit" size="sm">Run queued jobs</Button>
            </form>
          </>
        }
      />
      <Notice searchParams={sp} />

      {!tg.signedIn && (
        <div className="mb-4 rounded-lg border border-primary/30 bg-primary/5 p-4 text-sm">
          <span className="font-medium">Telegram is not connected.</span> Signals are captured from Telegram channels.{" "}
          <Link href="/admin/telegram" className="text-primary hover:underline">
            Sign in and add channels
          </Link>
          .
        </div>
      )}
      {provider.name === "mock" && (
        <div className="mb-4 rounded-lg border border-amber-400/30 bg-amber-400/5 p-4 text-sm text-amber-200/90">
          Outcomes are being replayed against synthetic prices. Before publishing results,{" "}
          <Link href="/admin/settings" className="underline">
            connect a real XAU/USD data provider
          </Link>
          .
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <Stat label="Raw events" value={o.events.total.toLocaleString()} hint={`${o.events.day} in last 24h`} />
        <Stat label="Open signals" value={open} hint={`${o.signals.PENDING ?? 0} pending`} />
        <Stat label="Closed trades" value={closed.toLocaleString()} hint={`${o.signals.MANUAL_REVIEW ?? 0} ambiguous`} />
        <Link href="/admin/review">
          <Stat label="Needs review" value={o.parses.needs_review ?? 0} className={(o.parses.needs_review ?? 0) > 0 ? "border-amber-400/40" : ""} hint="parse queue" />
        </Link>
        <Link href="/admin/jobs?status=failed">
          <Stat label="Failed jobs" value={o.jobs.failed ?? 0} className={(o.jobs.failed ?? 0) > 0 ? "border-loss/40" : ""} hint={`${o.jobs.queued ?? 0} queued`} />
        </Link>
        <Stat label="Users" value={o.users} hint={`${Object.values(o.subscriptions).reduce((a, b) => a + b, 0)} paying`} />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card className="bg-card/60">
          <CardHeader>
            <CardTitle className="text-base">Market data</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            <Row k="Provider" v={provider.name === "mock" ? "Synthetic (development)" : provider.name} />
            <Row k="Bars stored" v={o.market.count.toLocaleString()} />
            <Row k="First bar" v={fmtDateTime(o.market.first)} />
            <Row
              k="Latest bar"
              v={
                <span className={staleMinutes !== null && staleMinutes > 30 ? "text-amber-300" : undefined}>
                  {o.market.last ? `${fmtDateTime(o.market.last)} (${fmtAge(o.market.last)} ago)` : "none"}
                </span>
              }
            />
            <Row k="Last sync" v={o.sync?.updatedAt ? `${fmtAge(o.sync.updatedAt)} ago · synced through ${fmtDateTime(o.sync.syncedThrough)}` : "never"} />
            {staleMinutes !== null && staleMinutes > 30 && (
              <p className="pt-1 text-xs text-amber-300/90">Data is stale. Outside market hours this is expected; otherwise check the provider.</p>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card/60">
          <CardHeader>
            <CardTitle className="text-base">Integrations</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            <Row
              k="Telegram"
              v={
                tg.connected ? (
                  <span className="text-win">Connected{tg.me ? ` as ${tg.me.name}` : ""}</span>
                ) : tg.signedIn ? (
                  <span className="text-amber-300">Signed in, reconnecting</span>
                ) : (
                  "Not signed in"
                )
              }
            />
            <Row k="Billing" v={billingMode() === "stripe" ? "Stripe" : "Mock (test mode)"} />
            <Row k="AI provider" v={getAiProvider().model} />
            <Row k="Job worker" v={process.env.JOBS_WORKER === "off" ? "Disabled" : "In-process"} />
            <div className="pt-2 text-xs text-muted-foreground">Active memberships</div>
            <div className="grid grid-cols-3 gap-2">
              {TIER_ORDER.map((t) => (
                <div key={t} className="rounded-md border px-2 py-1.5">
                  <div className="text-[11px] text-muted-foreground">{TIER_LABEL[t]}</div>
                  <div className="font-semibold">{o.subscriptions[t] ?? 0}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card/60">
          <CardHeader>
            <CardTitle className="text-base">Product events · 7 days</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            {o.analytics.length ? o.analytics.slice(0, 9).map((a) => <Row key={a.name} k={a.name} v={a.n} mono />) : <p className="text-muted-foreground">No events recorded yet.</p>}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6 bg-card/60">
        <CardHeader>
          <CardTitle className="text-base">Recent job failures</CardTitle>
        </CardHeader>
        <CardContent>
          {o.failedJobs.length ? (
            <ul className="divide-y text-sm">
              {o.failedJobs.map((j) => (
                <li key={j.id} className="py-2">
                  <div className="flex justify-between gap-2">
                    <span className="font-medium">{j.type}</span>
                    <span className="text-xs text-muted-foreground">{fmtDateTime(j.finishedAt)}</span>
                  </div>
                  <div className="mt-0.5 truncate font-mono text-xs text-loss">{j.lastError?.split("\n")[0]}</div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No failed jobs. Everything that was queued has either run or is waiting to run.</p>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function Row({ k, v, mono }: { k: string; v: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <span className={mono ? "font-mono text-xs text-muted-foreground" : "text-muted-foreground"}>{k}</span>
      <span className="text-right tabular-nums">{v}</span>
    </div>
  );
}
