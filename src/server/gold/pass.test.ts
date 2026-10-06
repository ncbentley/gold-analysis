import { describe, expect, it } from "vitest";
import type { GoldLevel } from "./geometry";
import { planGoldUpdate } from "./pass";

const long: GoldLevel = { id: "long", direction: "LONG", entryMin: 2650, entryMax: 2652, stopLoss: 2644 };
const lower: GoldLevel = { id: "lower", direction: "LONG", entryMin: 2638, entryMax: 2638, stopLoss: 2630 };
const short: GoldLevel = { id: "short", direction: "SHORT", entryMin: 2670, entryMax: 2672, stopLoss: 2676 };

describe("planGoldUpdate", () => {
  it("adds a bracketing short and ignores an entry past the live stop", () => {
    const plan = planGoldUpdate({
      proposal: { addIdeaIds: ["short", "lower"], closeIdeaIds: [] },
      ideas: [long, short, lower],
      live: [long],
    });
    expect(plan.add.map((idea) => idea.id)).toEqual(["short"]);
  });

  it("closes only an idea that is already live", () => {
    const plan = planGoldUpdate({
      proposal: { addIdeaIds: [], closeIdeaIds: ["long", "missing"] },
      ideas: [long],
      live: [long],
    });
    expect(plan.closeIds).toEqual(["long"]);
  });
});
