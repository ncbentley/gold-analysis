import { inArray } from "drizzle-orm";
import { tradeGlance } from "@/lib/trade-glance";
import { getDb } from "@/server/db";
import { consolidatedIdeas } from "@/server/db/schema";
import type { Viewer } from "@/server/entitlements/service";
import { replayIdea } from "@/server/ideas/replay";
import type { ListedIdea } from "@/server/ideas/service";
import { getEngineBars, getEngineTicks } from "@/server/market-data";
import { goldSection } from "./close";
import { listGoldEntries } from "./store";

export interface GoldBookCard extends ListedIdea {
  close: boolean;
  section: "available" | "active" | "history";
  href: string;
}

/** Newest call first. History previews keep this order, then take the first few. */
export function byNewest<T extends { newestSignalAt: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => Date.parse(b.newestSignalAt) - Date.parse(a.newestSignalAt));
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
  const windowStart = new Date(from);
  const windowEnd = new Date(now + 60_000);
  const [bars, ticks] = rows.length ? await Promise.all([getEngineBars(windowStart, windowEnd), getEngineTicks(windowStart, windowEnd)]) : [[], []];
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
      ticks,
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
      glance: tradeGlance({
        phase: section === "active" ? "playing-out" : section,
        direction: row.direction,
        entryMin: row.entryMin,
        entryMax: row.entryMax,
        spot,
        outcome: played.outcome,
      }),
    });
  }
  return byNewest(cards);
}
