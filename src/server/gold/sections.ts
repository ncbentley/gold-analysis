import { inArray } from "drizzle-orm";
import { getDb } from "@/server/db";
import { consolidatedIdeas } from "@/server/db/schema";
import type { Viewer } from "@/server/entitlements/service";
import { replayIdea } from "@/server/ideas/replay";
import type { ListedIdea } from "@/server/ideas/service";
import { getEngineBars } from "@/server/market-data";
import { goldSection } from "./close";
import { listGoldEntries } from "./store";

export interface GoldBookCard extends ListedIdea {
  close: boolean;
  section: "available" | "active" | "history";
  href: string;
}

/** One card per Gold book row. Prices are the model's, including a zone it composed itself. */
export async function goldBookCards(_viewer: Viewer, spot: number | null, now = Date.now()): Promise<GoldBookCard[]> {
  const rows = await listGoldEntries();
  const ideaIds = rows.map((row) => row.ideaId).filter((id): id is string => Boolean(id));
  const db = await getDb();
  const ideaRows = ideaIds.length
    ? await db
        .select({
          id: consolidatedIdeas.id,
          sourceCount: consolidatedIdeas.sourceCount,
          newestSignalAt: consolidatedIdeas.newestSignalAt,
        })
        .from(consolidatedIdeas)
        .where(inArray(consolidatedIdeas.id, ideaIds))
    : [];
  const byId = new Map(ideaRows.map((idea) => [idea.id, idea]));
  const from = rows.reduce((min, row) => Math.min(min, row.createdAt.getTime()), now);
  const bars = rows.length ? await getEngineBars(new Date(from), new Date(now + 60_000)) : [];
  const cards: GoldBookCard[] = [];
  for (const row of rows) {
    const idea = row.ideaId ? byId.get(row.ideaId) : undefined;
    const played = replayIdea(
      {
        direction: row.direction,
        entryMin: row.entryMin,
        entryMax: row.entryMax,
        stopLoss: row.stopLoss,
        targets: row.targets,
        startedAt: row.createdAt.getTime(),
      },
      bars,
      spot,
      true,
    );
    const finished = played.outcome.entered && played.outcome.exitTime !== null && played.phase === "history";
    const section = goldSection(
      {
        sectionAtCall: row.sectionAtCall,
        closeCalledAt: row.closeCalledAt ? row.closeCalledAt.getTime() : null,
        phase: played.phase,
        finished,
      },
      now,
    );
    cards.push({
      id: row.id,
      direction: row.direction,
      entryMin: row.entryMin,
      entryMax: row.entryMax,
      stopLoss: row.stopLoss,
      targets: row.targets,
      sourceCount: idea?.sourceCount ?? 0,
      newestSignalAt: (idea?.newestSignalAt ?? row.createdAt).toISOString(),
      phase: section === "active" ? "playing-out" : section,
      close: row.closeCalledAt !== null && section !== "history",
      section,
      href: `/gold/${row.id}`,
    });
  }
  return cards;
}
