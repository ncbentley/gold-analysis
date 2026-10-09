import { inArray } from "drizzle-orm";
import { tradeGlance, type IdeaGlance } from "@/lib/trade-glance";
import { getDb } from "@/server/db";
import { consolidatedIdeas } from "@/server/db/schema";
import type { IdeaPhase } from "./phase";
import { replayConsolidatedIdeas, type ListedIdea } from "./service";

export type GlancedIdea<T> = T & { glance: IdeaGlance };

/** Adds the book mark. An unfilled call only needs spot. A filled one is replayed. */
export async function annotateIdeaGlance<T extends Pick<ListedIdea, "id" | "phase" | "direction" | "entryMin" | "entryMax" | "targets">>(
  items: T[],
  spot: number | null,
): Promise<GlancedIdea<T>[]> {
  const filled = items.filter((item) => item.phase !== "available");
  const db = await getDb();
  const rows = filled.length
    ? await db.select().from(consolidatedIdeas).where(inArray(consolidatedIdeas.id, filled.map((item) => item.id)))
    : [];
  const played = await replayConsolidatedIdeas(rows, spot);
  return items.map((item) => {
    const outcome = played.get(item.id)?.outcome ?? null;
    return {
      ...item,
      glance: tradeGlance({
        phase: item.phase as IdeaPhase,
        direction: item.direction,
        entryMin: item.entryMin,
        entryMax: item.entryMax,
        spot,
        outcome,
      }),
    };
  });
}
