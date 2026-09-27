import { ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { confirmMockCheckoutAction } from "@/app/actions/billing";
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
  await requireUser("/pricing");
  if (billingMode() !== "mock") notFound();
  const sp = await searchParams;
  const tier = String(sp.tier) as Tier;
  const period = String(sp.period) as BillingPeriod;
  if (!TIERS.includes(tier) || !PERIODS.includes(period)) notFound();
  const plan = await getPlan(tier, period);
  if (!plan) notFound();
  const config = await getTierConfig();

  return (
    <div className="mx-auto max-w-lg">
      <Card className="bg-card/60">
        <CardHeader>
          <CardDescription className="flex items-center gap-1.5 text-amber-300">
            <ShieldCheck className="size-4" /> Test mode · no card required
          </CardDescription>
          <CardTitle className="text-2xl">{TIER_LABEL[tier]} membership</CardTitle>
          <CardDescription>
            {fmtMoney(plan.amountCents, plan.currency)} per {PERIOD_LABEL[period]}, billed {period}. Cancel any time; access continues to the end of the paid period.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Separator className="mb-4" />
          <ul className="space-y-1.5 text-sm">
            {config[tier].features.map((f) => (
              <li key={f} className="flex gap-2">
                <span className="text-primary">✓</span> {FEATURE_CATALOG[f]}
              </li>
            ))}
          </ul>
        </CardContent>
        <CardFooter className="flex justify-between gap-2">
          <Link href="/pricing" className={buttonVariants({ variant: "ghost" })}>Back</Link>
          <form action={confirmMockCheckoutAction}>
            <input type="hidden" name="tier" value={tier} />
            <input type="hidden" name="period" value={period} />
            <Button type="submit">Start {TIER_LABEL[tier]} ({fmtMoney(plan.amountCents)})</Button>
          </form>
        </CardFooter>
      </Card>
    </div>
  );
}
