import { describe, expect, it } from "vitest";
import type { GoldLevel } from "./geometry";
import { applyProposal } from "./publish";

const long: GoldLevel = { id: "long", direction: "LONG", entryMin: 2650, entryMax: 2652, stopLoss: 2644 };
const short: GoldLevel = { id: "short", direction: "SHORT", entryMin: 2670, entryMax: 2672, stopLoss: 2676 };

describe("applyProposal", () => {
  it("returns the current book when the proposer throws", async () => {
    const result = await applyProposal({
      ideas: [long, short],
      live: [long],
      propose: async () => {
        throw new Error("timeout");
      },
      write: async () => {
        throw new Error("write should not run");
      },
    });
    expect(result).toBe("kept");
  });

  it("writes only the ideas the geometry gate accepts", async () => {
    const written: string[] = [];
    const result = await applyProposal({
      ideas: [long, short],
      live: [long],
      propose: async () => ({ addIdeaIds: ["short"], closeIdeaIds: [] }),
      write: async (plan) => {
        written.push(...plan.add.map((idea) => idea.id));
      },
    });
    expect(result).toBe("applied");
    expect(written).toEqual(["short"]);
  });
});
