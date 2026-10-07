const DAY_MS = 86_400_000;

/** How far back a routine sync looks when it has no usable cursor. */
export const ROUTINE_SYNC_LOOKBACK_MS = 3 * DAY_MS;

/** A timestamp ahead of the clock is not a recent sync. It must not freeze the next fetch. */
export function syncedRecently(updatedAtMs: number, nowMs: number, intervalMs: number): boolean {
  return updatedAtMs <= nowMs && nowMs - updatedAtMs < intervalMs;
}

export type SeriesRepair = "clean" | "reset" | "drop-future";

/** Synthetic rows share a timestamp with real bars, so any of them means the stored series has to be replaced. */
export function seriesRepair(input: { foreignProvider: boolean; newestMs: number | null; nowMs: number }): SeriesRepair {
  if (input.foreignProvider) return "reset";
  if (input.newestMs !== null && input.newestMs > input.nowMs) return "drop-future";
  return "clean";
}

/** Where a routine sync starts reading. A cursor ahead of the clock is not caught up. */
export function routineSyncStart(syncedThroughMs: number | null, toMs: number, nowMs: number): number {
  const fallback = toMs - ROUTINE_SYNC_LOOKBACK_MS;
  if (syncedThroughMs === null || syncedThroughMs > nowMs) return fallback;
  return syncedThroughMs;
}
