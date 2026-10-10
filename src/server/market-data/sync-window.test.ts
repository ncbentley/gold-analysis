import { describe, expect, it } from "vitest";
import { LIVE_BAR_GAP_MS, ROUTINE_SYNC_LOOKBACK_MS, routineRest, routineSyncStart, seriesRepair, syncedRecently } from "./sync-window";

const NOW = Date.UTC(2026, 9, 7, 15, 49);
const LATER = Date.UTC(2026, 9, 13, 14, 54);

describe("routineSyncStart", () => {
  it("refills a recent window when the cursor is ahead of the clock", () => {
    expect(routineSyncStart(LATER, NOW, NOW)).toBe(NOW - ROUTINE_SYNC_LOOKBACK_MS);
  });

  it("continues from a cursor that is behind the clock", () => {
    const cursor = NOW - 60_000;
    expect(routineSyncStart(cursor, NOW, NOW)).toBe(cursor);
  });

  it("looks back when there is no cursor", () => {
    expect(routineSyncStart(null, NOW, NOW)).toBe(NOW - ROUTINE_SYNC_LOOKBACK_MS);
  });
});

describe("seriesRepair", () => {
  const now = Date.UTC(2026, 9, 7, 15, 49);

  it("replaces the series when a synthetic bar is stored", () => {
    expect(seriesRepair({ foreignProvider: true, newestMs: now, nowMs: now })).toBe("reset");
  });

  it("drops a bar dated after the clock when the series is otherwise real", () => {
    expect(seriesRepair({ foreignProvider: false, newestMs: now + 86_400_000, nowMs: now })).toBe("drop-future");
  });

  it("leaves a real series that ends at the clock", () => {
    expect(seriesRepair({ foreignProvider: false, newestMs: now - 60_000, nowMs: now })).toBe("clean");
  });
});

describe("routineRest", () => {
  const now = Date.UTC(2026, 9, 7, 15, 49);

  it("skips the provider when the socket bar and the cursor are both current", () => {
    expect(
      routineRest({
        newestBarMs: now - 30_000,
        syncedThroughMs: now - LIVE_BAR_GAP_MS,
        nowMs: now,
        marketOpen: true,
      }),
    ).toBe("skip");
  });

  it("fetches when the newest bar is current but the cursor is behind it", () => {
    expect(
      routineRest({
        newestBarMs: now - 30_000,
        syncedThroughMs: now - LIVE_BAR_GAP_MS - 60_000,
        nowMs: now,
        marketOpen: true,
      }),
    ).toBe("fetch");
  });

  it("fetches when the market is open and the newest bar is stale", () => {
    expect(
      routineRest({
        newestBarMs: now - LIVE_BAR_GAP_MS - 60_000,
        syncedThroughMs: now - LIVE_BAR_GAP_MS - 60_000,
        nowMs: now,
        marketOpen: true,
      }),
    ).toBe("fetch");
  });

  it("fetches when nothing is stored", () => {
    expect(routineRest({ newestBarMs: null, syncedThroughMs: null, nowMs: now, marketOpen: true })).toBe("fetch");
  });

  it("does not poll while the market is closed and a bar is stored", () => {
    expect(
      routineRest({
        newestBarMs: now - 3 * 86_400_000,
        syncedThroughMs: now - 3 * 86_400_000,
        nowMs: now,
        marketOpen: false,
      }),
    ).toBe("closed");
  });

  it("fetches a closed market that has no bars yet", () => {
    expect(routineRest({ newestBarMs: null, syncedThroughMs: null, nowMs: now, marketOpen: false })).toBe("fetch");
  });
});

describe("syncedRecently", () => {
  it("does not treat a future updatedAt as a recent sync", () => {
    expect(syncedRecently(LATER, NOW, 60_000)).toBe(false);
  });

  it("treats a sync inside the interval as recent", () => {
    expect(syncedRecently(NOW - 30_000, NOW, 60_000)).toBe(true);
  });
});
