import { normalizeInstrument, sameZone } from "@/server/consensus/rules";

export interface OpenTradeShape {
  instrument: string;
  direction: "LONG" | "SHORT";
  entryMin: number;
  entryMax: number;
  stopLoss: number | null;
  targetCount: number;
}

export interface IncomingTradeShape {
  instrument: string;
  direction: "LONG" | "SHORT";
  entryMin: number;
  entryMax: number;
  stopLoss: number | null;
  targets: Array<number | null>;
}

export interface LevelsToAttach {
  stopLoss: number | null;
  targets: number[];
}

function near(a: number, b: number) {
  return Math.abs(a - b) < 0.001;
}

function stopFits(direction: "LONG" | "SHORT", entryMin: number, entryMax: number, stop: number) {
  return direction === "LONG" ? stop < entryMin : stop > entryMax;
}

function targetFits(direction: "LONG" | "SHORT", entryMin: number, entryMax: number, target: number) {
  return direction === "LONG" ? target > entryMax : target < entryMin;
}

/**
 * A later message from the same source that adds a stop or targets onto an open
 * trade at the same entry. Prices already on the open trade are not replaced.
 * Returns null when this is a different trade, so the caller can publish it.
 */
export function levelsToAttach(open: OpenTradeShape, incoming: IncomingTradeShape): LevelsToAttach | null {
  if (open.direction !== incoming.direction) return null;
  if (normalizeInstrument(open.instrument) !== normalizeInstrument(incoming.instrument)) return null;
  if (!sameZone(open, incoming)) return null;
  if (open.stopLoss !== null && incoming.stopLoss !== null && !near(open.stopLoss, incoming.stopLoss)) return null;

  const stop = open.stopLoss === null ? incoming.stopLoss : null;
  const targets = open.targetCount === 0 ? incoming.targets.filter((price): price is number => price !== null) : [];
  if (stop !== null && !stopFits(open.direction, open.entryMin, open.entryMax, stop)) return null;
  if (targets.some((price) => !targetFits(open.direction, open.entryMin, open.entryMax, price))) return null;
  if (stop === null && targets.length === 0) return null;
  return { stopLoss: stop, targets };
}
