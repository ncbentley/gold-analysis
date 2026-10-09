export type IdeaPhase = "available" | "playing-out" | "history";

/** A bar this long after the call is a later print, not a path from the call. */
export const CALL_COVER_MS = 20 * 60 * 1000;

/** After this, a missing path no longer keeps a call that price has already left. */
export const UNCOVERED_GRACE_MS = 3 * 24 * 60 * 60 * 1000;

/** True when a stored bar begins at the call. A print that shows up later leaves a hole. */
export function callCovered(bars: { t: number }[], startedAt: number): boolean {
  let first = Infinity;
  for (const bar of bars) {
    if (bar.t >= startedAt && bar.t < first) first = bar.t;
  }
  return Number.isFinite(first) && first - startedAt <= CALL_COVER_MS;
}

export interface PhaseInput {
  direction: "LONG" | "SHORT";
  entryMin: number;
  entryMax: number;
  stopLoss: number | null;
  spot: number | null;
  entered: boolean;
  closed: boolean;
  cancelled: boolean;
  /** False when the stored series does not start at the call. Spot is then not a reason to retire a fresh call. */
  covered?: boolean;
  /** Call time. With `now`, a hole older than `UNCOVERED_GRACE_MS` uses spot again. */
  calledAt?: number;
  now?: number;
}

export interface PhaseMember {
  status: string;
  outcome: {
    entered: boolean;
    exitTime: Date | null;
    classification: string;
  } | null;
}

/** Flags for `ideaPhase` from counting constituents. Missing members are skipped. */
export function phaseFromMembers(members: Array<PhaseMember | null | undefined>): {
  entered: boolean;
  closed: boolean;
  cancelled: boolean;
} {
  const present = members.filter((member): member is PhaseMember => member != null);
  if (!present.length) return { entered: false, closed: false, cancelled: false };
  const enteredMembers = present.filter((member) => member.outcome?.entered);
  const entered = enteredMembers.length > 0;
  const closed = entered && enteredMembers.every((member) => member.outcome?.exitTime != null);
  const retired = (member: PhaseMember) => {
    if (member.outcome) return member.outcome.classification === "CANCELLED" || member.outcome.classification === "EXPIRED";
    return member.status === "CANCELLED" || member.status === "EXPIRED";
  };
  return { entered, closed, cancelled: !entered && present.every(retired) };
}

function uncoveredGraceElapsed(calledAt: number | undefined, now: number | undefined) {
  return calledAt != null && now != null && now - calledAt >= UNCOVERED_GRACE_MS;
}

/** An unfilled order price has run past by more than one stop. It is no longer a live entry. */
function leftTheOrder(input: PhaseInput) {
  const { direction, entryMin, entryMax, stopLoss, spot } = input;
  if (spot === null || stopLoss === null) return false;
  if (direction === "LONG") {
    const risk = entryMax - stopLoss;
    return risk > 0 && spot - entryMax > risk;
  }
  const risk = stopLoss - entryMin;
  return risk > 0 && entryMin - spot > risk;
}

export function ideaPhase(input: PhaseInput): IdeaPhase {
  if (input.cancelled || input.closed) return "history";
  if (input.entered) return "playing-out";
  if (leftTheOrder(input)) return "history";
  const freshHole = input.covered === false && !uncoveredGraceElapsed(input.calledAt, input.now);
  if (freshHole || input.spot === null) return "available";
  const { direction, entryMin, entryMax, stopLoss, spot } = input;
  if (direction === "LONG") {
    if (stopLoss !== null && spot <= stopLoss) return "history";
    if (spot < entryMin) return "history";
    return "available";
  }
  if (stopLoss !== null && spot >= stopLoss) return "history";
  if (spot > entryMax) return "history";
  return "available";
}
