import { describe, expect, it } from "vitest";
import { openMarkR, tradeGlance, zoneDistance } from "./trade-glance";

describe("zoneDistance", () => {
  it("measures the gap to the near edge", () => {
    expect(zoneDistance(4705, 4710, 4180)).toEqual({ points: 525, place: "below" });
    expect(zoneDistance(4160, 4162, 4200)).toEqual({ points: 38, place: "above" });
    expect(zoneDistance(4160, 4162, 4161)?.place).toBe("inside");
    expect(zoneDistance(4160, 4162, null)).toBeNull();
  });
});

describe("openMarkR", () => {
  it("marks an untouched long at spot", () => {
    expect(
      openMarkR({
        direction: "LONG",
        entryPrice: 4160,
        risk: 10,
        spot: 4170,
        exits: [],
        remaining: 2,
        targetCount: 2,
      }),
    ).toBe(1);
  });

  it("keeps a booked target and marks the remainder", () => {
    expect(
      openMarkR({
        direction: "LONG",
        entryPrice: 4160,
        risk: 10,
        spot: 4165,
        exits: [{ price: 4170, weight: 0.5 }],
        remaining: 1,
        targetCount: 2,
      }),
    ).toBe(0.75);
  });
});

describe("tradeGlance", () => {
  const levels = { direction: "LONG" as const, entryMin: 4705, entryMax: 4710, spot: 4180 };

  it("shows distance while the call is unfilled", () => {
    const glance = tradeGlance({ ...levels, phase: "available", outcome: null });
    expect(glance.distance).toEqual({ points: 525, place: "below" });
    expect(glance.r).toBeNull();
  });

  it("shows realized R and which targets traded", () => {
    const glance = tradeGlance({
      ...levels,
      phase: "history",
      outcome: {
        entered: true,
        entryPrice: 4706,
        risk: 6,
        rResult: 1.5,
        exitTime: 10,
        targets: [{ hitAt: 1 }, { hitAt: null }],
        checkpoint: null,
      },
    });
    expect(glance.realized).toBe(true);
    expect(glance.r).toBe(1.5);
    expect(glance.hits).toEqual([true, false]);
    expect(glance.distance).toBeNull();
  });
});
