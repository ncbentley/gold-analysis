import { repairWrongSidePrices, type DigitEdit } from "./repair";
import type { ParsedSignalFields } from "./types";

const PLAUSIBLE_GOLD = { min: 500, max: 20_000 };

/**
 * Validates required fields and price geometry. Never fills in missing prices;
 * it only lowers confidence and records issues so the event can go to manual review.
 */
export function finalizeSignal(fields: ParsedSignalFields, lessons: DigitEdit[] = []) {
  const issues: string[] = [];
  const repaired = repairWrongSidePrices(fields, lessons);
  const s = repaired.fields;
  issues.push(...repaired.notes);

  if (s.direction.value === null) issues.push("Direction is missing or contradictory.");
  if (s.entryMin.value === null || s.entryMax.value === null) {
    if (s.entryType.value !== "MARKET") issues.push("Entry price is missing.");
  }
  if (s.stopLoss.value === null) {
    issues.push("Stop loss is missing.");
    s.stopLoss.confidence = 0.5;
  }
  if (s.targets.value?.length === 0) issues.push("No targets stated.");
  if (s.instrument.confidence < 1) issues.push(`Instrument not stated; assumed ${s.instrument.value}.`);
  if (s.entryType.confidence < 0.8) issues.push("Entry type is unclear (market vs. limit).");

  const prices = [s.entryMin.value, s.entryMax.value, s.stopLoss.value, ...(s.targets.value ?? [])].filter(
    (p): p is number => p !== null,
  );
  if (prices.some((p) => p < PLAUSIBLE_GOLD.min || p > PLAUSIBLE_GOLD.max)) {
    issues.push("A price is outside the plausible gold range.");
    s.entryMin.confidence = Math.min(s.entryMin.confidence, 0.3);
  }

  const dir = s.direction.value;
  const lo = s.entryMin.value;
  const hi = s.entryMax.value;
  if (dir && lo !== null && hi !== null) {
    const stop = s.stopLoss.value;
    if (stop !== null && (dir === "LONG" ? stop >= lo : stop <= hi)) {
      issues.push(`Stop loss is on the wrong side of entry for a ${dir.toLowerCase()} trade.`);
      s.stopLoss.confidence = 0.3;
    }
    const tps = s.targets.value ?? [];
    const wrongSide = tps.filter((t) => (dir === "LONG" ? t <= hi : t >= lo));
    if (wrongSide.length) {
      issues.push("One or more targets are on the wrong side of entry.");
      s.targets.confidence = 0.3;
    }
    s.targets.value = [...tps].sort((a, b) => (dir === "LONG" ? a - b : b - a));
  }

  const required = [s.direction, s.entryType, s.entryMin, s.entryMax, s.stopLoss, s.targets, s.instrument];
  const confidence = Math.min(...required.map((x) => x.confidence));
  return { signal: s, issues, confidence: Math.round(confidence * 100) / 100 };
}
