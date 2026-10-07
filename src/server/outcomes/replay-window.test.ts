import { describe, expect, it } from "vitest";
import { knownMarketThrough, outcomeUsesFutureBar } from "./replay-window";

const NOW = Date.UTC(2026, 9, 7, 15, 49);
const LATER = Date.UTC(2026, 9, 13, 14, 54);

describe("knownMarketThrough", () => {
  it("stops a replay at the clock when the sync cursor is ahead of it", () => {
    expect(knownMarketThrough(LATER, NOW)).toBe(NOW);
  });

  it("keeps a cursor that is already behind the clock", () => {
    const cursor = NOW - 60_000;
    expect(knownMarketThrough(cursor, NOW)).toBe(cursor);
  });
});

describe("outcomeUsesFutureBar", () => {
  it("flags a fill dated after the clock", () => {
    expect(
      outcomeUsesFutureBar(
        { kind: "computed", entryTime: new Date(LATER), exitTime: new Date(LATER), checkpointBarTime: null },
        NOW,
      ),
    ).toBe(true);
  });

  it("leaves a manual override alone", () => {
    expect(
      outcomeUsesFutureBar({ kind: "override", entryTime: new Date(LATER), exitTime: new Date(LATER) }, NOW),
    ).toBe(false);
  });

  it("leaves a fill that already happened", () => {
    expect(
      outcomeUsesFutureBar(
        { kind: "computed", entryTime: new Date(NOW - 60_000), exitTime: null, checkpointBarTime: NOW - 60_000 },
        NOW,
      ),
    ).toBe(false);
  });
});
