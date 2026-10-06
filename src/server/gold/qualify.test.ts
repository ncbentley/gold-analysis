import { describe, expect, it } from "vitest";
import { filledTradeStillOpen, goldBookAction } from "./qualify";

const silver = new Set(["silver-idea"]);
const tp1 = { hitAt: 1 };
const tp2 = { hitAt: null as number | null };

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

describe("goldBookAction", () => {
  it("reopens a close that landed on a trade still working after the first target", () => {
    expect(
      goldBookAction({
        closeCalledAt: 10,
        entered: true,
        stopHitAt: null,
        targets: [tp1, tp2],
        ideaId: "silver-idea",
        silverAvailable: silver,
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
        ideaId: "old",
        silverAvailable: silver,
      }),
    ).toBe("keep");
  });

  it("takes an unfilled one-source call off when silver is not showing it", () => {
    expect(
      goldBookAction({
        closeCalledAt: null,
        entered: false,
        stopHitAt: null,
        targets: [tp2],
        ideaId: "one-source",
        silverAvailable: silver,
      }),
    ).toBe("close");
  });

  it("keeps an unfilled call silver still has available", () => {
    expect(
      goldBookAction({
        closeCalledAt: null,
        entered: false,
        stopHitAt: null,
        targets: [tp2],
        ideaId: "silver-idea",
        silverAvailable: silver,
      }),
    ).toBe("keep");
  });

  it("drops a composed available call when silver has nothing available", () => {
    expect(
      goldBookAction({
        closeCalledAt: null,
        entered: false,
        stopHitAt: null,
        targets: [tp2],
        ideaId: null,
        silverAvailable: new Set(),
      }),
    ).toBe("close");
  });

  it("does not close a filled trade the model wants off after the first target", () => {
    expect(
      goldBookAction({
        closeCalledAt: null,
        entered: true,
        stopHitAt: null,
        targets: [tp1, tp2],
        ideaId: "silver-idea",
        silverAvailable: silver,
      }),
    ).toBe("keep");
  });
});
