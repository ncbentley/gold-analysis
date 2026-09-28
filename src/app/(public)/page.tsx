import { ArrowRight, Bot, Database, LineChart, ScrollText, ShieldCheck, Timer } from "lucide-react";
import Link from "next/link";
import { AffiliateStrip } from "@/components/affiliate-strip";
import { SignalList } from "@/components/signal-list";
import { RValue } from "@/components/signal-bits";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { fmtMoney, fmtPct } from "@/lib/format";
import { cn } from "@/lib/utils";
import { listPlans } from "@/server/billing/service";
import { TIER_LABEL, TIER_ORDER } from "@/server/entitlements/config";
import { getTierConfig } from "@/server/entitlements/service";
import { listPublicSampleSignals, listSources } from "@/server/signals/queries";
import { getSourceStats } from "@/server/statistics/service";

export const dynamic = "force-dynamic";

const STEPS = [
  { icon: Database, title: "Collect", body: "Every post from each tracked Telegram channel is stored exactly as published, with its timestamp. Later edits are kept alongside the original, never over it." },
  { icon: ScrollText, title: "Normalize", body: "Entries, stops, targets and follow-up instructions are parsed into a standard format. Unclear messages go to a human reviewer instead of being guessed." },
  { icon: Timer, title: "Replay", body: "Each signal is replayed against XAU/USD one-minute candles with published, versioned rules for fills, targets, stops and same-candle ambiguity." },
  { icon: LineChart, title: "Measure", body: "Win rate, R-multiples, excursion, time-to-target and session behaviour are computed per source from the recorded outcomes." },
  { icon: Bot, title: "Explain", body: "An AI summary describes the setup context using only computed facts. It never changes a recorded result and never promises one." },
  { icon: ShieldCheck, title: "Audit", body: "Every manual correction or override keeps the original, the new value, who changed it and why." },
];

const TIER_PITCH: Record<string, { tagline: string; bullets: string[] }> = {
  silver: { tagline: "The signals, as they happen", bullets: ["Live signals and status updates", "Original source text", "Final result for closed trades"] },
  gold: {
    tagline: "Know how each source performs",
    bullets: ["Everything in Silver", "Source win rate, average R and expectancy", "Recent 10 / 30 trade form", "Time of day, direction and signal type breakdowns", "Similar-trade summary and MFE / MAE"],
  },
  platinum: {
    tagline: "The full research desk",
    bullets: ["Everything in Gold", "Full history and search", "Advanced filters", "AI setup classification and pattern analysis", "Similar-trade details and trade timelines", "Session, weekday and percentile statistics"],
  },
};

