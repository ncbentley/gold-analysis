import { createHash } from "node:crypto";
import { and, asc, eq, gte, inArray, isNotNull, isNull, notInArray } from "drizzle-orm";
import { getDb } from "@/server/db";
import { consolidatedIdeas, signalTargets, signals, sources } from "@/server/db/schema";
import { groupSignals, type GroupedIdea } from "./group";

const WINDOW_MS = 48 * 60 * 60 * 1000;

function stableIdeaId(signalIds: string[]) {
  return createHash("sha256").update([...signalIds].sort().join(",")).digest("hex");
}

function toRow(idea: GroupedIdea) {
  return {
    id: stableIdeaId(idea.signalIds),
    direction: idea.direction,
    entryMin: idea.entryMin,
    entryMax: idea.entryMax,
    stopLoss: idea.stopLoss,
    targets: idea.targets,
    exitSpreadStops: idea.exitSpreadStops,
    exitSpreadTargets: idea.exitSpreadTargets,
    sourceCount: idea.sourceCount,
    signalIds: idea.signalIds,
    replacedSignalIds: idea.replacedSignalIds,
    newestSignalAt: new Date(idea.newestSignalAt),
    frozenAt: idea.frozenAt === null ? null : new Date(idea.frozenAt),
  };
}

export async function replaceConsolidatedIdeas(now = Date.now()) {
  const db = await getDb();
  const since = new Date(now - WINDOW_MS);
  const frozen = await db
    .select({ signalIds: consolidatedIdeas.signalIds, replacedSignalIds: consolidatedIdeas.replacedSignalIds })
    .from(consolidatedIdeas)
    .where(isNotNull(consolidatedIdeas.frozenAt));
  const frozenSignalIds = new Set(frozen.flatMap((row) => [...row.signalIds, ...row.replacedSignalIds]));
  const rows = await db
    .select({ signal: signals, source: sources })
    .from(signals)
    .innerJoin(sources, eq(sources.id, signals.sourceId))
    .where(and(gte(signals.signalTime, since), isNull(sources.removedAt)));
  const openRows = rows.filter((row) => !frozenSignalIds.has(row.signal.id));
  const ids = openRows.map((row) => row.signal.id);
  const targetRows = ids.length
    ? await db.select().from(signalTargets).where(inArray(signalTargets.signalId, ids)).orderBy(asc(signalTargets.targetIndex))
    : [];
  const grouped = groupSignals(
    openRows.map((row) => ({
      id: row.signal.id,
      sourceId: row.signal.sourceId,
      direction: row.signal.direction,
      entryMin: row.signal.entryMin,
      entryMax: row.signal.entryMax,
      stopLoss: row.signal.stopLoss,
      targets: targetRows.filter((target) => target.signalId === row.signal.id).map((target) => target.price).filter((price): price is number => price !== null),
      signalTime: row.signal.signalTime.getTime(),
      status: row.signal.status,
      qa: row.source.isQa,
    })),
    now,
  );
  const values = grouped.map(toRow);
  await db.transaction(async (tx) => {
    for (const row of values) {
      const { id, ...fields } = row;
      await tx
        .insert(consolidatedIdeas)
        .values({ id, ...fields })
        .onConflictDoUpdate({
          target: consolidatedIdeas.id,
          set: fields,
          setWhere: isNull(consolidatedIdeas.frozenAt),
        });
    }
    const keepIds = values.map((row) => row.id);
    await tx.delete(consolidatedIdeas).where(
      keepIds.length ? and(isNull(consolidatedIdeas.frozenAt), notInArray(consolidatedIdeas.id, keepIds)) : isNull(consolidatedIdeas.frozenAt),
    );
  });
  return grouped.length;
}
