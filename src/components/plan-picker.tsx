import { Check, Flame } from "lucide-react";
import Link from "next/link";
import { checkoutAction } from "@/app/actions/billing";
import { TIER_ICON } from "@/components/signal-bits";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { fmtMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PERIOD_LABEL } from "@/server/billing/config";
import { listPlans } from "@/server/billing/service";
import { PERIODS, type BillingPeriod, type Tier } from "@/server/db/schema";
import { FEATURE_CATALOG, TIER_LABEL, TIER_ORDER } from "@/server/entitlements/config";
import { getViewer } from "@/server/entitlements/service";

const TAGLINE: Record<Tier, string> = {
  silver: "Live signals with final results",
  gold: "Source performance and how a zone lines up in time",
  platinum: "Anonymized consensus, full history and AI analysis",
};

const PERIOD_TITLE: Record<BillingPeriod, string> = { weekly: "Weekly", monthly: "Monthly", annual: "Annual" };

export function parsePlanParams(sp: Record<string, string | string[] | undefined>, fallback?: { tier?: string; period?: BillingPeriod }) {
  const period = (PERIODS as readonly string[]).includes(String(sp.period)) ? (sp.period as BillingPeriod) : (fallback?.period ?? "monthly");
  const highlight = typeof sp.tier === "string" ? sp.tier : (fallback?.tier ?? "platinum");
  return { period, highlight };
}

/** Period tabs and tier cards; tab links stay on `basePath` so the picker can live on any page. */
export async function PlanPicker({ period, highlight, basePath, anchor }: { period: BillingPeriod; highlight: string; basePath: string; anchor?: string }) {
  const { user, config, subscription } = await getViewer();
  const offeredTiers = TIER_ORDER.filter((tier) => tier !== "gold");
  const plans = (await listPlans()).filter((plan) => plan.tier !== "gold" && !(plan.tier === "platinum" && plan.period === "weekly"));
  const byKey = new Map(plans.map((p) => [`${p.tier}:${p.period}`, p]));
  const monthlyCents = (tier: Tier) => byKey.get(`${tier}:monthly`)?.amountCents ?? 0;

  return (
    <>
      <div className="flex justify-center">
        <div className="inline-flex gap-1 rounded-xl bg-[#0a1630]/80 p-1 ring-1 ring-glow/35" role="tablist" aria-label="Billing period">
          {PERIODS.map((p) => (
            <Link
              key={p}
              href={`${basePath}?period=${p}&tier=${highlight}${anchor ? `#${anchor}` : ""}`}
              role="tab"
              aria-selected={p === period}
              scroll={false}
              className={cn(
                "rounded-lg px-5 py-1.5 text-sm font-medium transition-all duration-200",
                p === period ? "gold-fill font-semibold shadow-[0_0_16px_-4px_rgb(245_197_66/0.7)]" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {PERIOD_TITLE[p]}
            </Link>
          ))}
        </div>
      </div>

      <div className="mt-7 grid gap-5 lg:grid-cols-2">
        {offeredTiers.map((tier, i) => {
          const plan = byKey.get(`${tier}:${period}`);
          const prev = i > 0 ? new Set(config[offeredTiers[i - 1]].features) : new Set<string>();
          const added = config[tier].features.filter((f) => !prev.has(f));
          const isCurrent = subscription?.tier === tier && subscription.period === period;
          const saving = plan && period === "annual" ? 1 - plan.amountCents / (monthlyCents(tier) * 12) : 0;
          const lit = highlight === tier;
          const TierIcon = TIER_ICON[tier];
          return (
            <Card
              key={tier}
              className={cn(
                "relative rounded-2xl [--card-spacing:--spacing(5)]",
                lit && "panel-gold shadow-[0_0_36px_-8px_rgb(245_197_66/0.6)] ring-2 ring-primary/65",
              )}
            >
              {tier === "platinum" && (
                <span className="gold-fill absolute right-4 top-4 inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold shadow-[0_0_14px_-3px_rgb(245_197_66/0.7)]">
                  <Flame className="size-3.5" />
                  Most popular
                </span>
              )}
              <CardHeader>
                <div className={cn("flex items-center gap-3.5", tier === "platinum" && "pr-28")}>
                  <span
                    className={cn(
                      "flex size-12 shrink-0 items-center justify-center rounded-full ring-2",
                      lit ? "bg-black/40 text-primary ring-primary/70 shadow-[0_0_18px_-2px_rgb(245_197_66/0.6)]" : "bg-glow/10 text-[#8db6ff] ring-glow/55 shadow-[0_0_16px_-4px_rgb(47_123_255/0.6)]",
                    )}
                  >
                    <TierIcon className="size-6" />
                  </span>
                  <CardTitle className={cn("font-heading text-2xl font-extrabold", lit && "gold-text")}>{TIER_LABEL[tier]}</CardTitle>
                </div>
                <CardDescription className="mt-1 min-h-10 text-foreground/75">{TAGLINE[tier]}</CardDescription>
              </CardHeader>
              <CardContent className="flex-1">
                {plan ? (
                  <div>
                    <span className={cn("font-heading text-5xl font-extrabold tabular-nums tracking-tight", lit && "gold-text")}>{fmtMoney(plan.amountCents, plan.currency)}</span>
                    <span className="text-lg font-medium text-muted-foreground"> / {PERIOD_LABEL[period]}</span>
                    {saving > 0.01 && <div className="mt-1.5 text-xs font-semibold text-win">Save {Math.round(saving * 100)}% compared with monthly</div>}
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground">Not offered for this period.</div>
                )}
                <div className="mt-5 border-t border-glow/15 pt-4 text-xs font-semibold text-primary/85">
                  {i === 0 ? "Includes" : `Everything in ${TIER_LABEL[offeredTiers[i - 1]]}, plus`}
                </div>
                <ul className="mt-2.5 space-y-2 text-sm">
                  {added.map((f) => (
                    <li key={f} className="flex gap-2.5">
                      <CheckDot />
                      <span className="text-foreground/90">{FEATURE_CATALOG[f]}</span>
                    </li>
                  ))}
                  <li className="flex gap-2.5">
                    <CheckDot />
                    <span className="text-foreground/90">{config[tier].historyDays ? `${config[tier].historyDays} days of signal history` : "Unlimited signal history"}</span>
                  </li>
                </ul>
              </CardContent>
              <CardFooter className="border-t-0 bg-transparent pt-2">
                {plan && plan.active ? (
                  <form action={checkoutAction} className="w-full">
                    <input type="hidden" name="tier" value={tier} />
                    <input type="hidden" name="period" value={period} />
                    <Button type="submit" size="lg" className="w-full" variant={lit ? "default" : "secondary"} disabled={isCurrent}>
                      {!isCurrent && <TierIcon />}
                      {isCurrent ? "Your current plan" : user ? `Choose ${TIER_LABEL[tier]}` : `Start with ${TIER_LABEL[tier]}`}
                    </Button>
                  </form>
                ) : (
                  <Button size="lg" className="w-full" variant="outline" disabled>
                    Unavailable
                  </Button>
                )}
              </CardFooter>
            </Card>
          );
        })}
      </div>
    </>
  );
}

function CheckDot() {
  return (
    <span className="mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-full bg-win/15 text-win ring-1 ring-win/45">
      <Check className="size-3" strokeWidth={3} />
    </span>
  );
}
