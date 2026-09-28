import { describe, expect, it } from "vitest";
import { interpretPriceReview } from "./price-review";
import { expandShortTail } from "./quote-sanity";

const draft = {
  direction: "LONG" as const,
  entryType: "MARKET" as const,
  entryMin: 4819,
  entryMax: 4819,
  stopLoss: 4809,
  targets: [4825, 4834],
};

describe("short zone tails", () => {
  it("extends the last two digits and rolls the hundred when needed", () => {
    expect(expandShortTail(4155, 60)).toBe(4160);
    expect(expandShortTail(4198, 2)).toBe(4202);
    expect(expandShortTail(4155, 55)).toBeNull();
  });
});

describe("price review", () => {
  it("refuses to accept a quote hundreds of dollars from the market", () => {
    const out = interpretPriceReview(
      draft,
      { decision: "accept", reason: "as written", entryType: null, direction: null, entryMin: null, entryMax: null, stopLoss: null, targets: [] },
      4318,
    );
    expect(out).toBeNull();
  });

  it("keeps a revision that lands on the live price", () => {
    const out = interpretPriceReview(
      draft,
      {
        decision: "revise",
        reason: "tail",
        entryType: "ZONE",
        direction: "SHORT",
        entryMin: 4315,
        entryMax: 4320,
        stopLoss: 4326,
        targets: [4310, 4305],
      },
      4318,
    );
    expect(out).toMatchObject({ direction: "SHORT", entryType: "ZONE", entryMin: 4315, entryMax: 4320, stopLoss: 4326 });
  });
});
