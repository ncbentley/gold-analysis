import { describe, expect, it } from "vitest";
import { signalsToAdvance } from "./service";

describe("signalsToAdvance", () => {
  it("returns the open signal and the pending signal the bar overlaps", () => {
    const bar = { t: 0, h: 100, l: 99 };
    const ids = signalsToAdvance(
      [
        { id: "open", status: "ACTIVE", entryMin: 90, entryMax: 91, entryType: "ZONE" },
        { id: "hit", status: "PENDING", entryMin: 99, entryMax: 100, entryType: "ZONE" },
        { id: "miss", status: "PENDING", entryMin: 120, entryMax: 121, entryType: "ZONE" },
        { id: "done", status: "WON", entryMin: 99, entryMax: 100, entryType: "ZONE" },
      ],
      bar,
    );
    expect(ids).toEqual(["open", "hit"]);
  });
});
