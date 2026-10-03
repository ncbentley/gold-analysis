import { evaluateSignal, type EngineBar, type EngineOutcome } from "@/server/outcomes/engine";
import { ideaPhase, type IdeaPhase } from "./phase";

export interface IdeaLevels {
  direction: "LONG" | "SHORT";
  entryMin: number;
  entryMax: number;
  stopLoss: number | null;
  targets: number[];
  /** First counting post. The walk starts here, on whatever bars are passed in. */
  startedAt: number;
}

/**
 * The idea is its own order. Fill, stop, and targets come from its prices and the
 * bars, not from whether every source trade has closed. Minute bars today; the
 * same walk accepts a finer series when one is stored.
 */
export function replayIdea(idea: IdeaLevels, bars: EngineBar[], spot: number | null): { phase: IdeaPhase; outcome: EngineOutcome } {
  const outcome = evaluateSignal(
    {
      direction: idea.direction,
      entryType: "ZONE",
      entryMin: idea.entryMin,
      entryMax: idea.entryMax,
      stopLoss: idea.stopLoss,
      targets: idea.targets,
      signalTime: idea.startedAt,
      // Price decides an unfilled idea. A clock expiry would close it while the entry is still there.
      expiryTime: idea.startedAt + 100 * 365 * 24 * 60 * 60_000,
    },
    bars,
  );
  const closed = outcome.entered && outcome.exitTime !== null && outcome.classification !== "OPEN";
  return {
    outcome,
    phase: ideaPhase({
      direction: idea.direction,
      entryMin: idea.entryMin,
      entryMax: idea.entryMax,
      stopLoss: idea.stopLoss,
      spot,
      entered: outcome.entered,
      closed,
      cancelled: false,
    }),
  };
}
