const DAY_MS = 86_400_000;

/** How far back a routine sync looks when it has no usable cursor. */
export const ROUTINE_SYNC_LOOKBACK_MS = 3 * DAY_MS;

/** A live bar this close to the clock means the price socket is covering the minute. */
export const LIVE_BAR_GAP_MS = 2 * 60_000;

export type RoutineRest = "skip" | "fetch" | "closed";

/**
 * Whether a routine sync should call the provider.
 * `skip` — the newest bar and the cursor are both within LIVE_BAR_GAP of the clock.
 * `closed` — the market is shut and a bar exists, so there is nothing to poll.
 * `fetch` — nothing is stored, the cursor is behind the newest bar, or the tip is stale while the market is open.
 */
export function routineRest(input: {
  newestBarMs: number | null;
  syncedThroughMs: number | null;
  nowMs: number;
  marketOpen: boolean;
}): RoutineRest {
  if (input.newestBarMs === null) return "fetch";
  if (!input.marketOpen) return "closed";
  const tipFresh = input.nowMs - input.newestBarMs <= LIVE_BAR_GAP_MS;
  const cursorClose =
    input.syncedThroughMs !== null &&
    input.syncedThroughMs <= input.nowMs &&
    input.newestBarMs - input.syncedThroughMs <= LIVE_BAR_GAP_MS;
  if (tipFresh && cursorClose) return "skip";
  return "fetch";
}

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
