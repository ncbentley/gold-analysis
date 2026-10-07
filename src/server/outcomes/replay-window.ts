/** Replay stops at the earlier of the sync cursor and the clock. A later bar is not a fill. */
export function knownMarketThrough(syncedThroughMs: number, nowMs: number): number {
  return Math.min(syncedThroughMs, nowMs);
}

/** A computed fill or exit after the clock was scored on a bar that had not happened yet. */
export function outcomeUsesFutureBar(
  outcome: {
    kind: string;
    entryTime: Date | null;
    exitTime: Date | null;
    checkpointBarTime?: number | null;
  } | null,
  nowMs: number,
): boolean {
  if (!outcome || outcome.kind !== "computed") return false;
  if (outcome.entryTime && outcome.entryTime.getTime() > nowMs) return true;
  if (outcome.exitTime && outcome.exitTime.getTime() > nowMs) return true;
  return outcome.checkpointBarTime != null && outcome.checkpointBarTime > nowMs;
}
