import { directionFromLearnedRepair, INFERRED_DIRECTION_ISSUE } from "./direction";
import { digitEditsBetween, type DigitEdit } from "./repair";
import type { ParseOutput, ParsedSignalFields } from "./types";
import { finalizeSignal } from "./validate";

export interface ParseLesson {
  edits: DigitEdit[];
  decision: "accept" | "dismiss" | "correct";
  noDirectionWord: boolean;
}

export const HELD_DIRECTION_ISSUE =
  "Similar posts without a direction word were dismissed, so this one waits for review.";

export function parseLesson(value: unknown): ParseLesson | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const decision = record.decision;
  if (decision !== "accept" && decision !== "dismiss" && decision !== "correct") return null;
  const edits: DigitEdit[] = [];
  if (Array.isArray(record.edits)) {
    for (const item of record.edits) {
      if (!item || typeof item !== "object") continue;
      const from = (item as { from?: unknown }).from;
      const to = (item as { to?: unknown }).to;
      if (typeof from === "number" && typeof to === "number") edits.push({ from, to });
    }
  }
  return { edits, decision, noDirectionWord: record.noDirectionWord === true };
}

/** Two or more dismissals, and more dismissals than manual adds, hold the next inferred signal. */
export function shouldHoldInferredDirection(lessons: ParseLesson[]) {
  let dismissed = 0;
  let accepted = 0;
  for (const lesson of lessons) {
    if (!lesson.noDirectionWord) continue;
    if (lesson.decision === "dismiss") dismissed += 1;
    if (lesson.decision === "accept") accepted += 1;
  }
  return dismissed >= 2 && dismissed > accepted;
}

export function pricesFromParsedSignal(signal: ParsedSignalFields | null | undefined) {
  if (!signal) return [];
  return [signal.entryMin.value, signal.entryMax.value, signal.stopLoss.value, ...(signal.targets.value ?? [])].filter(
    (price): price is number => typeof price === "number",
  );
}

export function lessonFromPrices(before: number[], after: number[], decision: ParseLesson["decision"], noDirectionWord: boolean): ParseLesson {
  return { edits: digitEditsBetween(before, after), decision, noDirectionWord };
}

const PRESERVED_ISSUE = /^(Direction inferred from prices\.|Repaired |Similar posts without a direction word)/;

/** Re-scores a parse with saved corrections. The parser itself stays pure. */
export function applyLessonsToParse(out: ParseOutput, lessons: ParseLesson[]): ParseOutput {
  if (out.eventType !== "NEW_SIGNAL" || !out.signal) return out;
  const edits = lessons.flatMap((lesson) => lesson.edits);
  let fields = out.signal;
  const preserved = out.issues.filter((issue) => PRESERVED_ISSUE.test(issue));
  if (!fields.direction.value) {
    const learned = directionFromLearnedRepair(fields, edits);
    if (learned) {
      fields = learned.fields;
      for (const note of learned.notes) if (!preserved.includes(note)) preserved.push(note);
    }
  }
  const again = finalizeSignal(fields, edits);
  let issues = [...new Set([...preserved, ...again.issues])];
  let confidence = again.confidence;
  if (issues.includes(INFERRED_DIRECTION_ISSUE) && shouldHoldInferredDirection(lessons)) {
    confidence = Math.min(confidence, 0.6);
    if (!issues.includes(HELD_DIRECTION_ISSUE)) issues = [...issues, HELD_DIRECTION_ISSUE];
  }
  return { ...out, signal: again.signal, issues, confidence };
}
