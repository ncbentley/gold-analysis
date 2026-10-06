import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/server/db";
import { runMigrations } from "@/server/db/migrate";
import { analyticsEvents, users } from "@/server/db/schema";
import type { AttributionState } from "./attribution";
import { trackEvent, trackRevenue } from "./index";
import { identifyAttribution } from "./persist";
import {
  capturePostHog,
  installAnalyticsSender,
  personProperties,
  posthogHost,
  touchProperties,
  type AnalyticsSender,
} from "./posthog";

const state: AttributionState = {
  visitorId: "33333333-3333-4333-8333-333333333333",
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
  await closeDb();
});

afterEach(() => {
  installAnalyticsSender(null);
  delete process.env.POSTHOG_API_KEY;
  delete process.env.POSTHOG_HOST;
});

function recordSender() {
  const events: { distinctId: string; event: string; properties: Record<string, unknown> }[] = [];
  const aliases: { userId: string; visitorId: string }[] = [];
  const people: { userId: string; setOnce: Record<string, string | null>; set: Record<string, string | null> }[] = [];
  const sender: AnalyticsSender = {
    capture(event) {
      events.push(event);
    },
    alias(userId, visitorId) {
      aliases.push({ userId, visitorId });
    },
    setPerson(userId, setOnce, set) {
      people.push({ userId, setOnce, set });
    },
  };
  installAnalyticsSender(sender);
  process.env.POSTHOG_API_KEY = "phc_test";
  return { events, aliases, people };
}

