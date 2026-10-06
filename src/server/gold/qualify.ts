/** A fill with a target still open is working. The first target is not a reason to close it. */
export function filledTradeStillOpen(outcome: { entered: boolean; stopHitAt: number | null; targets: { hitAt: number | null }[] }) {
  return outcome.entered && outcome.stopHitAt === null && outcome.targets.some((target) => target.hitAt === null);
}

/**
 * An unfilled Gold call that Silver is not showing as available.
 * A composed zone counts only while Silver has something available to curate.
 */
export function unfilledGoldCallUnbacked(input: { entered: boolean; ideaId: string | null; silverAvailable: ReadonlySet<string> }) {
  if (input.entered) return false;
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
  ideaId: string | null;
  silverAvailable: ReadonlySet<string>;
}): GoldBookAction {
  const working = filledTradeStillOpen(input);
  if (input.closeCalledAt !== null) return working ? "reopen" : "keep";
  if (working) return "keep";
  if (unfilledGoldCallUnbacked(input)) return "close";
  return "keep";
}
