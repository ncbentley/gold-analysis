import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/server/db";
import { runMigrations } from "@/server/db/migrate";
import { analyticsEvents, attributionTouches, userAttributions, users } from "@/server/db/schema";
import { trackEvent } from "./index";
import { identifyAttribution } from "./persist";
import type { AttributionState } from "./attribution";

const visitorId = "33333333-3333-4333-8333-333333333333";
const email = `attr-${visitorId}@example.com`;

const state: AttributionState = {
  visitorId,
  first: {
    at: "2026-10-01T00:00:00.000Z",
    landing: "/",
    referrer: "https://google.com",
    params: { utm_source: "google", utm_medium: "cpc", utm_campaign: "brand", gclid: "click-1" },
  },
  last: {
    at: "2026-10-04T00:00:00.000Z",
    landing: "/pricing",
    referrer: null,
    params: { utm_source: "newsletter", utm_medium: "email", utm_campaign: "launch", fbclid: "meta-1" },
  },
};

beforeAll(async () => {
  await runMigrations();
});

afterAll(async () => {
  const db = await getDb();
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (user) {
    await db.delete(analyticsEvents).where(eq(analyticsEvents.userId, user.id));
    await db.delete(users).where(eq(users.id, user.id));
  }
  await db.delete(attributionTouches).where(eq(attributionTouches.visitorId, visitorId));
  await closeDb();
});

describe("account attribution", () => {
  it("keeps the first touch, moves the last touch, and stamps the event", async () => {
    const db = await getDb();
    const [user] = await db.insert(users).values({ email, passwordHash: "x" }).returning();

    await identifyAttribution(user.id, state);
    await trackEvent("account_created", user.id);

    const [stored] = await db.select().from(userAttributions).where(eq(userAttributions.userId, user.id));
    expect(stored.firstTouch.params).toMatchObject({ utm_campaign: "brand", gclid: "click-1" });
    expect(stored.lastTouch.params).toMatchObject({ utm_campaign: "launch", fbclid: "meta-1" });

    const touches = await db.select().from(attributionTouches).where(eq(attributionTouches.visitorId, visitorId));
    expect(touches).toHaveLength(2);
    expect(touches.every((row) => row.userId === user.id)).toBe(true);

    const [event] = await db.select().from(analyticsEvents).where(eq(analyticsEvents.userId, user.id));
    expect(event.visitorId).toBe(visitorId);
    expect(event.propsJson).toMatchObject({
      attribution: { visitorId, last: { params: { fbclid: "meta-1" } } },
    });

    await identifyAttribution(user.id, {
      ...state,
      first: { ...state.first, params: { utm_source: "should-not-replace" } },
      last: { ...state.last, at: "2026-10-04T02:00:00.000Z", params: { utm_source: "meta", utm_medium: "paid", utm_campaign: "retarget" } },
    });
    const [updated] = await db.select().from(userAttributions).where(eq(userAttributions.userId, user.id));
    expect(updated.firstTouch.params.utm_source).toBe("google");
    expect(updated.lastTouch.params.utm_campaign).toBe("retarget");
  });
});