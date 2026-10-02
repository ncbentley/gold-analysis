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
