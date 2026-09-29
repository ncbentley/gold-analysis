import { geometryIsValid, repairWrongSidePrices, type DigitEdit } from "./repair";
import type { ParsedSignalFields } from "./types";

export const INFERRED_DIRECTION_ISSUE = "Direction inferred from prices.";

const DIRECTION_WORD = /\b(buy(?:ing)?|sell(?:ing)?|long|short|bullish|bearish)\b/i;

export function textHasDirectionWord(text: string) {
  return DIRECTION_WORD.test(text);
}

export function inferDirectionFromPrices(input: {
  entryMin: number | null;
  entryMax: number | null;
  stopLoss: number | null;
  targets: number[];
}): { direction: "LONG" | "SHORT" | null; contradictory: boolean } {
  const lo = input.entryMin;
  const hi = input.entryMax;
  if (lo === null || hi === null) return { direction: null, contradictory: false };
  if (input.stopLoss === null && input.targets.length === 0) return { direction: null, contradictory: false };

  const votes: Array<"LONG" | "SHORT"> = [];
  const stop = input.stopLoss;
  if (stop !== null) {
    if (stop < lo) votes.push("LONG");
    else if (stop > hi) votes.push("SHORT");
    else return { direction: null, contradictory: true };
  }
  for (const target of input.targets) {
    if (target > hi) votes.push("LONG");
    else if (target < lo) votes.push("SHORT");
    else return { direction: null, contradictory: true };
  }
  const long = votes.includes("LONG");
  const short = votes.includes("SHORT");
  if (long && short) return { direction: null, contradictory: true };
  if (long) return { direction: "LONG", contradictory: false };
  if (short) return { direction: "SHORT", contradictory: false };
  return { direction: null, contradictory: false };
}

/** When stop and targets agree, the trade direction is the prices. */
export function withInferredDirection(fields: ParsedSignalFields): { fields: ParsedSignalFields; notes: string[] } {
  if (fields.direction.value) return { fields, notes: [] };
  const inferred = inferDirectionFromPrices({
    entryMin: fields.entryMin.value,
    entryMax: fields.entryMax.value,
    stopLoss: fields.stopLoss.value,
    targets: fields.targets.value ?? [],
  });
  if (!inferred.direction) return { fields, notes: [] };
  const next: ParsedSignalFields = JSON.parse(JSON.stringify(fields));
  next.direction = { value: inferred.direction, confidence: 0.92 };
  return { fields: next, notes: [INFERRED_DIRECTION_ISSUE] };
}

/**
 * A saved digit correction can make one direction consistent when the raw prices disagree.
 * Without that lesson both readings stay unresolved.
 */
export function directionFromLearnedRepair(
  fields: ParsedSignalFields,
  lessons: DigitEdit[],
): { fields: ParsedSignalFields; notes: string[] } | null {
  if (fields.direction.value || lessons.length === 0) return null;
  const viable: { fields: ParsedSignalFields; notes: string[] }[] = [];
  for (const direction of ["LONG", "SHORT"] as const) {
    const trial: ParsedSignalFields = JSON.parse(JSON.stringify(fields));
    trial.direction = { value: direction, confidence: 0.92 };
    const repaired = repairWrongSidePrices(trial, lessons);
    if (!repaired.usedLesson || !geometryIsValid(repaired.fields)) continue;
    if ((repaired.fields.stopLoss.value === null && (repaired.fields.targets.value ?? []).length === 0)) continue;
    viable.push({ fields: repaired.fields, notes: [INFERRED_DIRECTION_ISSUE, ...repaired.notes] });
  }
  return viable.length === 1 ? viable[0] : null;
}
