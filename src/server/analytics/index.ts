import { getDb } from "@/server/db";
import { analyticsEvents } from "@/server/db/schema";
import { attributionSnapshot } from "./persist";
import { capturePostHog, touchProperties } from "./posthog";

export const ANALYTICS_EVENTS = [
  "account_created",
  "checkout_started",
  "subscription_started",
  "subscription_cancelled",
  "signal_viewed",
  "source_viewed",
  "locked_section_viewed",
  "upgrade_clicked",
  "affiliate_link_clicked",
] as const;
export type AnalyticsEvent = (typeof ANALYTICS_EVENTS)[number];

/** Fire-and-forget product analytics. Failures never block the request. */
export async function trackEvent(name: AnalyticsEvent, userId: string | null, props: Record<string, unknown> = {}) {
  try {
    const attribution = await attributionSnapshot(userId);
    const db = await getDb();
    await db.insert(analyticsEvents).values({
      name,
      userId,
      visitorId: attribution?.visitorId ?? null,
      propsJson: attribution
        ? { ...props, attribution: { visitorId: attribution.visitorId, first: attribution.first, last: attribution.last } }
        : props,
    });
    const distinctId = userId ?? attribution?.visitorId ?? null;
    if (!distinctId) return;
    try {
      capturePostHog(distinctId, name, {
        ...props,
        ...touchProperties(attribution?.last ?? null, attribution?.visitorId ?? null),
      });
    } catch (err) {
      console.warn("[analytics] dropped event", name, (err as Error).message);
    }
  } catch (err) {
    console.warn("[analytics] dropped event", name, (err as Error).message);
  }
}

export type RevenueInput = {
  amountCents: number;
  currency: string;
  tier: string;
  period: string;
  provider: string;
};

/** Revenue event for a charge that billing has already accepted. Mock checkout calls this today. */
export async function trackRevenue(userId: string, input: RevenueInput) {
  if (!Number.isFinite(input.amountCents) || input.amountCents < 0) return;
  try {
    const attribution = await attributionSnapshot(userId);
    capturePostHog(userId, "invoice_paid", {
      ...touchProperties(attribution?.last ?? null, attribution?.visitorId ?? null),
      revenue: input.amountCents / 100,
      currency: input.currency.toUpperCase(),
      tier: input.tier,
      period: input.period,
      provider: input.provider,
    });
  } catch (err) {
    console.warn("[analytics] dropped event", "invoice_paid", (err as Error).message);
  }
}
