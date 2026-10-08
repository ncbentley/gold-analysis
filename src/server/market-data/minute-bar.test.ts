import { describe, expect, it } from "vitest";
import { applyPrint } from "./minute-bar";
import { readPricePrint, subscribeStatus } from "./twelvedata-stream";

const minute = 60_000;

describe("applyPrint", () => {
  it("opens a minute on the first print", () => {
    const next = applyPrint(null, { t: minute + 5_000, price: 4100 });
    expect(next.sealed).toBeNull();
    expect(next.open).toEqual({ t: minute, o: 4100, h: 4100, l: 4100, c: 4100 });
  });

  it("keeps the open and tracks the extremes inside the minute", () => {
    const first = applyPrint(null, { t: 1_000, price: 4100 });
    const next = applyPrint(first.open, { t: 20_000, price: 4110 });
    const last = applyPrint(next.open, { t: 40_000, price: 4090 });
    expect(last.sealed).toBeNull();
    expect(last.open).toEqual({ t: 0, o: 4100, h: 4110, l: 4090, c: 4090 });
  });

  it("reads an XAU/USD price print and ignores anything else", () => {
    expect(readPricePrint({ event: "price", symbol: "XAU/USD", price: "4101.2", timestamp: 1_700_000_000 })).toEqual({
      t: 1_700_000_000_000,
      price: 4101.2,
    });
    expect(readPricePrint({ event: "price", symbol: "EUR/USD", price: 1.1, timestamp: 1 })).toBeNull();
  });

  it("reads a subscribe status", () => {
    expect(subscribeStatus({ event: "subscribe-status", success: [{ symbol: "XAU/USD" }], fails: [] })).toEqual({
      ok: ["XAU/USD"],
      failed: [],
    });
  });

  it("seals the minute when the next print falls in a later one", () => {
    const first = applyPrint(null, { t: 1_000, price: 4100 });
    const next = applyPrint(first.open, { t: minute + 1_000, price: 4120 });
    expect(next.sealed).toEqual({ t: 0, o: 4100, h: 4100, l: 4100, c: 4100 });
    expect(next.open).toEqual({ t: minute, o: 4120, h: 4120, l: 4120, c: 4120 });
  });
});
