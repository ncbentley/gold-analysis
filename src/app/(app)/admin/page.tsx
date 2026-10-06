import {
  Activity,
  ArrowRight,
  BarChart3,
  CandlestickChart,
  ClipboardCheck,
  Eye,
  FileClock,
  Gauge,
  Inbox,
  LayoutGrid,
  Link2,
  ListChecks,
  Megaphone,
  Plug,
  RefreshCw,
  Send,
  Settings,
  ShieldCheck,
  TriangleAlert,
  Trophy,
  UsersRound,
  Workflow,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { enqueueJobAction, runJobsAction } from "@/app/actions/admin";
import { Callout, Notice } from "@/components/admin-bits";
import { PageHeader, SectionTitle } from "@/components/page-header";
import { Stat } from "@/components/signal-bits";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { fmtAge, fmtDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { getAdminOverview } from "@/server/admin";
import { getAiProvider } from "@/server/ai/service";
import { billingMode } from "@/server/billing/config";
import { requireAdmin } from "@/server/auth/guards";
import { TIER_LABEL, TIER_ORDER } from "@/server/entitlements/config";
import { getMarketDataProvider } from "@/server/market-data";
import { nowMs } from "@/lib/clock";
import { telegramStatus } from "@/server/telegram";

export const metadata = { title: "Overview" };

type Icon = React.ComponentType<{ className?: string }>;

const QUICK: { href: string; label: string; icon: Icon }[] = [
  { href: "/admin/review", label: "Review queue", icon: ClipboardCheck },
  { href: "/admin/signals", label: "Signals", icon: ListChecks },
  { href: "/admin/telegram", label: "Telegram", icon: Send },
  { href: "/admin/affiliates", label: "Broker links", icon: Link2 },
];

const MODULES: { href: string; title: string; description: string; cta: string; icon: Icon }[] = [
  { href: "/admin/review", title: "Review queue", description: "Posts the model could not decide on. Create the signal with corrected fields or dismiss the message.", cta: "Review posts", icon: ClipboardCheck },
  { href: "/admin/signals", title: "Signal control", description: "Correct fields, recalculate or override outcomes, and regenerate AI analysis.", cta: "Manage signals", icon: ListChecks },
  { href: "/admin/telegram", title: "Telegram", description: "The account that reads channels, and which of those channels are tracked.", cta: "Manage Telegram", icon: Send },
  { href: "/admin/jobs", title: "Jobs", description: "Market data sync, outcome replay, statistics, AI and billing work, with retries.", cta: "Manage jobs", icon: Workflow },
  { href: "/admin/entitlements", title: "Entitlements", description: "Features and history window included in each membership tier.", cta: "Manage entitlements", icon: ShieldCheck },
  { href: "/admin/members", title: "Members", description: "Everyone who has joined, and complimentary Silver or Gold that does not charge them.", cta: "View members", icon: UsersRound },
  { href: "/admin/affiliates", title: "Broker links", description: "Affiliate links, where they are placed and how often they are clicked.", cta: "Manage broker links", icon: Link2 },
  { href: "/admin/attribution", title: "Attribution", description: "UTM tags, ad click ids and referrers, from the first visit through signup and every later event.", cta: "View attribution", icon: Megaphone },
  { href: "/admin/audit", title: "Audit log", description: "Every manual change and automated transition, with the actor and reason.", cta: "Open audit log", icon: FileClock },
  { href: "/admin/settings", title: "Settings", description: "Market data provider and encrypted credentials.", cta: "Manage settings", icon: Settings },
];

export default async function AdminOverviewPage({ searchParams }: PageProps<"/admin">) {
  await requireAdmin();
  const sp = await searchParams;
  const [o, provider, tg] = await Promise.all([getAdminOverview(), getMarketDataProvider(), telegramStatus()]);
  const open = (o.signals.PENDING ?? 0) + (o.signals.ACTIVE ?? 0) + (o.signals.PARTIAL ?? 0);
  const closed = (o.signals.WON ?? 0) + (o.signals.LOST ?? 0) + (o.signals.BREAKEVEN ?? 0);
  const staleMinutes = o.market.last ? (nowMs() - new Date(o.market.last).getTime()) / 60_000 : null;
  const needsReview = o.parses.needs_review ?? 0;
  const failed = o.jobs.failed ?? 0;
  const tileLink = "block rounded-xl outline-none transition-[filter] duration-200 hover:brightness-125 focus-visible:ring-3 focus-visible:ring-ring/50";

  return (
    <>
      <PageHeader
        art="bull"
        icon={Gauge}
        title="Admin command center"
        description="Run the Gold Intelligence Gateway pipeline: ingestion, parsing, outcome replay, background jobs and billing, all from one place."
      >
        <div className="mt-6 flex flex-wrap gap-2">
          <form action={runJobsAction}>
            <input type="hidden" name="returnTo" value="/admin" />
            <Button type="submit" size="sm">
              <Zap data-icon="inline-start" />
              Run queued jobs
            </Button>
          </form>
          <form action={enqueueJobAction}>
            <input type="hidden" name="type" value="MARKET_DATA_SYNC" />
            <input type="hidden" name="returnTo" value="/admin" />
            <Button type="submit" variant="outline" size="sm">
              <RefreshCw data-icon="inline-start" />
              Sync market data
            </Button>
          </form>
          {QUICK.map((q) => (
            <Link key={q.href} href={q.href} className={buttonVariants({ variant: "outline", size: "sm" })}>
              <q.icon data-icon="inline-start" />
              {q.label}
              {q.href === "/admin/review" && needsReview > 0 && <span className="rounded-full bg-loss px-1.5 text-[10px] font-semibold text-white tabular-nums">{needsReview}</span>}
            </Link>
          ))}
          <Link href="/dashboard" className={buttonVariants({ variant: "secondary", size: "sm" })}>
            <Eye data-icon="inline-start" />
            View as member
          </Link>
        </div>
      </PageHeader>
      <Notice searchParams={sp} />

      {(!tg.signedIn || provider.name === "mock") && (
        <div className="mb-4 grid gap-3 lg:grid-cols-2">
          {!tg.signedIn && (
            <Callout tone="gold" icon={Send}>
              <span className="font-semibold">Telegram is not connected.</span> Signals are captured from channels and groups the account has joined.{" "}
              <Link href="/admin/telegram" className="font-medium text-primary underline-offset-2 hover:underline">
                Connect a Telegram account
              </Link>
              .
            </Callout>
          )}
          {provider.name === "mock" && (
            <Callout tone="warn">
              Outcomes are being replayed against synthetic prices. Before publishing results,{" "}
              <Link href="/admin/settings" className="font-medium text-amber-200 underline underline-offset-2">
                connect a real XAU/USD data provider
              </Link>
              .
            </Callout>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
        <Stat icon={Inbox} label="Raw events" value={o.events.total.toLocaleString()} hint={`${o.events.day} in last 24h`} />
        <Stat icon={Activity} tone="gold" label="Open signals" value={open} hint={`${o.signals.PENDING ?? 0} pending`} />
        <Stat icon={Trophy} label="Closed trades" value={closed.toLocaleString()} hint={`${o.signals.MANUAL_REVIEW ?? 0} ambiguous`} />
        <Link href="/admin/review" className={tileLink}>
          <Stat icon={ClipboardCheck} tone={needsReview > 0 ? "gold" : "blue"} label="Needs review" value={needsReview} hint="parse queue" className="h-full" />
        </Link>
        <Link href="/admin/jobs?status=failed" className={tileLink}>
          <Stat icon={TriangleAlert} tone={failed > 0 ? "loss" : "blue"} label="Failed jobs" value={failed} hint={`${o.jobs.queued ?? 0} queued`} className="h-full" />
        </Link>
        <Link href="/admin/members" className={tileLink}>
          <Stat icon={UsersRound} label="Users" value={o.users} hint={`${Object.values(o.subscriptions).reduce((a, b) => a + b, 0)} paying`} className="h-full" />
        </Link>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <SectionTitle icon={CandlestickChart} title="Market data" className="mb-0" action={<PanelLink href="/admin/settings">Settings</PanelLink>} />
          </CardHeader>
          <CardContent className="text-sm">
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
              <p className="mt-2 rounded-lg border border-amber-400/30 bg-amber-400/[0.06] px-2.5 py-1.5 text-xs text-amber-200/90">
                Data is stale. Outside market hours this is expected; otherwise check the provider.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <SectionTitle icon={Plug} title="Integrations" className="mb-0" />
          </CardHeader>
          <CardContent className="text-sm">
            <Row
              k="Telegram"
              v={
                tg.connected ? (
                  <span className="inline-flex items-center gap-1.5 text-win">
                    <span className="size-1.5 rounded-full bg-current" />
                    Connected{tg.me ? ` as ${tg.me.name}` : ""}
                  </span>
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
            <div className="pt-3 pb-1.5 text-xs font-medium text-muted-foreground">Active memberships</div>
            <div className="grid grid-cols-3 gap-2">
              {TIER_ORDER.map((t) => (
                <div key={t} className="rounded-lg bg-primary/[0.06] px-2.5 py-2 ring-1 ring-primary/30">
                  <div className="text-[11px] font-medium text-muted-foreground">{TIER_LABEL[t]}</div>
                  <div className="gold-text font-heading text-lg font-bold tabular-nums">{o.subscriptions[t] ?? 0}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <SectionTitle icon={BarChart3} title="Product events · 7 days" className="mb-0" action={<PanelLink href="/admin/attribution">Attribution</PanelLink>} />
          </CardHeader>
          <CardContent className="text-sm">
            {o.analytics.length ? o.analytics.slice(0, 9).map((a) => <Row key={a.name} k={a.name} v={a.n} mono />) : <p className="text-muted-foreground">No events recorded yet.</p>}
          </CardContent>
        </Card>
      </div>

      <Card className={cn("mt-4", o.failedJobs.length > 0 && "ring-loss/35 shadow-[0_0_28px_-12px_var(--loss)]")}>
        <CardHeader>
          <SectionTitle icon={TriangleAlert} title="Recent job failures" className="mb-0" action={<PanelLink href="/admin/jobs?status=failed">View all</PanelLink>} />
        </CardHeader>
        <CardContent>
          {o.failedJobs.length ? (
            <ul className="divide-y divide-border text-sm">
              {o.failedJobs.map((j) => (
                <li key={j.id} className="py-2.5 first:pt-0 last:pb-0">
                  <div className="flex justify-between gap-2">
                    <span className="font-mono text-xs font-semibold">{j.type}</span>
                    <span className="text-xs text-muted-foreground">{fmtDateTime(j.finishedAt)}</span>
                  </div>
                  <div className="mt-1 truncate font-mono text-xs text-loss">{j.lastError?.split("\n")[0]}</div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No failed jobs. Everything that was queued has either run or is waiting to run.</p>
          )}
        </CardContent>
      </Card>

      <section className="mt-7">
        <SectionTitle icon={LayoutGrid} title="Admin tools" />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {MODULES.map((m) => {
            const hot = m.href === "/admin/review" && needsReview > 0;
            return (
              <Card key={m.href} size="sm" className={cn("gap-3 px-4 py-4", hot && "panel-gold ring-primary/55 shadow-[0_0_28px_-8px_rgb(245_197_66/0.55)]")}>
                <div className="flex items-start gap-3">
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/55">
                    <m.icon className="size-5" />
                  </span>
                  <div className="min-w-0">
                    <h3 className="flex items-center gap-2 font-heading text-[15px] font-bold tracking-tight">
                      {m.title}
                      {hot && <span className="rounded-full bg-loss px-1.5 text-[10px] font-semibold text-white tabular-nums">{needsReview}</span>}
                    </h3>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{m.description}</p>
                  </div>
                </div>
                <Link href={m.href} className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "mt-auto w-full")}>
                  {m.cta}
                  <ArrowRight data-icon="inline-end" />
                </Link>
              </Card>
            );
          })}
        </div>
      </section>
    </>
  );
}

function PanelLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="inline-flex items-center gap-1 rounded text-xs font-medium text-[#8db6ff] outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring">
      {children}
      <ArrowRight className="size-3.5" />
    </Link>
  );
}

function Row({ k, v, mono }: { k: string; v: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3 border-b border-border/70 py-1.5 last:border-0">
      <span className={mono ? "font-mono text-xs text-muted-foreground" : "text-muted-foreground"}>{k}</span>
      <span className={cn("text-right tabular-nums", mono && "font-mono text-xs")}>{v}</span>
    </div>
  );
}
