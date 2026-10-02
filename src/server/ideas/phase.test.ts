import { describe, expect, it } from "vitest";
import { ideaPhase, type PhaseInput } from "./phase";

const long: PhaseInput = {
  direction: "LONG",
  entryMin: 2650,
  entryMax: 2652,
  stopLoss: 2644,
  spot: 2660,
  entered: false,
  closed: false,
  cancelled: false,
};

describe("ideaPhase", () => {
  it("stays available while a long can still be filled from above", () => {
    expect(ideaPhase(long)).toBe("available");
  });

  it("stays available while price is inside the entry", () => {
    expect(ideaPhase({ ...long, spot: 2651 })).toBe("available");
  });

  it("is history when price has left through the entry with no fill", () => {
    expect(ideaPhase({ ...long, spot: 2648 })).toBe("history");
  });

  it("is history when the stop is traded before a fill", () => {
    expect(ideaPhase({ ...long, spot: 2644 })).toBe("history");
  });

  it("is playing out after a fill until the trade closes", () => {
    expect(ideaPhase({ ...long, spot: 2700, entered: true })).toBe("playing-out");
  });

  it("is history once the trade has closed", () => {
    expect(ideaPhase({ ...long, entered: true, closed: true })).toBe("history");
  });

  it("mirrors a short", () => {
    const short: PhaseInput = { ...long, direction: "SHORT", entryMin: 2650, entryMax: 2652, stopLoss: 2658, spot: 2640 };
    expect(ideaPhase(short)).toBe("available");
    expect(ideaPhase({ ...short, spot: 2656 })).toBe("history");
    expect(ideaPhase({ ...short, spot: 2658 })).toBe("history");
  });

  it("stays available when spot is missing and the trade is still open", () => {
    expect(ideaPhase({ ...long, spot: null })).toBe("available");
  });
});
