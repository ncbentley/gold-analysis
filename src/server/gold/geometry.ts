export interface GoldLevel {
  id: string;
  direction: "LONG" | "SHORT";
  entryMin: number;
  entryMax: number;
  stopLoss: number | null;
}

function blockedBy(candidate: GoldLevel, live: GoldLevel): boolean {
  if (live.stopLoss === null) return false;
  if (live.direction === "LONG") return candidate.entryMax < live.stopLoss;
  return candidate.entryMin > live.stopLoss;
}

/** True when price can reach the candidate without trading through a live Gold stop. */
export function entryReachable(candidate: GoldLevel, live: GoldLevel[]): boolean {
  return live.every((idea) => idea.id === candidate.id || !blockedBy(candidate, idea));
}
