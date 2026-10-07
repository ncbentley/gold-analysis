import { describe, expect, it } from "vitest";
import { CLOSE_HOLD_MS, exitBar, goldSection } from "./close";

const calledAt = Date.UTC(2026, 9, 6, 15, 0, 30);
const bars = [
  { t: Date.UTC(2026, 9, 6, 15, 0), o: 2650 },
  { t: Date.UTC(2026, 9, 6, 15, 1), o: 2651.2 },
];

describe("gold close", () => {
  it("uses the first bar that opens after the call", () => {
    expect(exitBar(bars, calledAt)).toEqual({ t: Date.UTC(2026, 9, 6, 15, 1), o: 2651.2 });
  });

  it("holds the card in the section it had at the call, then moves it to history", () => {
    expect(goldSection({ sectionAtCall: "active", closeCalledAt: calledAt }, calledAt + CLOSE_HOLD_MS - 1)).toBe("active");
    expect(goldSection({ sectionAtCall: "available", closeCalledAt: calledAt }, calledAt + CLOSE_HOLD_MS)).toBe("history");
  });

  it("puts a trade that already finished at its target or stop into history during the close hold", () => {
    expect(goldSection({ sectionAtCall: "active", closeCalledAt: calledAt, finished: true }, calledAt + 1)).toBe("history");
  });

  it("follows the idea phase when no close has been called", () => {
    expect(goldSection({ sectionAtCall: null, closeCalledAt: null, phase: "playing-out" }, calledAt)).toBe("active");
    expect(goldSection({ sectionAtCall: null, closeCalledAt: null, phase: "history" }, calledAt)).toBe("history");
  });
});
