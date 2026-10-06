import { ArrowRight, BarChart3, Radio, Timer } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { AffiliateStrip } from "@/components/affiliate-strip";
import { SignalList } from "@/components/signal-list";
import { TopSources } from "@/components/top-sources";
import { buttonVariants } from "@/components/ui/button";
import { fmtMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { listPlans } from "@/server/billing/service";
import { FREE_HISTORY_DAYS, TIER_LABEL } from "@/server/entitlements/config";
import { getTierConfig } from "@/server/entitlements/service";
import { listPublicSampleSignals, listSources } from "@/server/signals/queries";
import { getTopSources } from "@/server/statistics/service";
import type { Tier } from "@/server/db/schema";

export const dynamic = "force-dynamic";

const PAID: Tier[] = ["silver", "gold"];

const BOOK_COPY: Record<"trial" | Tier, string> = {
  trial: `Every valid signal, for ${FREE_HISTORY_DAYS} days, with no card. When the week ends and no plan is chosen, the book locks.`,
  silver: "Nearby calls are averaged into one idea. The model does not add, edit, or close these.",
  gold: "A shorter list from the Silver ideas. The news read sits above the book. Each row is the idea: direction, zone, stop, targets, and how many sources agreed.",
};

function planLines(tier: Tier, historyDays: number | null): string[] {
  const history = historyDays ? `${historyDays} days of history` : "Full history";
  if (tier === "silver") return ["Nearby calls averaged into one idea", history];
  return ["The news read above the book", "A shorter list from the Silver ideas", "Direction, zone, stop, targets, and how many sources agreed", history];
}

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

function historyLabel(days: number | null) {
  return days ? `${days} days` : "Full history";
}

export default async function LandingPage() {
  const config = await getTierConfig();
  const [samples, sources, plans] = await Promise.all([listPublicSampleSignals(config), listSources(), listPlans()]);
  const { top, eligibleCount, sourceCount, totalClosed } = await getTopSources(sources.map((s) => s.id));
  const monthly = new Map(plans.filter((p) => p.period === "monthly").map((p) => [p.tier, p]));

  const books = [
    { key: "trial" as const, name: "Trial", window: historyLabel(FREE_HISTORY_DAYS), body: BOOK_COPY.trial },
    { key: "silver" as const, name: TIER_LABEL.silver, window: historyLabel(config.silver.historyDays), body: BOOK_COPY.silver },
    { key: "gold" as const, name: TIER_LABEL.gold, window: historyLabel(config.gold.historyDays), body: BOOK_COPY.gold },
  ];

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
              A smaller gold book at every step.
            </h1>
            <p className="mt-5 max-w-xl text-pretty text-lg leading-relaxed text-foreground/85">
              A new account gets {FREE_HISTORY_DAYS} days of every gold signal. Silver turns nearby calls into one idea. Gold keeps a shorter list from that set, with the news read above the book.
              Channels stay unnamed. The same rules every time.
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

      <section id="ladder" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-16">
        <h2 className="font-heading text-2xl font-bold tracking-tight">Three books</h2>
        <p className="mt-2 max-w-2xl text-pretty text-muted-foreground">Available, Active, and History. The same three sections on every book. Each step up is a smaller set.</p>
        <ol className="mt-8 space-y-3">
          {books.map((book) => {
            const featured = book.key === "gold";
            return (
              <li
                key={book.key}
                className={cn(
                  "grid gap-2 rounded-2xl px-5 py-6 md:grid-cols-[8.5rem_minmax(0,1fr)_8rem] md:items-baseline md:gap-8",
                  featured ? "panel-gold ring-1 ring-primary/55" : "ring-1 ring-primary/18",
                )}
              >
                <h3 className={cn("font-heading text-2xl font-extrabold tracking-tight", featured && "gold-text")}>{book.name}</h3>
                <p className="max-w-xl text-sm leading-relaxed text-foreground/85">{book.body}</p>
                <p className="font-heading text-sm font-semibold text-muted-foreground md:text-right">{book.window}</p>
              </li>
            );
          })}
        </ol>
      </section>

      <section className="border-y border-primary/15 bg-[#050c1c]/60">
        <div className="mx-auto max-w-6xl px-4 py-16">
          <h2 className="font-heading text-2xl font-bold tracking-tight">Top sources</h2>
          <p className="mt-2 max-w-2xl text-muted-foreground">
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

          <h2 className="mb-1 mt-14 font-heading text-lg font-bold tracking-tight">Sample of recently closed signals</h2>
          <p className="text-sm text-muted-foreground">Shown with a one-week delay. Members see signals as they are published.</p>
          <div className="mt-4">
            <SignalList items={samples} empty="Closed signals will appear here once the first trades complete." />
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16">
        <h2 className="font-heading text-2xl font-bold tracking-tight">How a result is recorded</h2>
        <p className="mt-3 max-w-2xl text-pretty leading-relaxed text-muted-foreground">
          Every post is stored as it was published, and later edits stay beside the original. Each signal is replayed against XAU/USD one-minute bars, with versioned rules for fills, targets, and stops. A recorded result can be recomputed from those records.
        </p>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-16">
        <h2 className="font-heading text-2xl font-bold tracking-tight">Plans</h2>
        <p className="mt-2 max-w-2xl text-pretty text-muted-foreground">
          Create an account for {FREE_HISTORY_DAYS} days of every signal. No card. Monthly prices are below. Weekly and annual billing are on the pricing page.
        </p>
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          {PAID.map((tier) => {
            const featured = tier === "gold";
            const plan = monthly.get(tier);
            return (
              <article
                key={tier}
                className={cn(
                  "flex flex-col rounded-2xl px-6 py-6",
                  featured ? "panel-gold ring-1 ring-primary/55" : "ring-1 ring-primary/18",
                )}
              >
                <h3 className={cn("font-heading text-2xl font-extrabold tracking-tight", featured && "gold-text")}>{TIER_LABEL[tier]}</h3>
                <p className="mt-1 text-sm text-foreground/75">{tier === "gold" ? "The news read, above a shorter list of ideas." : "Every consolidated idea."}</p>
                <p className={cn("mt-5 font-heading text-4xl font-extrabold tabular-nums tracking-tight", featured && "gold-text")}>
                  {plan ? fmtMoney(plan.amountCents, plan.currency) : "—"}
                  <span className="font-sans text-sm font-normal text-muted-foreground"> / month</span>
                </p>
                <ul className="mt-5 space-y-1.5 text-sm">
                  {planLines(tier, config[tier].historyDays).map((line) => (
                    <li key={line} className="text-foreground/85">
                      {line}
                    </li>
                  ))}
                </ul>
                <Link href={`/pricing?tier=${tier}&period=monthly`} className="mt-6 text-sm font-semibold text-primary hover:underline">
                  See {TIER_LABEL[tier]} pricing
                </Link>
              </article>
            );
          })}
        </div>
        <p className="mt-6 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Add a card for Silver or Gold during those {FREE_HISTORY_DAYS} days and the rest of the trial is Gold access. When the week ends, billing starts on the plan you picked. Cancel any time. Access continues until the end of the paid period.
        </p>
        <div className="mt-6">
          <Link href="/signup" className={cn(buttonVariants({ size: "lg" }), "px-6")}>
            Create an account <ArrowRight />
          </Link>
        </div>
        <div className="mt-14">
          <AffiliateStrip placement="landing" />
        </div>
      </section>
    </>
  );
}
