import { describe, expect, it } from "vitest";
import { applyLessonsToParse, lessonFromPrices, shouldHoldInferredDirection } from "./lessons";
import { parseEvent, REVIEW_THRESHOLD } from "./index";
import { digitEditsBetween, repairWrongSidePrices } from "./repair";
import type { ParsedSignalFields } from "./types";

const at = new Date("2026-01-05T10:00:00Z");

function fields(patch: Partial<ParsedSignalFields> = {}): ParsedSignalFields {
  return {
    instrument: { value: "XAUUSD", confidence: 1 },
    direction: { value: "SHORT", confidence: 1 },
    entryType: { value: "LIMIT", confidence: 1 },
    entryMin: { value: 4190, confidence: 1 },
    entryMax: { value: 4190, confidence: 1 },
    stopLoss: { value: 4210, confidence: 1 },
    targets: { value: [4280], confidence: 1 },
    signalType: { value: null, confidence: 1 },
    sourceConfidenceText: { value: null, confidence: 1 },
    ...patch,
  };
}

describe("one-digit price repair", () => {
  it("turns 4280 into 4180 for a short because that is the closest valid edit", () => {
    const repaired = repairWrongSidePrices(fields());
    expect(repaired.fields.targets.value).toEqual([4180]);
    expect(repaired.notes.join(" ")).toMatch(/4280 to 4180/);
    expect(repaired.usedLesson).toBe(false);
  });

  it("leaves a five-dollar wrong-side stop alone", () => {
    const repaired = repairWrongSidePrices(
      fields({
        direction: { value: "LONG", confidence: 1 },
        entryMin: { value: 3340, confidence: 1 },
        entryMax: { value: 3340, confidence: 1 },
        stopLoss: { value: 3345, confidence: 1 },
        targets: { value: [3350], confidence: 1 },
      }),
    );
    expect(repaired.fields.stopLoss.value).toBe(3345);
    expect(repaired.notes).toEqual([]);
  });

  it("prefers a saved digit correction over the nearest edit", () => {
    const repaired = repairWrongSidePrices(fields(), [{ from: 4280, to: 4080 }]);
    expect(repaired.fields.targets.value).toEqual([4080]);
    expect(repaired.usedLesson).toBe(true);
  });

  it("records a one-digit change between the prices a person kept", () => {
    expect(digitEditsBetween([4190, 4190, 4210, 4280], [4190, 4190, 4210, 4180])).toEqual([{ from: 4280, to: 4180 }]);
    expect(lessonFromPrices([4280], [4180], "correct", false).edits).toEqual([{ from: 4280, to: 4180 }]);
  });
});

describe("lessons from manual review", () => {
  it("auto-applies an inferred direction until dismissals outnumber adds", () => {
    const parsed = parseEvent("text-generic", {
      rawText: "GOLD 4290/4287 TP 4300 SL 4280",
      payload: null,
      publishedAt: at,
    });
    expect(parsed.confidence).toBeGreaterThanOrEqual(REVIEW_THRESHOLD);
    const held = applyLessonsToParse(parsed, [
      { edits: [], decision: "dismiss", noDirectionWord: true },
      { edits: [], decision: "dismiss", noDirectionWord: true },
      { edits: [], decision: "accept", noDirectionWord: true },
    ]);
    expect(shouldHoldInferredDirection([
      { edits: [], decision: "dismiss", noDirectionWord: true },
      { edits: [], decision: "dismiss", noDirectionWord: true },
    ])).toBe(true);
    expect(held.confidence).toBeLessThan(REVIEW_THRESHOLD);
    expect(held.issues.join(" ")).toMatch(/waits for review/);
  });

  it("uses a saved correction to pick a direction the raw prices disagree on", () => {
    const parsed = parseEvent("text-generic", {
      rawText: "GOLD 4190 TP 4280 SL 4210",
      payload: null,
      publishedAt: at,
    });
    expect(parsed.signal?.direction.value).toBeNull();
    const learned = applyLessonsToParse(parsed, [
      { edits: [{ from: 4280, to: 4180 }], decision: "correct", noDirectionWord: false },
    ]);
    expect(learned.signal?.direction.value).toBe("SHORT");
    expect(learned.signal?.targets.value).toEqual([4180]);
    expect(learned.signal?.stopLoss.value).toBe(4210);
    expect(learned.confidence).toBeGreaterThanOrEqual(REVIEW_THRESHOLD);
  });
});
