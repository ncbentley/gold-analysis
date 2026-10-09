import type { IdeaPhase } from "@/server/ideas/phase";

export interface ZoneDistance {
  points: number;
  place: "above" | "below" | "inside";
}

export interface IdeaGlance {
  hits: boolean[];
  /** Realized R once the trade is done. Mark-to-market R while it is open. */
  r: number | null;
  realized: boolean;
  /** How far spot sits from the entry zone. Set while the call is still unfilled. */
  distance: ZoneDistance | null;
}

interface GlanceOutcome {
  entered: boolean;
  entryPrice: number | null;
  risk: number | null;
  rResult: number | null;
  exitTime: number | null;
  targets: { hitAt: number | null }[];
  checkpoint: { exits: { price: number; weight: number }[]; remaining: number } | null;
}

const round = (n: number) => Math.round(n * 10_000) / 10_000;

/** Points from spot to the nearest edge of the entry zone. */
export function zoneDistance(entryMin: number, entryMax: number, spot: number | null): ZoneDistance | null {
  if (spot === null) return null;
  if (spot > entryMax) return { points: round(spot - entryMax), place: "above" };
  if (spot < entryMin) return { points: round(entryMin - spot), place: "below" };
  return { points: 0, place: "inside" };
}

/**
 * Open R is the booked target exits plus the remainder marked at spot, in the
 * same equal-weight units the outcome engine uses.
 */
export function openMarkR(input: {
  direction: "LONG" | "SHORT";
  entryPrice: number;
  risk: number | null;
  spot: number | null;
  exits: { price: number; weight: number }[];
  remaining: number;
  targetCount: number;
}): number | null {
  if (input.spot === null || input.risk === null || input.risk === 0) return null;
  const dir = input.direction === "LONG" ? 1 : -1;
  const weight = 1 / Math.max(input.targetCount, 1);
  const booked = input.exits.reduce((sum, exit) => sum + (exit.price - input.entryPrice) * dir * exit.weight, 0);
  const open = (input.spot - input.entryPrice) * dir * weight * input.remaining;
  return round((booked + open) / input.risk);
}

export function tradeGlance(input: {
  phase: IdeaPhase;
  direction: "LONG" | "SHORT";
  entryMin: number;
  entryMax: number;
  spot: number | null;
  outcome: GlanceOutcome | null;
}): IdeaGlance {
  const outcome = input.outcome;
  const hits = outcome?.targets.map((target) => target.hitAt !== null) ?? [];
  if (input.phase === "available" || !outcome?.entered) {
    if (input.phase !== "available") return { hits, r: outcome?.rResult ?? null, realized: input.phase === "history", distance: null };
    return { hits, r: null, realized: false, distance: zoneDistance(input.entryMin, input.entryMax, input.spot) };
  }
  const finished = outcome.exitTime !== null || input.phase === "history";
  if (finished) return { hits, r: outcome.rResult, realized: true, distance: null };
  if (outcome.entryPrice === null) return { hits, r: null, realized: false, distance: null };
  const checkpoint = outcome.checkpoint;
  const r = openMarkR({
    direction: input.direction,
    entryPrice: outcome.entryPrice,
    risk: outcome.risk,
    spot: input.spot,
    exits: checkpoint?.exits ?? [],
    remaining: checkpoint?.remaining ?? Math.max(outcome.targets.length, 1),
    targetCount: outcome.targets.length,
  });
  return { hits, r, realized: false, distance: null };
}
