import { afterEach, describe, expect, it } from "vitest";
import { capturePostHog, installAnalyticsSender, posthogHost, type AnalyticsSender } from "./posthog";

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
});
