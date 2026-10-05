import { getDb } from "@/server/db";
import { analyticsEvents } from "@/server/db/schema";
import { attributionSnapshot } from "./persist";

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
  } catch (err) {
    console.warn("[analytics] dropped event", name, (err as Error).message);
  }
}
