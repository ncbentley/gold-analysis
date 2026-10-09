import { describe, expect, it } from "vitest";
import { callCovered, ideaPhase, phaseFromMembers, UNCOVERED_GRACE_MS, type PhaseInput, type PhaseMember } from "./phase";

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

describe("callCovered", () => {
  it("is covered by the bar that opens the call", () => {
    expect(callCovered([{ t: 1_000 }, { t: 60_000 }], 0)).toBe(true);
  });

  it("is not covered when the first bar arrives later", () => {
    expect(callCovered([{ t: 21 * 60_000 }], 0)).toBe(false);
    expect(callCovered([], 0)).toBe(false);
  });
});

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

  it("stays available when the series does not start at the call", () => {
    expect(ideaPhase({ ...long, spot: 2644, covered: false })).toBe("available");
    expect(ideaPhase({ ...long, spot: 2648, covered: false })).toBe("available");
  });

  it("keeps a fresh hole available and retires a stale one once price has left", () => {
    const now = Date.UTC(2026, 9, 9);
    expect(ideaPhase({ ...long, spot: 2644, covered: false, calledAt: now - 60_000, now })).toBe("available");
    expect(ideaPhase({ ...long, spot: 2644, covered: false, calledAt: now - UNCOVERED_GRACE_MS, now })).toBe("history");
    expect(ideaPhase({ ...long, spot: 2660, covered: false, calledAt: now - UNCOVERED_GRACE_MS, now })).toBe("available");
  });
});

const pending: PhaseMember = { status: "PENDING", outcome: null };
const enteredOpen: PhaseMember = {
  status: "ACTIVE",
  outcome: { entered: true, exitTime: null, classification: "ACTIVE" },
};
const enteredClosed: PhaseMember = {
  status: "WON",
  outcome: { entered: true, exitTime: new Date("2026-01-02T00:00:00Z"), classification: "WON" },
};
const cancelled: PhaseMember = {
  status: "CANCELLED",
  outcome: { entered: false, exitTime: null, classification: "CANCELLED" },
};
const expired: PhaseMember = { status: "EXPIRED", outcome: null };

function phaseOf(members: Array<PhaseMember | null>, spot: number | null = 2651) {
  return ideaPhase({ ...long, spot, ...phaseFromMembers(members) });
}

describe("phaseFromMembers", () => {
  it("stays available when nothing has filled and spot is still inside the entry", () => {
    const flags = phaseFromMembers([pending]);
    expect(flags).toEqual({ entered: false, closed: false, cancelled: false });
    expect(phaseOf([pending])).toBe("available");
  });

  it("does not treat a missing roster as closed or cancelled", () => {
    expect(phaseFromMembers([null, undefined])).toEqual({ entered: false, closed: false, cancelled: false });
    expect(phaseOf([])).toBe("available");
  });

  it("is playing out when an entered member has no exit", () => {
    expect(phaseFromMembers([enteredOpen])).toMatchObject({ entered: true, closed: false, cancelled: false });
    expect(phaseOf([enteredOpen])).toBe("playing-out");
  });

  it("is history once every entered member has an exit", () => {
    expect(phaseFromMembers([enteredClosed, pending])).toMatchObject({ entered: true, closed: true, cancelled: false });
    expect(phaseOf([enteredClosed, { ...enteredClosed }])).toBe("history");
  });

  it("is history when every member is cancelled or expired and none has entered", () => {
    expect(phaseFromMembers([cancelled, expired])).toEqual({ entered: false, closed: false, cancelled: true });
    expect(phaseOf([cancelled, expired])).toBe("history");
  });

  it("stays available when one member is cancelled and another is still pending", () => {
    expect(phaseFromMembers([cancelled, pending])).toEqual({ entered: false, closed: false, cancelled: false });
    expect(phaseOf([cancelled, pending], 2651)).toBe("available");
  });
});
