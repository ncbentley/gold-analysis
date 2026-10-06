import { describe, expect, it } from "vitest";
import { barAffectsSignal } from "./affected";

const bar = { t: 0, o: 100, h: 101, l: 99, c: 100 };

describe("barAffectsSignal", () => {
  it("wakes a pending zone when the bar overlaps the entry", () => {
    expect(barAffectsSignal({ status: "PENDING", entryMin: 99.5, entryMax: 100.5, entryType: "ZONE" }, bar)).toBe(true);
  });

  it("leaves a pending zone asleep when the bar misses the entry", () => {
    expect(barAffectsSignal({ status: "PENDING", entryMin: 110, entryMax: 111, entryType: "ZONE" }, bar)).toBe(false);
  });

  it("always advances an open signal", () => {
    expect(barAffectsSignal({ status: "ACTIVE", entryMin: 110, entryMax: 111, entryType: "ZONE" }, bar)).toBe(true);
  });

  it("leaves a closed signal alone", () => {
    expect(barAffectsSignal({ status: "WON", entryMin: 99, entryMax: 100, entryType: "ZONE" }, bar)).toBe(false);
  });
});
