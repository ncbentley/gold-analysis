import { describe, expect, it } from "vitest";
import { reviseOpenCall, reviseOpenTargets, sameGoldEntry, targetsEdited } from "./revise";

describe("revise open gold targets", () => {
  it("treats the same entry as the same call", () => {
    expect(sameGoldEntry({ direction: "SHORT", entryMin: 4205, entryMax: 4287 }, { direction: "SHORT", entryMin: 4205.001, entryMax: 4287 })).toBe(true);
    expect(sameGoldEntry({ direction: "SHORT", entryMin: 4205, entryMax: 4287 }, { direction: "LONG", entryMin: 4205, entryMax: 4287 })).toBe(false);
  });

  it("replaces the whole list when nothing has been hit", () => {
    const next = reviseOpenTargets([4202, 4199, 4195], [4202, 4197, 4185], [false, false, false]);
    expect(next).toEqual([4202, 4197, 4185]);
    expect(targetsEdited([4202, 4199, 4195], next)).toBe(true);
  });

  it("keeps a target that already filled and replaces the rest", () => {
    expect(reviseOpenTargets([4202, 4199, 4195], [4197, 4185], [true, false, false])).toEqual([4202, 4197, 4185]);
  });

  it("moves the stop only while the call is still unfilled", () => {
    const open = reviseOpenCall({
      entered: false,
      stopLoss: 4222,
      nextStop: 4215,
      currentTargets: [4202, 4199],
      nextTargets: [4202, 4197],
      hit: [false, false],
    });
    expect(open).toMatchObject({ stopLoss: 4215, targets: [4202, 4197], edited: true });
    const filled = reviseOpenCall({
      entered: true,
      stopLoss: 4222,
      nextStop: 4215,
      currentTargets: [4202, 4199],
      nextTargets: [4202, 4197],
      hit: [true, false],
    });
    expect(filled.stopLoss).toBe(4222);
    expect(filled.targets).toEqual([4202, 4197]);
  });

  it("leaves the list alone when the new targets are the same", () => {
    const next = reviseOpenTargets([4202, 4197], [4202, 4197], [false, false]);
    expect(targetsEdited([4202, 4197], next)).toBe(false);
  });
});
