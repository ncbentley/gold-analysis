import { describe, expect, it } from "vitest";
import { marketDataNotice, tradeChartRange } from "./chart-window";

const call = Date.UTC(2026, 9, 8, 15, 0, 0);

describe("tradeChartRange", () => {
  it("keeps the window open through now while the trade is open", () => {
    const now = call + 5 * 60 * 60_000;
    const range = tradeChartRange(call, null, now);
    expect(range.from.getTime()).toBe(call - 120 * 60_000);
    expect(range.to.getTime()).toBe(now + 60_000);
  });

  it("stops ninety minutes after a close", () => {
    const exit = call + 30 * 60_000;
    const range = tradeChartRange(call, exit, call + 10 * 60 * 60_000);
    expect(range.to.getTime()).toBe(exit + 91 * 60_000);
  });
});

describe("marketDataNotice", () => {
  it("names an empty series", () => {
    expect(marketDataNotice({ bars: [], calledAt: call, filledAt: null })).toMatch(/No XAU\/USD bars/);
  });

  it("draws from one bar and stays quiet when that bar is the call", () => {
    expect(marketDataNotice({ bars: [{ t: call + 60_000 }], calledAt: call, filledAt: null })).toBeNull();
  });

  it("names a fill whose bar is missing", () => {
    const filledAt = call + 10 * 60_000;
    expect(marketDataNotice({ bars: [{ t: call + 60_000 }], calledAt: call, filledAt })).toMatch(/bars around that fill/);
  });

  it("names a series that starts after the call", () => {
    expect(marketDataNotice({ bars: [{ t: call + 3 * 60 * 60_000 }], calledAt: call, filledAt: null })).toMatch(/path in between/);
  });
});
