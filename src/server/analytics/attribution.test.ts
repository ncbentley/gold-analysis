import { describe, expect, it } from "vitest";
import {
  advanceAttribution,
  channelOf,
  decodeAttribution,
  encodeAttribution,
  externalReferrer,
  extractParams,
  touchFromRequest,
  type AttributionState,
  type Touch,
} from "./attribution";

const NOW = new Date("2026-10-04T18:00:00.000Z");

function touch(over: Partial<Touch> = {}): Touch {
  return {
    at: NOW.toISOString(),
    landing: "/",
    referrer: null,
    params: {},
    ...over,
  };
}

describe("extractParams", () => {
  it("keeps utm tags, click ids and referral aliases", () => {
    const params = extractParams([
      ["utm_source", "newsletter"],
      ["utm_medium", "email"],
      ["utm_campaign", "launch"],
      ["utm_term", "gold signals"],
      ["utm_content", "hero"],
      ["utm_id", "42"],
      ["gclid", "abc"],
      ["fbclid", "meta"],
      ["ref", "partner"],
      ["token", "secret-reset"],
      ["email", "a@b.com"],
      ["next", "/billing"],
      ["password", "nope"],
    ]);
    expect(params).toEqual({
      utm_source: "newsletter",
      utm_medium: "email",
      utm_campaign: "launch",
      utm_term: "gold signals",
      utm_content: "hero",
      utm_id: "42",
      gclid: "abc",
      fbclid: "meta",
      ref: "partner",
    });
  });

  it("accepts any utm_ key and ignores empty values", () => {
    expect(extractParams([["utm_adgroup", "broad"], ["utm_source", "  "], ["UTM_MEDIUM", "cpc"]])).toEqual({
      utm_adgroup: "broad",
      utm_medium: "cpc",
    });
  });
});

describe("externalReferrer", () => {
  it("drops same-site referrers and query strings", () => {
    expect(externalReferrer("http://localhost:4317/pricing?next=/billing", "localhost:4317")).toBeNull();
    expect(externalReferrer("https://news.ycombinator.com/item?id=1", "gold.example")).toBe("https://news.ycombinator.com/item");
    expect(externalReferrer("https://www.google.com/search?q=gold", "gold.example")).toBe("https://www.google.com/search");
  });
});

describe("advanceAttribution", () => {
  it("records the first arrival, including a direct visit", () => {
    const arrival = touchFromRequest({
      pathname: "/pricing",
      searchParams: [],
      referrer: "https://www.google.com/",
      requestHost: "gold.example",
      now: NOW,
    });
    const next = advanceAttribution(null, null, arrival);
    expect(next.write).toBe(true);
    expect(next.state.first).toEqual(next.state.last);
    expect(next.state.first.landing).toBe("/pricing");
    expect(next.state.first.referrer).toBe("https://www.google.com");
    expect(channelOf(next.state.first)).toMatchObject({ source: "google.com", medium: "referral" });
  });

  it("keeps first touch and moves last touch when a new campaign arrives", () => {
    const first = advanceAttribution(null, "11111111-1111-4111-8111-111111111111", touch());
    const later = advanceAttribution(
      first.state,
      first.state.visitorId,
      touch({
        at: "2026-10-04T19:00:00.000Z",
        landing: "/",
        params: { utm_source: "meta", utm_medium: "paid", utm_campaign: "oct" },
      }),
    );
    expect(later.write).toBe(true);
    expect(later.state.visitorId).toBe(first.state.visitorId);
    expect(later.state.first.params).toEqual({});
    expect(later.state.last.params.utm_campaign).toBe("oct");
    expect(channelOf(later.state.last)).toEqual({ source: "meta", medium: "paid", campaign: "oct" });
  });

  it("does not treat a refresh of the same campaign as a new touch", () => {
    const landed = advanceAttribution(null, null, touch({ params: { utm_source: "google", utm_campaign: "brand" } }));
    const refresh = advanceAttribution(landed.state, landed.state.visitorId, touch({ at: "2026-10-04T18:10:00.000Z", params: { utm_source: "google", utm_campaign: "brand" } }));
    expect(refresh.write).toBe(false);
    expect(refresh.state.last.at).toBe(NOW.toISOString());
  });

  it("counts the same campaign again after the session window", () => {
    const landed = advanceAttribution(null, null, touch({ params: { gclid: "click-1" } }));
    const again = advanceAttribution(landed.state, landed.state.visitorId, touch({ at: "2026-10-04T18:31:00.000Z", params: { gclid: "click-1" } }));
    expect(again.write).toBe(true);
    expect(again.state.first.at).toBe(NOW.toISOString());
    expect(again.state.last.at).toBe("2026-10-04T18:31:00.000Z");
    expect(channelOf(again.state.last)).toMatchObject({ source: "google", medium: "cpc" });
  });

  it("leaves last touch in place when a later visit has no campaign parameters", () => {
    const landed = advanceAttribution(null, null, touch({ params: { fbclid: "meta-click" } }));
    const browse = advanceAttribution(landed.state, landed.state.visitorId, touch({ at: "2026-10-05T12:00:00.000Z", landing: "/signals" }));
    expect(browse.write).toBe(false);
    expect(browse.state.last.params).toEqual({ fbclid: "meta-click" });
    expect(browse.state.last.landing).toBe("/");
  });
});

describe("cookie codec", () => {
  it("round-trips and drops parameters that are not campaign data", () => {
    const state: AttributionState = {
      visitorId: "22222222-2222-4222-8222-222222222222",
      first: touch({ params: { utm_source: "newsletter" } }),
      last: touch({ params: { ttclid: "tiktok-click", token: "should-not-stick" } as Record<string, string> }),
    };
    const decoded = decodeAttribution(encodeAttribution(state));
    expect(decoded?.visitorId).toBe(state.visitorId);
    expect(decoded?.first.params).toEqual({ utm_source: "newsletter" });
    expect(decoded?.last.params).toEqual({ ttclid: "tiktok-click" });
  });

  it("rejects a cookie that is not ours", () => {
    expect(decodeAttribution("not-valid")).toBeNull();
    expect(decodeAttribution(undefined)).toBeNull();
  });
});
