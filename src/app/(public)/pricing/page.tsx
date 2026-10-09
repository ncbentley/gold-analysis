import { BarChart3, CalendarClock, Package, Radio, Timer } from "lucide-react";
import type { Metadata } from "next";
import { AffiliateStrip } from "@/components/affiliate-strip";
import { PageHeader } from "@/components/page-header";
import { parsePlanParams, PlanPicker } from "@/components/plan-picker";
import { billingMode } from "@/server/billing/config";

export const metadata: Metadata = { title: "Pricing" };

const FEATURES = [
  { icon: Radio, label: "7-day trial, no card" },
  { icon: Timer, label: "Available, Active, and History" },
  { icon: BarChart3, label: "Source track records" },
  { icon: CalendarClock, label: "Cancel any time" },
];

export default async function PricingPage({ searchParams }: PageProps<"/pricing">) {
  const { period, highlight } = parsePlanParams(await searchParams);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 md:py-10">
      <PageHeader
        icon={Package}
        title="Choose your package"
        description="A 7-day trial of every signal. Basic keeps that book. Silver is every consolidated idea. Gold is a shorter list of those ideas, with the news read above the book."
        features={FEATURES}
      />

      <p className="mt-7 max-w-2xl text-sm leading-relaxed text-muted-foreground">
        Basic keeps the trial book after the week. Add a card for Silver or Gold during the trial and the rest of that week is Gold access. When the week ends, billing starts on the plan you picked.
      </p>

      <div className="mt-6">
        <PlanPicker period={period} highlight={highlight} basePath="/pricing" />
      </div>

      <div className="mt-8 space-y-1 text-center text-xs text-muted-foreground">
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
