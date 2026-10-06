/** An unfilled Gold call this old can be closed once price has left the entry. */
export const STALE_UNFILLED_MS = 3 * 24 * 60 * 60 * 1000;

/** Spot farther than this many entry-to-stop distances has left the order behind. */
export const LEFT_BEHIND_R = 8;

/** A fill with a target still open is working. The first target is not a reason to close it. */
export function filledTradeStillOpen(outcome: { entered: boolean; stopHitAt: number | null; targets: { hitAt: number | null }[] }) {
  return outcome.entered && outcome.stopHitAt === null && outcome.targets.some((target) => target.hitAt === null);
}

/**
 * An unfilled call whose market has moved away from the entry.
 * A long is left behind when price is far above the zone. A short is left behind when price is far below it.
 * A new call is kept, even if the zone is distant, until it has been sitting for a few days.
 */
export function entryLeftBehind(input: {
  direction: "LONG" | "SHORT";
  entryMin: number;
  entryMax: number;
  stopLoss: number | null;
  spot: number | null;
  calledAt: number;
  now: number;
}) {
  if (input.spot === null || input.stopLoss === null) return false;
  if (input.now - input.calledAt < STALE_UNFILLED_MS) return false;
  const edge = input.direction === "LONG" ? input.entryMin : input.entryMax;
  const risk = Math.abs(input.stopLoss - edge);
  if (risk <= 0) return false;
  const away = input.direction === "LONG" ? input.spot - input.entryMax : input.entryMin - input.spot;
  return away > risk * LEFT_BEHIND_R;
}

/**
 * An unfilled call Silver is not showing.
 * A sourced call has to be one of the available silver ideas. A composed zone needs silver to have something to curate.
 */
export function goldCallOutsideSilver(input: { ideaId: string | null; silverAvailable: ReadonlySet<string> }) {
  if (input.ideaId) return !input.silverAvailable.has(input.ideaId);
  return input.silverAvailable.size === 0;
}

export type GoldBookAction = "keep" | "reopen" | "close";

/** Whether a stored Gold row should stay, come back from a bad close, or leave the live book. */
export function goldBookAction(input: {
  closeCalledAt: number | null;
  entered: boolean;
  stopHitAt: number | null;
  targets: { hitAt: number | null }[];
  leftBehind: boolean;
  outsideSilver: boolean;
}): GoldBookAction {
  const working = filledTradeStillOpen(input);
  if (input.closeCalledAt !== null) return working ? "reopen" : "keep";
  if (working) return "keep";
  if (!input.entered && (input.leftBehind || input.outsideSilver)) return "close";
  return "keep";
}

/**
 * Unfilled Gold calls beyond the number of available silver ideas.
 * Composed zones leave first, then the newest call. A filled trade is not in this list.
 */
export function goldIdsOverSilverCount(input: {
  rows: { id: string; ideaId: string | null; createdAt: number }[];
  silverCount: number;
}) {
  const extra = input.rows.length - input.silverCount;
  if (extra <= 0) return [];
  return [...input.rows]
    .sort((a, b) => {
      const rank = (row: { ideaId: string | null }) => (row.ideaId === null ? 0 : 1);
      if (rank(a) !== rank(b)) return rank(a) - rank(b);
      return b.createdAt - a.createdAt;
    })
    .slice(0, extra)
    .map((row) => row.id);
}
