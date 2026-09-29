import type { ParsedSignalFields } from "./types";

export interface DigitEdit {
  from: number;
  to: number;
}

/** A wrong-side price closer than this is a real geometry error, not a typo. */
export const MIN_TYPO_GAP = 20;
/** One-digit repairs have to land near the entry they belong to. */
export const MAX_REPAIR_DISTANCE = 120;

const GOLD_MIN = 1000;
const GOLD_MAX = 20_000;

export function samePrice(a: number, b: number) {
  return Math.abs(a - b) < 0.001;
}

export function oneDigitVariants(price: number): number[] {
  if (!Number.isFinite(price)) return [];
  const sign = price < 0 ? -1 : 1;
  const rounded = Math.round(Math.abs(price) * 100) / 100;
  const [intPart, frac = ""] = rounded.toString().split(".");
  const variants = new Set<number>();
  for (let i = 0; i < intPart.length; i++) {
    for (let digit = 0; digit <= 9; digit++) {
      const nextDigit = String(digit);
      if (nextDigit === intPart[i]) continue;
      const replaced = `${intPart.slice(0, i)}${nextDigit}${intPart.slice(i + 1)}`.replace(/^0+(?=\d)/, "");
      const combined = frac ? `${replaced}.${frac}` : replaced;
      const value = Math.round(sign * Number(combined) * 100) / 100;
      if (Number.isFinite(value) && !samePrice(value, price)) variants.add(value);
    }
  }
  return [...variants];
}

export function digitEditsBetween(before: number[], after: number[]): DigitEdit[] {
  const beforeCounts = counts(before);
  const afterCounts = counts(after);
  const removed: number[] = [];
  for (const [value, count] of beforeCounts) {
    const kept = afterCounts.get(value) ?? 0;
    for (let i = 0; i < count - kept; i++) removed.push(value);
  }
  const added: number[] = [];
  for (const [value, count] of afterCounts) {
    const kept = beforeCounts.get(value) ?? 0;
    for (let i = 0; i < count - kept; i++) added.push(value);
  }
  const used = new Set<number>();
  const edits: DigitEdit[] = [];
  for (const from of removed) {
    const index = added.findIndex(
      (to, i) => !used.has(i) && oneDigitVariants(from).some((variant) => samePrice(variant, to)),
    );
    if (index < 0) continue;
    used.add(index);
    edits.push({ from, to: added[index] });
  }
  return edits;
}

type Side = "LONG" | "SHORT";
type Kind = "stop" | "target";

function counts(values: number[]) {
  const map = new Map<number, number>();
  for (const value of values) {
    const key = Math.round(value * 100) / 100;
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return map;
}

function isGold(price: number) {
  return price >= GOLD_MIN && price <= GOLD_MAX;
}

function edge(kind: Kind, direction: Side, lo: number, hi: number) {
  if (kind === "stop") return direction === "LONG" ? lo : hi;
  return direction === "LONG" ? hi : lo;
}

function onValidSide(kind: Kind, direction: Side, price: number, lo: number, hi: number) {
  if (kind === "stop") return direction === "LONG" ? price < lo : price > hi;
  return direction === "LONG" ? price > hi : price < lo;
}

function wrongGap(kind: Kind, direction: Side, price: number, lo: number, hi: number) {
  if (onValidSide(kind, direction, price, lo, hi)) return 0;
  if (kind === "stop") return direction === "LONG" ? price - lo : hi - price;
  return direction === "LONG" ? hi - price : price - lo;
}

function formatPrice(price: number) {
  return Number.isInteger(price) ? String(price) : String(Math.round(price * 100) / 100);
}

function pickRepair(price: number, kind: Kind, direction: Side, lo: number, hi: number, lessons: DigitEdit[]) {
  const gap = wrongGap(kind, direction, price, lo, hi);
  if (gap < MIN_TYPO_GAP) return null;
  const boundary = edge(kind, direction, lo, hi);
  const candidates = oneDigitVariants(price)
    .filter((value) => isGold(value) && onValidSide(kind, direction, value, lo, hi))
    .map((value) => ({ value, distance: Math.abs(value - boundary) }))
    .filter((candidate) => candidate.distance <= MAX_REPAIR_DISTANCE);
  if (!candidates.length) return null;
  const taught = candidates.filter((candidate) =>
    lessons.some((edit) => samePrice(edit.from, price) && samePrice(edit.to, candidate.value)),
  );
  const pool = taught.length === 1 ? taught : candidates;
  const ranked = [...pool].sort((a, b) => a.distance - b.distance || a.value - b.value);
  if (ranked.length > 1 && ranked[0].distance === ranked[1].distance) return null;
  return { value: ranked[0].value, usedLesson: taught.length === 1 };
}

export interface RepairResult {
  fields: ParsedSignalFields;
  notes: string[];
  usedLesson: boolean;
}

/** Rewrites an obvious one-digit typo. A small wrong-side gap is left for review. */
export function repairWrongSidePrices(fields: ParsedSignalFields, lessons: DigitEdit[] = []): RepairResult {
  const next: ParsedSignalFields = JSON.parse(JSON.stringify(fields));
  const notes: string[] = [];
  let usedLesson = false;
  const direction = next.direction.value;
  const lo = next.entryMin.value;
  const hi = next.entryMax.value;
  if (!direction || lo === null || hi === null) return { fields: next, notes, usedLesson };

  if (next.stopLoss.value !== null) {
    const repaired = pickRepair(next.stopLoss.value, "stop", direction, lo, hi, lessons);
    if (repaired) {
      notes.push(`Repaired stop ${formatPrice(next.stopLoss.value)} to ${formatPrice(repaired.value)} (one-digit typo).`);
      next.stopLoss = { value: repaired.value, confidence: 0.88 };
      usedLesson = usedLesson || repaired.usedLesson;
    }
  }

  const targets = next.targets.value ?? [];
  let targetsChanged = false;
  const rewritten = targets.map((target) => {
    const repaired = pickRepair(target, "target", direction, lo, hi, lessons);
    if (!repaired) return target;
    notes.push(`Repaired target ${formatPrice(target)} to ${formatPrice(repaired.value)} (one-digit typo).`);
    targetsChanged = true;
    usedLesson = usedLesson || repaired.usedLesson;
    return repaired.value;
  });
  if (targetsChanged) next.targets = { value: rewritten, confidence: 0.88 };
  next.targets.value = [...(next.targets.value ?? [])].sort((a, b) => (direction === "LONG" ? a - b : b - a));
  return { fields: next, notes, usedLesson };
}

export function geometryIsValid(fields: ParsedSignalFields) {
  const direction = fields.direction.value;
  const lo = fields.entryMin.value;
  const hi = fields.entryMax.value;
  if (!direction || lo === null || hi === null) return false;
  const stop = fields.stopLoss.value;
  if (stop !== null && !onValidSide("stop", direction, stop, lo, hi)) return false;
  return (fields.targets.value ?? []).every((target) => onValidSide("target", direction, target, lo, hi));
}
