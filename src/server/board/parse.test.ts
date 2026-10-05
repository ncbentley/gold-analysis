import { describe, expect, it } from "vitest";
import { finishBoardPick, parseBoardOutput } from "./parse";

const primary = {
  direction: "LONG" as const,
  entryMin: 2651.25,
  entryMax: 2652.5,
  stopLoss: 2644,
  targets: [2660, 2670],
  writeup: "Two desks, small sample, news read unavailable.",
  ideaIds: ["known", "invented"],
};

describe("parseBoardOutput", () => {
  it("stores the primary prices as returned and drops alternates past four", () => {
    const alternates = [1, 2, 3, 4, 5].map((n) => ({ ...primary, entryMin: 2700 + n, ideaIds: ["known"], writeup: `alt ${n}` }));
    const parsed = parseBoardOutput({ primary, alternates }, new Set(["known"]));
    expect(parsed.primary.entryMin).toBe(2651.25);
    expect(parsed.primary.entryMax).toBe(2652.5);
    expect(parsed.primary.stopLoss).toBe(2644);
    expect(parsed.primary.targets).toEqual([2660, 2670]);
    expect(parsed.primary.ideaIds).toEqual(["known"]);
    expect(parsed.alternates).toHaveLength(4);
    expect(parsed.alternates[0].entryMin).toBe(2701);
  });
});

describe("finishBoardPick", () => {
  const idea = { id: "known", stopLoss: 2640, targets: [2660, 2670] };

  it("keeps a complete pick", () => {
    const done = finishBoardPick(primary, [idea]);
    expect(done?.stopLoss).toBe(2644);
    expect(done?.targets).toEqual([2660, 2670]);
  });

  it("borrows a stop and targets from the cited idea", () => {
    const done = finishBoardPick({ ...primary, stopLoss: null, targets: [] }, [idea]);
    expect(done?.stopLoss).toBe(2640);
    expect(done?.targets).toEqual([2660, 2670]);
  });

  it("drops a pick that still cannot finish", () => {
    expect(finishBoardPick({ ...primary, stopLoss: null, targets: [], ideaIds: [] }, [idea])).toBeNull();
  });
});
