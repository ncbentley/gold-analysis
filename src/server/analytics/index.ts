import { getDb } from "@/server/db";
import { analyticsEvents } from "@/server/db/schema";

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
    const db = await getDb();
    await db.insert(analyticsEvents).values({ name, userId, propsJson: props });
  } catch (err) {
    console.warn("[analytics] dropped event", name, (err as Error).message);
  }
}
