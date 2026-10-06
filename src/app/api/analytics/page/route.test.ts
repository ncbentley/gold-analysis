import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, getDb } from "@/server/db";
import { runMigrations } from "@/server/db/migrate";
import { sessions, users } from "@/server/db/schema";
import { SESSION_COOKIE } from "@/server/auth";
import { sha256 } from "@/server/lib/hash";
import { ATTR_COOKIE, VID_COOKIE, encodeAttribution, type AttributionState } from "@/server/analytics/attribution";
import { installAnalyticsSender } from "@/server/analytics/posthog";
import { POST } from "./route";

const store = vi.hoisted(() => new Map<string, string>());

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = store.get(name);
      return value === undefined ? undefined : { name, value };
    },
  }),
  headers: async () => new Headers(),
}));

const visitorId = "44444444-4444-4444-8444-444444444444";
const attributed: AttributionState = {
  visitorId,
  first: {
    at: "2026-10-01T00:00:00.000Z",
    landing: "/",
    referrer: "https://google.com",
    params: { utm_source: "google", utm_medium: "cpc", utm_campaign: "brand" },
  },
  last: {
    at: "2026-10-04T00:00:00.000Z",
    landing: "/pricing",
    referrer: null,
    params: { utm_source: "newsletter", utm_medium: "email", utm_campaign: "launch", fbclid: "meta-1" },
  },
};

function sender() {
  const events: { distinctId: string; event: string; properties: Record<string, unknown> }[] = [];
  installAnalyticsSender({
    capture(event) {
      events.push(event);
    },
    alias() {},
    setPerson() {},
  });
  process.env.POSTHOG_API_KEY = "phc_test";
  return events;
}

function post(body: unknown, raw = false) {
  return POST(
    new Request("http://localhost/api/analytics/page", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: raw ? String(body) : JSON.stringify(body),
    }),
  );
}

beforeAll(async () => {
  await runMigrations();
});

afterEach(() => {
  store.clear();
  installAnalyticsSender(null);
  delete process.env.POSTHOG_API_KEY;
});

afterAll(async () => {
  await closeDb();
});

describe("POST /api/analytics/page", () => {
  it("records a pathname with the last touch", async () => {
    const events = sender();
    store.set(VID_COOKIE, visitorId);
    store.set(ATTR_COOKIE, encodeAttribution(attributed));
    const res = await post({ pathname: "/pricing" });
    expect(res.status).toBe(204);
    expect(events).toEqual([
      expect.objectContaining({
        distinctId: visitorId,
        event: "$pageview",
        properties: expect.objectContaining({
          $pathname: "/pricing",
          $current_url: "/pricing",
          attr_source: "newsletter",
          attr_campaign: "launch",
          fbclid: "meta-1",
        }),
      }),
    ]);
  });

  it("uses the signed-in user id when a session cookie is present", async () => {
    const events = sender();
    const db = await getDb();
    const [user] = await db.insert(users).values({ email: `page-${visitorId}@example.com`, passwordHash: "x" }).returning();
    const token = "page-session-token";
    await db.insert(sessions).values({ id: sha256(token), userId: user.id, expiresAt: new Date(Date.now() + 86_400_000) });
    store.set(SESSION_COOKIE, token);
    store.set(VID_COOKIE, visitorId);
    const res = await post({ pathname: "/signals" });
    expect(res.status).toBe(204);
    expect(events[0]?.distinctId).toBe(user.id);
  });

  it.each(["/admin", "/admin/jobs", "/api", "/api/v1/signals"])("drops %s", async (pathname) => {
    const events = sender();
    store.set(VID_COOKIE, visitorId);
    const res = await post({ pathname });
    expect(res.status).toBe(204);
    expect(events).toEqual([]);
  });

  it("drops a body that is not a pathname", async () => {
    const events = sender();
    store.set(VID_COOKIE, visitorId);
    expect((await post({ pathname: "https://evil.example" })).status).toBe(204);
    expect((await post({ pathname: "/pricing?utm_source=secret" })).status).toBe(204);
    expect((await post({ pathname: "/a\\b" })).status).toBe(204);
    expect((await post({ pathname: "pricing" })).status).toBe(204);
    expect((await post("not-json", true)).status).toBe(204);
    expect(events).toEqual([]);
  });

  it("drops a request with no visitor cookie", async () => {
    const events = sender();
    const res = await post({ pathname: "/pricing" });
    expect(res.status).toBe(204);
    expect(events).toEqual([]);
  });
});
