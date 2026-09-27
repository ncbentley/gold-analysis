import { apiError, json } from "@/server/api";
import { getStripe, handleStripeEvent } from "@/server/billing/service";

/** Stripe webhook. Requires STRIPE_WEBHOOK_SECRET; the raw body is verified before anything is processed. */
export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !process.env.STRIPE_SECRET_KEY) return apiError(503, "billing_not_configured", "Stripe webhooks are not configured.");
  const signature = req.headers.get("stripe-signature");
  if (!signature) return apiError(400, "missing_signature", "Missing Stripe signature.");
  const payload = await req.text();
  const stripe = await getStripe();
  let event;
  try {
    event = await stripe.webhooks.constructEventAsync(payload, signature, secret);
  } catch {
    return apiError(400, "invalid_signature", "Signature verification failed.");
  }
  try {
    await handleStripeEvent(event);
  } catch (err) {
    console.error("[billing] webhook handling failed", event.type, (err as Error).message);
    return apiError(500, "handler_failed", "Event could not be processed; Stripe will retry.");
  }
  return json({ received: true });
}
