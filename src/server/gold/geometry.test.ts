import { describe, expect, it } from "vitest";
import { entryReachable, type GoldLevel } from "./geometry";

const long: GoldLevel = { id: "long", direction: "LONG", entryMin: 2650, entryMax: 2652, stopLoss: 2644 };
const short: GoldLevel = { id: "short", direction: "SHORT", entryMin: 2670, entryMax: 2672, stopLoss: 2676 };
const lower: GoldLevel = { id: "lower", direction: "LONG", entryMin: 2638, entryMax: 2638, stopLoss: 2630 };

describe("entryReachable", () => {
  it("keeps a long and a short that bracket price", () => {
    expect(entryReachable(short, [long])).toBe(true);
    expect(entryReachable(long, [short])).toBe(true);
  });

  it("rejects an entry past a live stop", () => {
    expect(entryReachable(lower, [long])).toBe(false);
  });

  it("allows that lower entry once the first idea is no longer live", () => {
    expect(entryReachable(lower, [])).toBe(true);
  });
});
