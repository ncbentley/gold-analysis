import { ArrowRight, BarChart3, Bot, Check, Crown, Database, History, LineChart, Radio, ScrollText, ShieldCheck, Timer, Trophy } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { AffiliateStrip } from "@/components/affiliate-strip";
import { SectionTitle } from "@/components/page-header";
import { SignalList } from "@/components/signal-list";
import { TIER_ICON } from "@/components/signal-bits";
import { TopSources } from "@/components/top-sources";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { fmtMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { listPlans } from "@/server/billing/service";
import { FREE_HISTORY_DAYS, TIER_LABEL } from "@/server/entitlements/config";
import { getTierConfig } from "@/server/entitlements/service";
import { listPublicSampleSignals, listSources } from "@/server/signals/queries";
import { getTopSources } from "@/server/statistics/service";

export const dynamic = "force-dynamic";

const STEPS = [
  { icon: Database, title: "Collect", body: "Every post from each tracked Telegram channel is stored exactly as published, with its timestamp. Later edits are kept alongside the original, never over it." },
  { icon: ScrollText, title: "Normalize", body: "Entries, stops, targets and follow-up instructions are parsed into a standard format. Unclear messages go to a human reviewer instead of being guessed." },
  { icon: Timer, title: "Replay", body: "Each signal is replayed against XAU/USD one-minute candles with published, versioned rules for fills, targets, stops and same-candle ambiguity." },
  { icon: LineChart, title: "Measure", body: "Win rate, R-multiples, excursion, time-to-target and session behaviour are computed per source from the recorded outcomes." },
  { icon: Bot, title: "Explain", body: "An AI summary describes the setup context using only computed facts. It never changes a recorded result." },
  { icon: ShieldCheck, title: "Audit", body: "Every manual correction or override keeps the original, the new value, who changed it and why." },
];

const PLAN_CARDS = ["free", "silver", "platinum"] as const;

const TIER_PITCH: Record<(typeof PLAN_CARDS)[number], { tagline: string; bullets: string[] }> = {
  free: {
    tagline: "The raw feed",
    bullets: ["Live signals with entry, stop and targets", "Final result after a trade closes"],
  },
  silver: {
    tagline: "The consolidated feed",
    bullets: ["Everything in Free", "Nearby calls averaged into one idea", "180 days of history"],
  },
  platinum: {
    tagline: "One board",
    bullets: ["Everything in Silver", "One primary idea from the model, plus alternates", "Full history, advanced filters, and the detailed stats"],
  },
};

const SECTION = "mb-2 [&_h2]:text-2xl [&_h2_svg]:size-6";


function HeroFact({ icon: IconCmp, children }: { icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-2.5">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-black/45 text-primary ring-1 ring-primary/60">
        <IconCmp className="size-5" />
      </span>
      <span className="max-w-36 text-xs font-medium leading-tight text-foreground/90">{children}</span>
    </li>
  );
}

export default async function LandingPage() {
  const config = await getTierConfig();
  const [samples, sources, plans] = await Promise.all([listPublicSampleSignals(config), listSources(), listPlans()]);
  const { top, eligibleCount, sourceCount, totalClosed } = await getTopSources(sources.map((s) => s.id));
  const monthly = new Map(plans.filter((p) => p.period === "monthly").map((p) => [p.tier, p]));

  return (
    <>
      <section className="relative isolate overflow-hidden border-b border-primary/25">
        <Image
          src="/brand/hero-gold.jpg"
          alt=""
          fill
          loading="eager"
          fetchPriority="high"
          sizes="100vw"
          className="-z-10 object-cover object-[78%_50%] opacity-95"
        />
        <div className="absolute inset-0 -z-10 bg-gradient-to-r from-[#040914] from-30% via-[#040914]/75 via-60% to-[#040914]/5 max-md:via-[#040914]/90" />
        <div className="absolute inset-x-0 bottom-0 -z-10 h-32 bg-gradient-to-t from-background to-transparent" />
        <div className="mx-auto max-w-6xl px-4 pb-16 pt-16 md:pb-24 md:pt-24">
          <div className="max-w-2xl">
            <h1 className="gold-text font-heading text-4xl font-extrabold leading-[1.04] tracking-tight drop-shadow-[0_2px_16px_rgb(245_197_66/0.3)] md:text-6xl">
              Every gold signal, tracked and measured.
            </h1>
            <p className="mt-5 max-w-xl text-pretty text-lg leading-relaxed text-foreground/85">
              Gold Intelligence Gateway records gold trading signals, replays each one against minute-level market data, and shows how each source has actually
              performed. Channels stay unnamed. The same rules every time, published in the open.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/signup" className={cn(buttonVariants({ size: "lg" }), "px-6")}>
                Create an account <ArrowRight />
              </Link>
              <Link href="/pricing" className={cn(buttonVariants({ size: "lg", variant: "outline" }), "px-6")}>
                Compare plans
              </Link>
            </div>
            <ul className="mt-9 flex flex-wrap gap-x-7 gap-y-3">
              <HeroFact icon={Radio}>{sources.length ? `${sources.length} tracked ${sources.length === 1 ? "source" : "sources"}` : "Tracked sources"}</HeroFact>
              {totalClosed > 0 && <HeroFact icon={BarChart3}>{totalClosed.toLocaleString()} measured trades</HeroFact>}
              <HeroFact icon={Timer}>Replayed on XAU/USD minute data</HeroFact>
            </ul>
            <p className="mt-6 text-xs text-muted-foreground">Results are historical measurements, not a forecast.</p>
          </div>
        </div>
      </section>

      <section id="how-it-works" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-16">
        <SectionTitle icon={Timer} title="How it works" className={SECTION} />
        <p className="max-w-2xl text-muted-foreground">Raw data is kept untouched. Results are computed from it with versioned rules, so they can always be recomputed and checked.</p>
        <ol className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {STEPS.map((s, i) => (
            <li key={s.title} className="panel relative rounded-xl p-5 shadow-[0_0_24px_-12px_rgb(47_123_255/0.6)] ring-1 ring-glow/30">
              <div className="flex items-center gap-3">
                <span className="gold-fill flex size-8 shrink-0 items-center justify-center rounded-full font-heading text-sm font-extrabold shadow-[0_0_14px_-3px_rgb(245_197_66/0.7)]">
                  {i + 1}
                </span>
                <span className="font-heading text-base font-bold tracking-tight">{s.title}</span>
                <s.icon className="ml-auto size-5 text-primary/80" />
              </div>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="border-y border-glow/15 bg-[#050c1c]/60">
        <div className="mx-auto max-w-6xl px-4 py-16">
          <SectionTitle icon={Trophy} title="Top sources" className={SECTION} />
          <p className="max-w-2xl text-muted-foreground">
            Lifetime results computed from recorded outcomes. Ambiguous and cancelled signals are excluded from win rate.
          </p>
          <div className="mt-8">
            <TopSources
              rows={top.map(({ sourceId, stats }) => ({
                sourceId,
                name: sources.find((source) => source.id === sourceId)?.nickname ?? "Source",
                closedTrades: stats.closedTrades,
                metrics: stats,
              }))}
              eligibleCount={eligibleCount}
              sourceCount={sourceCount}
            />
          </div>

          <SectionTitle icon={History} title="Sample of recently closed signals" className="mb-1 mt-14" />
          <p className="text-sm text-muted-foreground">Shown with a one-week delay. Members see signals as they are published.</p>
          <div className="mt-4">
            <SignalList items={samples} empty="Closed signals will appear here once the first trades complete." />
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16">
        <SectionTitle icon={Crown} title="Plans" className={SECTION} />
        <p className="text-muted-foreground">Weekly, monthly or annual billing. Cancel any time; access continues until the end of the paid period.</p>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {PLAN_CARDS.map((tier) => {
            const featured = tier === "platinum";
            const plan = tier === "free" ? null : monthly.get(tier);
            const TierIcon = tier === "free" ? Radio : TIER_ICON[tier];
            const history = tier === "free" ? `${FREE_HISTORY_DAYS} days` : config[tier].historyDays ? `${config[tier].historyDays} days` : "full";
            return (
              <Card key={tier} className={cn(featured && "panel-gold ring-primary/55 shadow-[0_0_28px_-8px_rgb(245_197_66/0.55)]")}>
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <span
                      className={cn(
                        "flex size-11 shrink-0 items-center justify-center rounded-xl ring-1",
                        featured ? "bg-primary/10 text-primary ring-primary/55" : "bg-glow/10 text-[#8db6ff] ring-glow/50",
                      )}
                    >
                      <TierIcon className="size-5" />
                    </span>
                    <div>
                      <CardTitle className={cn("text-lg", featured && "gold-text")}>{tier === "free" ? "Free" : TIER_LABEL[tier]}</CardTitle>
                      <CardDescription>{TIER_PITCH[tier].tagline}</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className={cn("font-heading text-3xl font-extrabold tabular-nums tracking-tight", featured && "gold-text")}>
                    {tier === "free" ? "Free" : plan ? fmtMoney(plan.amountCents, plan.currency) : "—"}
                    {tier !== "free" && <span className="font-sans text-sm font-normal text-muted-foreground"> / month</span>}
                  </div>
                  <ul className="mt-4 space-y-1.5 text-sm">
                    {TIER_PITCH[tier].bullets.map((b) => (
                      <li key={b} className="flex gap-2">
                        <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                        <span className="text-foreground/85">{b}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-3 text-[11px] text-muted-foreground">History: {history}</div>
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
