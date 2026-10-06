import { describe, expect, it } from "vitest";
import { STALE_UNFILLED_MS, entryLeftBehind, filledTradeStillOpen, goldBookAction } from "./qualify";

const tp1 = { hitAt: 1 };
const tp2 = { hitAt: null as number | null };
const day = 24 * 60 * 60 * 1000;

describe("filledTradeStillOpen", () => {
  it("keeps a filled trade that has another target after the first", () => {
    expect(filledTradeStillOpen({ entered: true, stopHitAt: null, targets: [tp1, tp2] })).toBe(true);
  });

  it("does not treat an unfilled call, a stop, or a finished target list as still open", () => {
    expect(filledTradeStillOpen({ entered: false, stopHitAt: null, targets: [tp2] })).toBe(false);
    expect(filledTradeStillOpen({ entered: true, stopHitAt: 2, targets: [tp2] })).toBe(false);
    expect(filledTradeStillOpen({ entered: true, stopHitAt: null, targets: [tp1] })).toBe(false);
  });
});

describe("entryLeftBehind", () => {
  const now = Date.UTC(2026, 9, 6);
  const short = { direction: "SHORT" as const, entryMin: 4334.88, entryMax: 4334.88, stopLoss: 4343.53 };

  it("closes a two-week short once price is far below the entry", () => {
    expect(entryLeftBehind({ ...short, spot: 4168, calledAt: now - 14 * day, now })).toBe(true);
  });

  it("keeps the same distant short when the call is new", () => {
    expect(entryLeftBehind({ ...short, spot: 4168, calledAt: now - 6 * 60 * 60 * 1000, now })).toBe(false);
  });

  it("keeps an old short that is still near the entry", () => {
    expect(entryLeftBehind({ ...short, spot: 4330, calledAt: now - 14 * day, now })).toBe(false);
  });

  it("closes an old long once price has rallied far above the zone", () => {
    expect(
      entryLeftBehind({
        direction: "LONG",
        entryMin: 4100,
        entryMax: 4102,
        stopLoss: 4090,
        spot: 4300,
        calledAt: now - STALE_UNFILLED_MS,
        now,
      }),
    ).toBe(true);
  });
});

describe("goldBookAction", () => {
  it("reopens a close that landed on a trade still working after the first target", () => {
    expect(
      goldBookAction({
        closeCalledAt: 10,
        entered: true,
        stopHitAt: null,
        targets: [tp1, tp2],
        leftBehind: false,
      }),
    ).toBe("reopen");
  });

  it("leaves an unfilled close in place", () => {
    expect(
      goldBookAction({
        closeCalledAt: 10,
        entered: false,
        stopHitAt: null,
        targets: [tp2],
        leftBehind: true,
      }),
    ).toBe("keep");
  });

  it("closes an unfilled call price has left behind", () => {
    expect(
      goldBookAction({
        closeCalledAt: null,
        entered: false,
        stopHitAt: null,
        targets: [tp2],
        leftBehind: true,
      }),
    ).toBe("close");
  });

  it("keeps an unfilled call that is still near price", () => {
    expect(
      goldBookAction({
        closeCalledAt: null,
        entered: false,
        stopHitAt: null,
        targets: [tp2],
        leftBehind: false,
      }),
    ).toBe("keep");
  });

  it("does not close a filled trade after the first target", () => {
    expect(
      goldBookAction({
        closeCalledAt: null,
        entered: true,
        stopHitAt: null,
        targets: [tp1, tp2],
        leftBehind: true,
      }),
    ).toBe("keep");
  });
});
