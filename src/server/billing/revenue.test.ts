import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { getDb, closeDb } from "@/server/db";
import { runMigrations } from "@/server/db/migrate";
import { analyticsEvents, plans, users } from "@/server/db/schema";
import { installAnalyticsSender } from "@/server/analytics/posthog";
import { completeMockCheckout } from "./service";

beforeAll(async () => {
  await runMigrations();
});

afterEach(() => {
  installAnalyticsSender(null);
  delete process.env.POSTHOG_API_KEY;
  delete process.env.STRIPE_SECRET_KEY;
});

afterAll(async () => {
  await closeDb();
});

describe("completeMockCheckout revenue", () => {
  it("sends invoice_paid from the plan price and leaves subscription_started without an amount", async () => {
    delete process.env.STRIPE_SECRET_KEY;
    const events: { distinctId: string; event: string; properties: Record<string, unknown> }[] = [];
    installAnalyticsSender({
      capture(event) {
        events.push(event);
      },
      alias() {},
      setPerson() {},
    });
    process.env.POSTHOG_API_KEY = "phc_test";

    const db = await getDb();
    await db
      .insert(plans)
      .values({ tier: "silver", period: "monthly", amountCents: 2900, currency: "usd", active: true })
      .onConflictDoUpdate({ target: [plans.tier, plans.period], set: { amountCents: 2900, currency: "usd", active: true } });
    const [user] = await db.insert(users).values({ email: `mock-${crypto.randomUUID()}@example.com`, passwordHash: "x" }).returning();

    await completeMockCheckout(user.id, "silver", "monthly");

    const started = events.find((event) => event.event === "subscription_started");
    const paid = events.find((event) => event.event === "invoice_paid");
    expect(started?.properties).not.toHaveProperty("revenue");
    expect(paid).toMatchObject({
      distinctId: user.id,
      properties: { revenue: 29, currency: "USD", tier: "silver", period: "monthly", provider: "mock" },
    });
    await db.delete(analyticsEvents).where(eq(analyticsEvents.userId, user.id));
    await db.delete(users).where(eq(users.id, user.id));
  });
});
