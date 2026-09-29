import { describe, expect, it } from "vitest";
import { levelsToAttach } from "./collate";

const open = {
  instrument: "XAUUSD",
  direction: "LONG" as const,
  entryMin: 4180,
  entryMax: 4180,
  stopLoss: null as number | null,
  targetCount: 0,
};

describe("same-source collation", () => {
  it("fills an empty stop and targets from a later message at the same entry", () => {
    expect(
      levelsToAttach(open, {
        instrument: "XAUUSD",
        direction: "LONG",
        entryMin: 4176,
        entryMax: 4180,
        stopLoss: 4167,
        targets: [4183, 4186, 4190, 4195, 4200, 4220],
      }),
    ).toEqual({
      stopLoss: 4167,
      targets: [4183, 4186, 4190, 4195, 4200, 4220],
    });
  });

  it("does not invent levels or replace prices the open signal already has", () => {
    expect(
      levelsToAttach(
        { ...open, stopLoss: 4167, targetCount: 6 },
        {
          instrument: "XAUUSD",
          direction: "LONG",
          entryMin: 4180,
          entryMax: 4180,
          stopLoss: 4167,
          targets: [4183, 4186],
        },
      ),
    ).toBeNull();
    expect(
      levelsToAttach(open, {
        instrument: "XAUUSD",
        direction: "LONG",
        entryMin: 4180,
        entryMax: 4180,
        stopLoss: null,
        targets: [],
      }),
    ).toBeNull();
  });

  it("leaves a different entry or the other direction as its own signal", () => {
    expect(
      levelsToAttach(open, {
        instrument: "XAUUSD",
        direction: "SHORT",
        entryMin: 4180,
        entryMax: 4180,
        stopLoss: 4190,
        targets: [4170],
      }),
    ).toBeNull();
    expect(
      levelsToAttach(open, {
        instrument: "XAUUSD",
        direction: "LONG",
        entryMin: 4100,
        entryMax: 4100,
        stopLoss: 4080,
        targets: [4120],
      }),
    ).toBeNull();
  });
});
