import { gte } from "drizzle-orm";
import { currentBoard } from "@/server/board/service";
import { getDb } from "@/server/db";
import { consolidatedIdeas } from "@/server/db/schema";
import type { GoldLevel } from "./geometry";
import { applyProposal } from "./publish";
import { insertGoldEntry, listGoldEntries, liveGoldLevels, markGoldClose } from "./store";

/** Copies a fresh model board into the Gold book. A failed model call never reaches here. */
export async function publishBoardIdeasToGold() {
  const db = await getDb();
  const rows = await db.select().from(consolidatedIdeas).where(gte(consolidatedIdeas.sourceCount, 3));
  const ideas: (GoldLevel & { targets: number[]; phase: string })[] = rows.map((row) => ({
    id: row.id,
    direction: row.direction,
    entryMin: row.entryMin,
    entryMax: row.entryMax,
    stopLoss: row.stopLoss,
    targets: row.targets,
    phase: row.phase,
  }));
  const stored = await listGoldEntries();
  const stillOpen = new Set(ideas.filter((idea) => idea.phase !== "history").map((idea) => idea.id));
  const board = await currentBoard(null);
  const addIdeaIds = board.post?.active ? [board.post.primary, ...board.post.alternates].flatMap((pick) => pick.ideaIds) : [];
  return applyProposal({
    ideas,
    live: liveGoldLevels(stored).filter((level) => stillOpen.has(level.id)),
    propose: async () => ({ addIdeaIds, closeIdeaIds: [] }),
    write: async (plan) => {
      const byId = new Map(ideas.map((idea) => [idea.id, idea]));
      for (const idea of plan.add) {
        const full = byId.get(idea.id);
        if (full) await insertGoldEntry(full);
      }
      for (const id of plan.closeIds) {
        const idea = byId.get(id);
        await markGoldClose(id, new Date(), idea?.phase === "playing-out" ? "active" : "available");
      }
    },
  });
}
