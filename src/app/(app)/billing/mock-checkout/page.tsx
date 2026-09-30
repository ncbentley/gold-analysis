import { Check, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { confirmMockCheckoutAction } from "@/app/actions/billing";
import { TIER_ICON } from "@/components/signal-bits";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { fmtMoney } from "@/lib/format";
import { requireUser } from "@/server/auth/guards";
import { billingMode, PERIOD_LABEL } from "@/server/billing/config";
import { getPlan } from "@/server/billing/service";
import { PERIODS, TIERS, type BillingPeriod, type Tier } from "@/server/db/schema";
import { FEATURE_CATALOG, TIER_LABEL } from "@/server/entitlements/config";
import { getTierConfig } from "@/server/entitlements/service";

export const metadata: Metadata = { title: "Checkout (test mode)" };


export default async function MockCheckoutPage({ searchParams }: PageProps<"/billing/mock-checkout">) {
  await requireUser("/billing");
  if (billingMode() !== "mock") notFound();
  const sp = await searchParams;
  const tier = String(sp.tier) as Tier;
  const period = String(sp.period) as BillingPeriod;
  if (!TIERS.includes(tier) || !PERIODS.includes(period)) notFound();
  const plan = await getPlan(tier, period);
  if (!plan) notFound();
  const config = await getTierConfig();
  const TierIcon = TIER_ICON[tier];

  return (
    <div className="mx-auto max-w-lg py-4">
      <Card className="panel-gold rounded-2xl shadow-[0_0_32px_-8px_rgb(245_197_66/0.55)] ring-primary/55 [--card-spacing:--spacing(6)]">
        <CardHeader>
          <CardDescription className="inline-flex w-fit items-center gap-1.5 rounded-full border border-amber-400/40 bg-amber-400/10 px-2.5 py-0.5 text-xs font-semibold text-amber-300">
            <ShieldCheck className="size-3.5" /> Test mode · no card required
          </CardDescription>
          <div className="mt-3 flex items-center gap-3.5">
            <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-black/40 text-primary shadow-[0_0_18px_-2px_rgb(245_197_66/0.6)] ring-2 ring-primary/70">
              <TierIcon className="size-6" />
            </span>
            <CardTitle className="gold-text text-2xl font-extrabold">{TIER_LABEL[tier]} membership</CardTitle>
          </div>
          <CardDescription className="mt-2 text-foreground/75">
            {fmtMoney(plan.amountCents, plan.currency)} per {PERIOD_LABEL[period]}, billed {period}. Cancel any time; access continues to the end of the paid period.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Separator className="mb-4 bg-primary/20" />
          <ul className="space-y-2 text-sm">
            {config[tier].features.map((f) => (
              <li key={f} className="flex gap-2.5">
                <span className="mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-full bg-win/15 text-win ring-1 ring-win/45">
                  <Check className="size-3" strokeWidth={3} />
                </span>
                <span className="text-foreground/90">{FEATURE_CATALOG[f]}</span>
              </li>
            ))}
          </ul>
        </CardContent>
        <CardFooter className="flex justify-between gap-2 border-primary/20">
          <Link href={`/billing?tier=${tier}&period=${period}#plans`} className={buttonVariants({ variant: "ghost" })}>Back</Link>
          <form action={confirmMockCheckoutAction}>
            <input type="hidden" name="tier" value={tier} />
            <input type="hidden" name="period" value={period} />
            <Button type="submit" size="lg">
              <TierIcon />
              Start {TIER_LABEL[tier]} ({fmtMoney(plan.amountCents)})
            </Button>
          </form>
        </CardFooter>
      </Card>
    </div>
  );
}
