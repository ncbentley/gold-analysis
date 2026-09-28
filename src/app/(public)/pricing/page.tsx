import { Check } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { checkoutAction } from "@/app/actions/billing";
import { AffiliateStrip } from "@/components/affiliate-strip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { fmtMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { billingMode, PERIOD_LABEL } from "@/server/billing/config";
import { listPlans } from "@/server/billing/service";
import { PERIODS, type BillingPeriod, type Tier } from "@/server/db/schema";
import { FEATURE_CATALOG, TIER_LABEL, TIER_ORDER } from "@/server/entitlements/config";
import { getViewer } from "@/server/entitlements/service";

export const metadata: Metadata = { title: "Pricing" };

const TAGLINE: Record<Tier, string> = {
  silver: "Live signals with final results",
  gold: "Source performance and trade quality",
  platinum: "Full history, AI analysis and research tools",
};

const PERIOD_TITLE: Record<BillingPeriod, string> = { weekly: "Weekly", monthly: "Monthly", annual: "Annual" };

export default async function PricingPage({ searchParams }: PageProps<"/pricing">) {
  const sp = await searchParams;
  const period = (PERIODS as readonly string[]).includes(String(sp.period)) ? (sp.period as BillingPeriod) : "monthly";
  const highlight = typeof sp.tier === "string" ? sp.tier : "gold";
  const { user, config, subscription } = await getViewer();
  const plans = await listPlans();
  const byKey = new Map(plans.map((p) => [`${p.tier}:${p.period}`, p]));
  const monthlyCents = (tier: Tier) => byKey.get(`${tier}:monthly`)?.amountCents ?? 0;

  return (
    <div className="mx-auto max-w-6xl px-4 py-14">
      <div className="max-w-2xl">
        <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">Pricing</h1>
        <p className="mt-3 text-muted-foreground">
          Choose how deep you want to go. Every plan includes the same live signals; higher tiers add the analysis around them.
        </p>
      </div>

      <div className="mt-8 inline-flex rounded-lg border bg-card/60 p-1" role="tablist" aria-label="Billing period">
        {PERIODS.map((p) => (
          <Link
            key={p}
            href={`/pricing?period=${p}${highlight ? `&tier=${highlight}` : ""}`}
            role="tab"
            aria-selected={p === period}
            scroll={false}
            className={cn("rounded-md px-4 py-1.5 text-sm transition-colors", p === period ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
          >
            {PERIOD_TITLE[p]}
          </Link>
        ))}
      </div>

      <div className="mt-8 grid gap-4 lg:grid-cols-3">
        {TIER_ORDER.map((tier, i) => {
          const plan = byKey.get(`${tier}:${period}`);
          const prev = i > 0 ? new Set(config[TIER_ORDER[i - 1]].features) : new Set<string>();
          const added = config[tier].features.filter((f) => !prev.has(f));
          const isCurrent = subscription?.tier === tier && subscription.period === period;
          const saving = plan && period === "annual" ? 1 - plan.amountCents / (monthlyCents(tier) * 12) : 0;
          return (
            <Card key={tier} className={cn("bg-card/60", highlight === tier && "ring-2 ring-primary/60")}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className={cn("text-lg", tier === "gold" && "gold-text")}>{TIER_LABEL[tier]}</CardTitle>
                  {tier === "gold" && <Badge variant="outline" className="border-primary/40 text-primary">Most popular</Badge>}
                </div>
                <CardDescription>{TAGLINE[tier]}</CardDescription>
              </CardHeader>
              <CardContent className="flex-1">
                {plan ? (
                  <div>
                    <span className="text-3xl font-semibold">{fmtMoney(plan.amountCents, plan.currency)}</span>
                    <span className="text-muted-foreground"> / {PERIOD_LABEL[period]}</span>
                    {saving > 0.01 && <div className="mt-1 text-xs text-win">Save {Math.round(saving * 100)}% compared with monthly</div>}
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground">Not offered for this period.</div>
                )}
                <div className="mt-5 text-xs font-medium uppercase tracking-wider text-muted-foreground">{i === 0 ? "Includes" : `Everything in ${TIER_LABEL[TIER_ORDER[i - 1]]}, plus`}</div>
                <ul className="mt-2 space-y-2 text-sm">
                  {added.map((f) => (
                    <li key={f} className="flex gap-2">
                      <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                      <span>{FEATURE_CATALOG[f]}</span>
                    </li>
                  ))}
                  <li className="flex gap-2">
                    <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                    <span>{config[tier].historyDays ? `${config[tier].historyDays} days of signal history` : "Unlimited signal history"}</span>
                  </li>
                </ul>
              </CardContent>
              <CardFooter>
                {plan && plan.active ? (
                  <form action={checkoutAction} className="w-full">
                    <input type="hidden" name="tier" value={tier} />
                    <input type="hidden" name="period" value={period} />
                    <Button type="submit" className="w-full" variant={highlight === tier ? "default" : "outline"} disabled={isCurrent}>
                      {isCurrent ? "Your current plan" : user ? `Choose ${TIER_LABEL[tier]}` : `Start with ${TIER_LABEL[tier]}`}
                    </Button>
                  </form>
                ) : (
                  <Button className="w-full" variant="outline" disabled>
                    Unavailable
                  </Button>
                )}
              </CardFooter>
            </Card>
          );
        })}
      </div>

      <div className="mt-6 space-y-1 text-xs text-muted-foreground">
        <p>Prices in USD. Subscriptions renew automatically until cancelled; cancelling keeps access until the end of the paid period.</p>
        {billingMode() === "mock" && <p className="text-amber-300/80">Billing is running in test mode. Checkout completes without a real payment.</p>}
        <p>Signals and statistics are general information, not personal financial advice. Past results do not guarantee future performance.</p>
      </div>

      <div className="mt-10">
        <AffiliateStrip placement="pricing" />
      </div>
    </div>
  );
}
