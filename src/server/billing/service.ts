import { and, desc, eq, gt, inArray, lte } from "drizzle-orm";
import type Stripe from "stripe";
import { recordAudit, SYSTEM, type Actor } from "@/server/audit";
import { appUrl } from "@/server/auth";
import { getDb } from "@/server/db";
import { plans, subscriptions, users, type BillingPeriod, type Subscription, type Tier } from "@/server/db/schema";
import { trackEvent } from "@/server/analytics";
import { billingMode, PERIOD_DAYS } from "./config";

const ENTITLED_STATUSES = ["active", "trialing", "past_due"] as const;

let stripeClient: Stripe | null = null;
export async function getStripe(): Promise<Stripe> {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error("Stripe is not configured");
  if (!stripeClient) {
    const { default: StripeCtor } = await import("stripe");
    stripeClient = new StripeCtor(process.env.STRIPE_SECRET_KEY);
  }
  return stripeClient;
}

export async function listPlans() {
  const db = await getDb();
  return db.select().from(plans).where(eq(plans.active, true));
}

export async function getPlan(tier: Tier, period: BillingPeriod) {
  const db = await getDb();
  const [row] = await db.select().from(plans).where(and(eq(plans.tier, tier), eq(plans.period, period)));
  return row ?? null;
}

/**
 * The subscription that currently grants access. Cancelled subscriptions keep access
 * until the end of the paid period (configured rule: access_until_period_end).
 */
export async function getEntitledSubscription(userId: string, now = new Date()): Promise<Subscription | null> {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.userId, userId),
        inArray(subscriptions.status, [...ENTITLED_STATUSES]),
        gt(subscriptions.currentPeriodEnd, now),
      ),
    )
    .orderBy(desc(subscriptions.currentPeriodEnd))
    .limit(1);
  return row ?? null;
}

export async function listUserSubscriptions(userId: string) {
  const db = await getDb();
  return db.select().from(subscriptions).where(eq(subscriptions.userId, userId)).orderBy(desc(subscriptions.createdAt));
}

export async function startCheckout(user: { id: string; email: string }, tier: Tier, period: BillingPeriod) {
  const plan = await getPlan(tier, period);
  if (!plan || !plan.active) throw new Error("Plan not available");
  await trackEvent("checkout_started", user.id, { tier, period, mode: billingMode() });

  if (billingMode() === "mock") {
    return { url: `/billing/mock-checkout?tier=${tier}&period=${period}` };
  }
  if (!plan.providerPriceId) throw new Error(`No Stripe price configured for ${tier}/${period}`);
  const stripe = await getStripe();
  const existing = await getEntitledSubscription(user.id);
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: plan.providerPriceId, quantity: 1 }],
    customer: existing?.providerCustomerId ?? undefined,
    customer_email: existing?.providerCustomerId ? undefined : user.email,
    client_reference_id: user.id,
    metadata: { userId: user.id, tier, period },
    subscription_data: { metadata: { userId: user.id, tier, period } },
    success_url: `${appUrl()}/billing?checkout=success`,
    cancel_url: `${appUrl()}/pricing?checkout=cancelled`,
  });
  return { url: session.url! };
}

/** Local test-mode checkout. Replaces any current subscription (upgrade/downgrade immediately). */
export async function completeMockCheckout(userId: string, tier: Tier, period: BillingPeriod) {
  if (billingMode() !== "mock") throw new Error("Mock checkout is disabled when Stripe is configured");
  const db = await getDb();
  const now = new Date();
  const current = await getEntitledSubscription(userId);
  if (current) {
    await db.update(subscriptions).set({ status: "canceled", canceledAt: now, currentPeriodEnd: now }).where(eq(subscriptions.id, current.id));
  }
  const [sub] = await db
    .insert(subscriptions)
    .values({
      userId,
      tier,
      period,
      status: "active",
      provider: "mock",
      providerCustomerId: `mock_cus_${userId.slice(0, 8)}`,
      providerSubscriptionId: `mock_sub_${crypto.randomUUID()}`,
      currentPeriodEnd: new Date(now.getTime() + PERIOD_DAYS[period] * 86_400_000),
    })
    .returning();
  await recordAudit({ actor: { userId, label: "member" }, entityType: "subscription", entityId: sub.id, action: "subscription.started", after: { tier, period, provider: "mock" } });
  await trackEvent("subscription_started", userId, { tier, period, provider: "mock" });
  return sub;
}

export async function setCancelAtPeriodEnd(userId: string, cancel: boolean, actor: Actor) {
  const sub = await getEntitledSubscription(userId);
  if (!sub) throw new Error("No active subscription");
  const db = await getDb();
  if (sub.provider === "stripe" && sub.providerSubscriptionId) {
    const stripe = await getStripe();
    await stripe.subscriptions.update(sub.providerSubscriptionId, { cancel_at_period_end: cancel });
  }
  await db.update(subscriptions).set({ cancelAtPeriodEnd: cancel, canceledAt: cancel ? new Date() : null }).where(eq(subscriptions.id, sub.id));
  await recordAudit({ actor, entityType: "subscription", entityId: sub.id, action: cancel ? "subscription.cancel_scheduled" : "subscription.resumed" });
  if (cancel) await trackEvent("subscription_cancelled", userId, { tier: sub.tier, period: sub.period });
}

