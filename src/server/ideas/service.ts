import { and, asc, eq, gte, inArray, isNull } from "drizzle-orm";
import { getDb } from "@/server/db";
import { consolidatedIdeas, signalTargets, signals, sources } from "@/server/db/schema";
import { groupSignals } from "./group";

const WINDOW_MS = 48 * 60 * 60 * 1000;

export async function replaceConsolidatedIdeas(now = Date.now()) {
  const db = await getDb();
  const since = new Date(now - WINDOW_MS);
  const rows = await db
    .select({ signal: signals, source: sources })
    .from(signals)
    .innerJoin(sources, eq(sources.id, signals.sourceId))
    .where(and(gte(signals.signalTime, since), isNull(sources.removedAt)));
  const ids = rows.map((r) => r.signal.id);
  const targetRows = ids.length
    ? await db.select().from(signalTargets).where(inArray(signalTargets.signalId, ids)).orderBy(asc(signalTargets.targetIndex))
    : [];
  const grouped = groupSignals(
    rows.map((r) => ({
      id: r.signal.id,
      sourceId: r.signal.sourceId,
      direction: r.signal.direction,
      entryMin: r.signal.entryMin,
      entryMax: r.signal.entryMax,
      stopLoss: r.signal.stopLoss,
      targets: targetRows.filter((t) => t.signalId === r.signal.id).map((t) => t.price).filter((n): n is number => n !== null),
      signalTime: r.signal.signalTime.getTime(),
      status: r.signal.status,
      qa: r.source.isQa,
    })),
    now,
  );
  await db.transaction(async (tx) => {
    await tx.delete(consolidatedIdeas);
    if (grouped.length === 0) return;
    await tx.insert(consolidatedIdeas).values(
      grouped.map((idea) => ({
        direction: idea.direction,
        entryMin: idea.entryMin,
        entryMax: idea.entryMax,
        stopLoss: idea.stopLoss,
        targets: idea.targets,
        exitSpreadStops: idea.exitSpreadStops,
        exitSpreadTargets: idea.exitSpreadTargets,
        sourceCount: idea.sourceCount,
        signalIds: idea.signalIds,
        newestSignalAt: new Date(idea.newestSignalAt),
        frozenAt: idea.frozenAt === null ? null : new Date(idea.frozenAt),
      })),
    );
  });
  return grouped.length;
}
