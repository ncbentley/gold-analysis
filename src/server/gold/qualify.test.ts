import { describe, expect, it } from "vitest";
import { STALE_UNFILLED_MS, entryLeftBehind, filledTradeStillOpen, goldBookAction, goldCallOutsideSilver, goldIdsOverSilverCount } from "./qualify";

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
        outsideSilver: false,
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
        outsideSilver: true,
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
        outsideSilver: false,
      }),
    ).toBe("close");
  });

  it("closes an unfilled call silver is not showing", () => {
    expect(
      goldBookAction({
        closeCalledAt: null,
        entered: false,
        stopHitAt: null,
        targets: [tp2],
        leftBehind: false,
        outsideSilver: true,
      }),
    ).toBe("close");
  });

  it("does not close, and puts a bad close back, when the path was never stored", () => {
    expect(
      goldBookAction({
        closeCalledAt: null,
        entered: false,
        stopHitAt: null,
        targets: [tp2],
        leftBehind: true,
        outsideSilver: false,
        covered: false,
      }),
    ).toBe("keep");
    expect(
      goldBookAction({
        closeCalledAt: 10,
        entered: false,
        stopHitAt: null,
        targets: [tp2],
        leftBehind: true,
        outsideSilver: false,
        covered: false,
      }),
    ).toBe("reopen");
  });

  it("keeps an unfilled call that is still near price", () => {
    expect(
      goldBookAction({
        closeCalledAt: null,
        entered: false,
        stopHitAt: null,
        targets: [tp2],
        leftBehind: false,
        outsideSilver: false,
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
        outsideSilver: true,
      }),
    ).toBe("keep");
  });
});

describe("gold available stays inside silver", () => {
  const silver = new Set(["silver"]);

  it("treats a one-source idea as outside the silver book", () => {
    expect(goldCallOutsideSilver({ ideaId: "one-source", silverAvailable: silver })).toBe(true);
    expect(goldCallOutsideSilver({ ideaId: "silver", silverAvailable: silver })).toBe(false);
  });

  it("keeps a composed zone only while silver has an idea to curate", () => {
    expect(goldCallOutsideSilver({ ideaId: null, silverAvailable: silver })).toBe(false);
    expect(goldCallOutsideSilver({ ideaId: null, silverAvailable: new Set() })).toBe(true);
  });

  it("drops extra composed zones so gold is not larger than silver", () => {
    expect(
      goldIdsOverSilverCount({
        silverCount: 1,
        rows: [
          { id: "silver-row", ideaId: "silver", createdAt: 1 },
          { id: "composed-old", ideaId: null, createdAt: 2 },
          { id: "composed-new", ideaId: null, createdAt: 3 },
        ],
      }).sort(),
    ).toEqual(["composed-new", "composed-old"]);
  });

  it("keeps one composed zone when it is the only gold call", () => {
    expect(goldIdsOverSilverCount({ silverCount: 1, rows: [{ id: "composed", ideaId: null, createdAt: 1 }] })).toEqual([]);
  });
});