export async function openBillingPortal(userId: string) {
  const sub = await getEntitledSubscription(userId);
  if (billingMode() === "mock" || !sub?.providerCustomerId || sub.provider !== "stripe") return { url: "/billing" };
  const stripe = await getStripe();
  const session = await stripe.billingPortal.sessions.create({ customer: sub.providerCustomerId, return_url: `${appUrl()}/billing` });
  return { url: session.url };
}

function mapStripeStatus(s: string): Subscription["status"] {
  if (s === "active" || s === "trialing" || s === "past_due") return s;
  if (s === "canceled" || s === "unpaid" || s === "incomplete_expired") return "canceled";
  return "incomplete";
}

/** Upserts local state from a Stripe subscription object. */
export async function syncStripeSubscription(sub: Stripe.Subscription) {
  const db = await getDb();
  const item = sub.items.data[0];
  const priceId = item?.price.id;
  const [plan] = priceId ? await db.select().from(plans).where(eq(plans.providerPriceId, priceId)) : [];
  const tier = (plan?.tier ?? sub.metadata?.tier) as Tier | undefined;
  const period = (plan?.period ?? sub.metadata?.period) as BillingPeriod | undefined;
  let userId = sub.metadata?.userId;
  if (!userId) {
    const [existing] = await db.select().from(subscriptions).where(eq(subscriptions.providerSubscriptionId, sub.id));
    userId = existing?.userId;
  }
  if (!userId || !tier || !period) throw new Error(`Cannot map Stripe subscription ${sub.id}`);
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId));
  if (!user) throw new Error(`Unknown user for Stripe subscription ${sub.id}`);

  const periodEndSec =
    (item as unknown as { current_period_end?: number })?.current_period_end ??
    (sub as unknown as { current_period_end?: number }).current_period_end ??
    Math.floor(Date.now() / 1000);
  const values = {
    userId,
    tier,
    period,
    status: mapStripeStatus(sub.status),
    provider: "stripe" as const,
    providerCustomerId: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
    providerSubscriptionId: sub.id,
    currentPeriodEnd: new Date(periodEndSec * 1000),
    cancelAtPeriodEnd: sub.cancel_at_period_end,
    canceledAt: sub.canceled_at ? new Date(sub.canceled_at * 1000) : null,
  };
  await db
    .insert(subscriptions)
    .values(values)
    .onConflictDoUpdate({ target: subscriptions.providerSubscriptionId, set: values });
  return values;
}

export async function handleStripeEvent(event: Stripe.Event) {
  const stripe = await getStripe();
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.subscription) {
        const sub = await stripe.subscriptions.retrieve(typeof session.subscription === "string" ? session.subscription : session.subscription.id);
        const v = await syncStripeSubscription(sub);
        await trackEvent("subscription_started", v.userId, { tier: v.tier, period: v.period, provider: "stripe" });
      }
      break;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      await syncStripeSubscription(event.data.object as Stripe.Subscription);
      break;
    default:
      break;
  }
}

/**
 * Periodic reconciliation. Mock subscriptions renew or expire at period end;
 * Stripe subscriptions are refreshed from the API.
 */
export async function reconcileSubscriptions(now = new Date()) {
  const db = await getDb();
  const due = await db
    .select()
    .from(subscriptions)
    .where(and(inArray(subscriptions.status, [...ENTITLED_STATUSES]), lte(subscriptions.currentPeriodEnd, now)));
  let renewed = 0;
  let expired = 0;
  for (const sub of due) {
    if (sub.provider === "mock") {
      if (sub.cancelAtPeriodEnd) {
        await db.update(subscriptions).set({ status: "expired" }).where(eq(subscriptions.id, sub.id));
        expired++;
      } else {
        await db
          .update(subscriptions)
          .set({ currentPeriodEnd: new Date(sub.currentPeriodEnd.getTime() + PERIOD_DAYS[sub.period] * 86_400_000) })
          .where(eq(subscriptions.id, sub.id));
        renewed++;
      }
    } else if (sub.providerSubscriptionId && process.env.STRIPE_SECRET_KEY) {
      const stripe = await getStripe();
      await syncStripeSubscription(await stripe.subscriptions.retrieve(sub.providerSubscriptionId));
    }
  }
  if (renewed || expired) await recordAudit({ actor: SYSTEM, entityType: "subscription", entityId: "*", action: "subscription.reconciled", after: { renewed, expired } });
  return { renewed, expired };
}
