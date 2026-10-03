export interface BoardSnapshot {
  signalIds: string[];
  ideaIds: string[];
  directionKey: string | null;
}

export type BoardAction = "clear" | "keep" | "call";

/** Whether this pass should call the model. Phase changes alone do not. */
export function decideBoard(live: BoardSnapshot, previous: BoardSnapshot | null): BoardAction {
  if (live.signalIds.length + live.ideaIds.length === 0) return "clear";
  if (!previous) return "call";
  const signals = new Set(previous.signalIds);
  const ideas = new Set(previous.ideaIds);
  const addedSignal = live.signalIds.some((id) => !signals.has(id));
  const addedIdea = live.ideaIds.some((id) => !ideas.has(id));
  if (addedSignal || addedIdea || live.directionKey !== previous.directionKey) return "call";
  return "keep";
}
