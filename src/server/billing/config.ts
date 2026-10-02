import type { BillingPeriod, Tier } from "@/server/db/schema";

/** Seed placeholders only. Live prices are read from the plans table. */
export const PLACEHOLDER_PRICES_CENTS: Record<Tier, Record<BillingPeriod, number>> = {
  silver: { weekly: 1400, monthly: 2900, annual: 29000 },
  gold: { weekly: 3000, monthly: 5900, annual: 59000 },
  platinum: { weekly: 5000, monthly: 9900, annual: 99000 },
};

export const PERIOD_DAYS: Record<BillingPeriod, number> = { weekly: 7, monthly: 30, annual: 365 };
export const PERIOD_LABEL: Record<BillingPeriod, string> = { weekly: "week", monthly: "month", annual: "year" };

/** Env var holding the Stripe price id for a plan, e.g. STRIPE_PRICE_GOLD_MONTHLY. */
export const stripePriceEnv = (tier: Tier, period: BillingPeriod) => `STRIPE_PRICE_${tier.toUpperCase()}_${period.toUpperCase()}`;

export function billingMode(): "stripe" | "mock" {
  return process.env.STRIPE_SECRET_KEY ? "stripe" : "mock";
}
