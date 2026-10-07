import { describe, expect, it } from "vitest";
import { mockMarketDataProvider } from "./mock-provider";
import { clipToClock } from "./provider";

describe("clipToClock", () => {
  it("drops a window that starts after the clock", () => {
    const now = Date.UTC(2026, 9, 7, 15, 49);
    const from = new Date(now + 86_400_000);
    const to = new Date(now + 6 * 86_400_000);
    expect(clipToClock(from, to, now)).toBeNull();
  });
});

describe("mockMarketDataProvider", () => {
  it("does not mint bars after the clock", async () => {
    const from = new Date(Date.now() + 86_400_000);
    const to = new Date(Date.now() + 6 * 86_400_000);
    const bars = await mockMarketDataProvider.fetchMinuteBars("XAUUSD", from, to);
    expect(bars).toEqual([]);
  });

  it("clips a window that runs past the clock", async () => {
    const from = new Date(Date.now() - 30 * 60_000);
    const to = new Date(Date.now() + 6 * 86_400_000);
    const bars = await mockMarketDataProvider.fetchMinuteBars("XAUUSD", from, to);
    expect(bars.every((bar) => bar.timestamp.getTime() <= Date.now())).toBe(true);
  });
});