describe("posthog client", () => {
  it("sends nothing when the API key is unset", () => {
    const events: unknown[] = [];
    installAnalyticsSender({
      capture(event) {
        events.push(event);
      },
      alias() {},
      setPerson() {},
    });
    delete process.env.POSTHOG_API_KEY;
    capturePostHog("visitor", "account_created", { utm_source: "secret" });
    expect(events).toEqual([]);
  });

  it("delivers a capture to the installed sender when a key is set", () => {
    const { events } = recordSender();
    capturePostHog("visitor-1", "account_created", { tier: "silver" });
    expect(events).toEqual([{ distinctId: "visitor-1", event: "account_created", properties: { tier: "silver" } }]);
  });

  it("defaults the host to US cloud", () => {
    delete process.env.POSTHOG_HOST;
    expect(posthogHost()).toBe("https://us.i.posthog.com");
    process.env.POSTHOG_HOST = "https://eu.i.posthog.com";
    expect(posthogHost()).toBe("https://eu.i.posthog.com");
  });

  it("maps the last touch onto attr fields and allowlisted params", () => {
    expect(touchProperties(state.last, state.visitorId)).toMatchObject({
      attr_source: "newsletter",
      attr_medium: "email",
      attr_campaign: "launch",
      attr_landing: "/pricing",
      attr_referrer: null,
      visitor_id: state.visitorId,
      utm_source: "newsletter",
      utm_medium: "email",
      utm_campaign: "launch",
      fbclid: "meta-1",
    });
  });

  it("keeps an empty touch limited to the visitor id", () => {
    expect(touchProperties(null, null)).toEqual({ visitor_id: null });
  });

  it("splits first touch and latest touch for the person", () => {
    expect(personProperties(state, "ada@example.com")).toEqual({
      setOnce: {
        initial_source: "google",
        initial_medium: "cpc",
        initial_campaign: "brand",
        initial_landing: "/",
        initial_referrer: "https://google.com",
      },
      set: {
        latest_source: "newsletter",
        latest_medium: "email",
        latest_campaign: "launch",
        latest_landing: "/pricing",
        latest_referrer: null,
        email: "ada@example.com",
      },
    });
  });

  it("turns cents into a dollar revenue event", async () => {
    const { events } = recordSender();
    await trackRevenue("user-1", { amountCents: 2900, currency: "usd", tier: "silver", period: "monthly", provider: "mock" });
    expect(events).toEqual([
      expect.objectContaining({
        distinctId: "user-1",
        event: "invoice_paid",
        properties: expect.objectContaining({ revenue: 29, currency: "USD", tier: "silver", period: "monthly", provider: "mock" }),
      }),
    ]);
  });

  it("drops a revenue event when the amount is not a finite zero-or-greater number", async () => {
    const { events } = recordSender();
    await trackRevenue("user-1", { amountCents: Number.NaN, currency: "usd", tier: "silver", period: "monthly", provider: "mock" });
    await trackRevenue("user-1", { amountCents: -1, currency: "usd", tier: "silver", period: "monthly", provider: "mock" });
    expect(events).toEqual([]);
  });

  it("forwards a product event with the last touch and keeps the caller source", async () => {
    const db = await getDb();
    const email = `forward-${crypto.randomUUID()}@example.com`;
    const [user] = await db.insert(users).values({ email, passwordHash: "x" }).returning();
    await identifyAttribution(user.id, state);
    const { events } = recordSender();
    await trackEvent("signal_viewed", user.id, { source: "amber-falcon", signalId: "sig-1" });
    expect(events).toEqual([
      expect.objectContaining({
        distinctId: user.id,
        event: "signal_viewed",
        properties: expect.objectContaining({
          source: "amber-falcon",
          signalId: "sig-1",
          attr_source: "newsletter",
          attr_medium: "email",
          attr_campaign: "launch",
          attr_landing: "/pricing",
          fbclid: "meta-1",
          visitor_id: state.visitorId,
        }),
      }),
    ]);
    const [row] = await db.select().from(analyticsEvents).where(eq(analyticsEvents.userId, user.id));
    expect(row.propsJson).toMatchObject({ source: "amber-falcon", attribution: { visitorId: state.visitorId } });
    expect(row.propsJson).not.toHaveProperty("attr_source");
  });

  it("keeps the Postgres row when the sender throws", async () => {
    const db = await getDb();
    const email = `throw-${crypto.randomUUID()}@example.com`;
    const [user] = await db.insert(users).values({ email, passwordHash: "x" }).returning();
    installAnalyticsSender({
      capture() {
        throw new Error("posthog down");
      },
      alias() {},
      setPerson() {},
    });
    process.env.POSTHOG_API_KEY = "phc_test";
    await expect(trackEvent("account_created", user.id)).resolves.toBeUndefined();
    const [row] = await db.select().from(analyticsEvents).where(eq(analyticsEvents.userId, user.id));
    expect(row.name).toBe("account_created");
  });

  it("stores an anonymous event with no distinct id and does not send it", async () => {
    const { events } = recordSender();
    await trackEvent("upgrade_clicked", null, { tier: "platinum" });
    expect(events).toEqual([]);
    const db = await getDb();
    const rows = await db.select().from(analyticsEvents).where(eq(analyticsEvents.name, "upgrade_clicked"));
    expect(rows.some((row) => row.userId === null && (row.propsJson as { tier?: string }).tier === "platinum")).toBe(true);
  });

  it("aliases the visitor onto the user and sets the stored first touch once", async () => {
    const db = await getDb();
    const email = `alias-${crypto.randomUUID()}@example.com`;
    const [user] = await db.insert(users).values({ email, passwordHash: "x" }).returning();
    const { aliases, people } = recordSender();
    await identifyAttribution(user.id, state);
    await identifyAttribution(user.id, {
      ...state,
      first: { ...state.first, landing: "/nope", params: { utm_source: "should-not-replace" } },
    });
    expect(aliases).toEqual([
      { userId: user.id, visitorId: state.visitorId },
      { userId: user.id, visitorId: state.visitorId },
    ]);
    expect(people).toHaveLength(2);
    expect(people[0].setOnce).toMatchObject({ initial_source: "google", initial_campaign: "brand", initial_landing: "/" });
    expect(people[1].setOnce).toMatchObject({ initial_source: "google", initial_landing: "/" });
    expect(people[0].set).toMatchObject({ latest_campaign: "launch", email });
  });
});
