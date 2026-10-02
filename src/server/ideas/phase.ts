export type IdeaPhase = "available" | "playing-out" | "history";

export interface PhaseInput {
  direction: "LONG" | "SHORT";
  entryMin: number;
  entryMax: number;
  stopLoss: number | null;
  spot: number | null;
  entered: boolean;
  closed: boolean;
  cancelled: boolean;
}

export function ideaPhase(input: PhaseInput): IdeaPhase {
  if (input.cancelled || input.closed) return "history";
  if (input.entered) return "playing-out";
  if (input.spot === null) return "available";
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