export default async function LandingPage() {
  const config = await getTierConfig();
  const [samples, sources, plans] = await Promise.all([listPublicSampleSignals(config), listSources(), listPlans()]);
  const sourceStats = await Promise.all(sources.map(async (s) => ({ source: s, stats: await getSourceStats(s.id) })));
  const totalClosed = sourceStats.reduce((a, s) => a + s.stats.closedTrades, 0);
  const monthly = new Map(plans.filter((p) => p.period === "monthly").map((p) => [p.tier, p]));

  return (
    <>
      <section className="grid-bg relative overflow-hidden border-b border-border/60">
        <div className="mx-auto max-w-6xl px-4 pb-16 pt-16 md:pb-24 md:pt-24">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/5 px-3 py-1 text-xs text-primary">
              XAU/USD · {sources.length ? `${sources.length} tracked ${sources.length === 1 ? "source" : "sources"}` : "tracked sources"}
              {totalClosed > 0 && ` · ${totalClosed.toLocaleString()} measured trades`}
            </div>
            <h1 className="mt-5 text-4xl font-semibold tracking-tight md:text-6xl">
              Every gold signal, <span className="gold-text">tracked and measured</span>.
            </h1>
            <p className="mt-5 max-w-2xl text-lg leading-relaxed text-muted-foreground">
              Aurum Ledger records gold trading signals, replays each one against minute-level market data, and shows you how each
              source has actually performed. The channel is not named. The same way, every time, with the rules in the open.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/signup" className={cn(buttonVariants({ size: "lg" }), "px-5")}>
                Create an account <ArrowRight />
              </Link>
              <Link href="/pricing" className={cn(buttonVariants({ size: "lg", variant: "outline" }), "px-5")}>
                Compare plans
              </Link>
            </div>
            <p className="mt-4 text-xs text-muted-foreground">No profit claims. Results are historical measurements, not a forecast.</p>
          </div>
        </div>
      </section>

      <section id="how-it-works" className="mx-auto max-w-6xl scroll-mt-16 px-4 py-16">
        <h2 className="text-2xl font-semibold tracking-tight">How it works</h2>
        <p className="mt-2 max-w-2xl text-muted-foreground">Raw data is kept untouched. Results are computed from it with versioned rules, so they can always be recomputed and checked.</p>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {STEPS.map((s) => (
            <div key={s.title} className="rounded-xl border bg-card/50 p-5">
              <s.icon className="size-5 text-primary" />
              <div className="mt-3 font-medium">{s.title}</div>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-y border-border/60 bg-card/20">
        <div className="mx-auto max-w-6xl px-4 py-16">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight">How sources performed</h2>
              <p className="mt-2 max-w-2xl text-muted-foreground">Lifetime results for each source, computed from recorded outcomes. Channel names are not shown. Ambiguous and cancelled signals are excluded from win rate.</p>
            </div>
          </div>
          {sourceStats.length === 0 && (
            <div className="mt-8 rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
              Source track records are published here once signals have closed.
            </div>
          )}
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {sourceStats.map(({ source, stats }) => (
              <Card key={source.id} className="bg-card/60">
                <CardHeader>
                  <CardTitle>How this source performed</CardTitle>
                  <CardDescription className="line-clamp-2">Results are computed from recorded outcomes. The channel is not named.</CardDescription>
                </CardHeader>
                <CardContent className="grid grid-cols-3 gap-3 text-sm">
                  <div>
                    <div className="text-[11px] text-muted-foreground">Closed trades</div>
                    <div className="font-semibold tabular-nums">{stats.closedTrades}</div>
                  </div>
                  <div>
                    <div className="text-[11px] text-muted-foreground">Win rate</div>
                    <div className="font-semibold tabular-nums">{fmtPct(stats.winRate)}</div>
                  </div>
                  <div>
                    <div className="text-[11px] text-muted-foreground">Avg R</div>
                    <RValue value={stats.avgR} className="font-semibold" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <h3 className="mt-12 text-lg font-semibold">Sample of recently closed signals</h3>
          <p className="mt-1 text-sm text-muted-foreground">Shown with a one-week delay. Members see signals as they are published.</p>
          <div className="mt-4">
            <SignalList items={samples} empty="Closed signals will appear here once the first trades complete." />
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16">
        <h2 className="text-2xl font-semibold tracking-tight">Plans</h2>
        <p className="mt-2 text-muted-foreground">Weekly, monthly or annual billing. Cancel any time; access continues until the end of the paid period.</p>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {TIER_ORDER.map((tier) => {
            const plan = monthly.get(tier);
            return (
              <Card key={tier} className={cn("bg-card/60", tier === "gold" && "ring-primary/50")}>
                <CardHeader>
                  <CardTitle className={cn(tier === "gold" && "gold-text")}>{TIER_LABEL[tier]}</CardTitle>
                  <CardDescription>{TIER_PITCH[tier].tagline}</CardDescription>
                </CardHeader>
                <CardContent>
                  {plan && (
                    <div className="text-2xl font-semibold">
                      {fmtMoney(plan.amountCents, plan.currency)}
                      <span className="text-sm font-normal text-muted-foreground"> / month</span>
                    </div>
                  )}
                  <ul className="mt-4 space-y-1.5 text-sm text-muted-foreground">
                    {TIER_PITCH[tier].bullets.map((b) => (
                      <li key={b}>{b}</li>
                    ))}
                  </ul>
                  <div className="mt-2 text-[11px] text-muted-foreground">
                    History: {config[tier].historyDays ? `${config[tier].historyDays} days` : "full"}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
        <div className="mt-6">
          <Link href="/pricing" className={buttonVariants({ variant: "outline" })}>
            See full pricing <ArrowRight />
          </Link>
        </div>
        <div className="mt-12">
          <AffiliateStrip placement="landing" />
        </div>
      </section>
    </>
  );
}
