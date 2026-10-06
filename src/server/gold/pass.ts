import { entryReachable, type GoldLevel } from "./geometry";

export interface GoldProposal {
  addIdeaIds: string[];
  closeIdeaIds: string[];
}

export function planGoldUpdate(input: { proposal: GoldProposal; ideas: GoldLevel[]; live: GoldLevel[] }): {
  add: GoldLevel[];
  closeIds: string[];
} {
  const byId = new Map(input.ideas.map((idea) => [idea.id, idea]));
  const liveIds = new Set(input.live.map((idea) => idea.id));
  const add: GoldLevel[] = [];
  const live = [...input.live];
  for (const id of input.proposal.addIdeaIds) {
    const idea = byId.get(id);
    if (!idea || liveIds.has(idea.id) || !entryReachable(idea, live)) continue;
    add.push(idea);
    live.push(idea);
    liveIds.add(idea.id);
  }
  const closeIds = input.proposal.closeIdeaIds.filter((id) => liveIds.has(id) && !add.some((idea) => idea.id === id));
  return { add, closeIds };
}
