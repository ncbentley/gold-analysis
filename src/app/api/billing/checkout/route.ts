import { apiError, json } from "@/server/api";
import { getCurrentUser } from "@/server/auth";
import { startCheckout } from "@/server/billing/service";
import { PERIODS, TIERS, type BillingPeriod, type Tier } from "@/server/db/schema";

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return apiError(401, "unauthenticated", "Sign in to subscribe.");
  if (!user.emailVerifiedAt) return apiError(403, "email_unverified", "Verify your email before subscribing.");
  const body = await req.json().catch(() => ({}));
  const tier = String(body.tier ?? "");
  const period = String(body.period ?? "");
  if (!(TIERS as readonly string[]).includes(tier) || !(PERIODS as readonly string[]).includes(period)) {
    return apiError(400, "invalid_plan", "Unknown tier or billing period.");
  }
  if (tier === "gold" && period === "weekly") return apiError(400, "invalid_plan", "Gold weekly is no longer offered.");
  try {
    const { url } = await startCheckout(user, tier as Tier, period as BillingPeriod);
    return json({ url });
  } catch (err) {
    return apiError(400, "checkout_failed", (err as Error).message);
  }
}
