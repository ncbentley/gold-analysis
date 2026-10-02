import { createHash } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, notInArray } from "drizzle-orm";
import { getDb } from "@/server/db";
import { consolidatedIdeas, signalOutcomes, signalTargets, signals, sources } from "@/server/db/schema";
import { historyCutoff, tierForSignalTime } from "@/server/entitlements/access";
import type { Viewer } from "@/server/entitlements/service";
import { listSignalListItemsByIds } from "@/server/signals/queries";
import { groupSignals, type GroupedIdea } from "./group";
import { ideaPhase, phaseFromMembers, type IdeaPhase, type PhaseMember } from "./phase";

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

export interface ListedIdea {
  id: string;
  direction: "LONG" | "SHORT";
  entryMin: number;
  entryMax: number;
  stopLoss: number | null;
  targets: number[];
  sourceCount: number;
  newestSignalAt: string;
  phase: IdeaPhase;
}

const PHASE_RANK: Record<IdeaPhase, number> = { available: 0, "playing-out": 1, history: 2 };

async function membersById(ids: string[]) {
  const unique = [...new Set(ids)];
  const map = new Map<string, PhaseMember>();
  if (!unique.length) return map;
  const db = await getDb();
  const rows = await db
    .select({
      id: signals.id,
      status: signals.status,
      outcomeId: signalOutcomes.id,
      entered: signalOutcomes.entered,
      exitTime: signalOutcomes.exitTime,
      classification: signalOutcomes.classification,
    })
    .from(signals)
    .leftJoin(signalOutcomes, and(eq(signalOutcomes.signalId, signals.id), eq(signalOutcomes.isCurrent, true)))
    .where(inArray(signals.id, unique));
  for (const row of rows) {
    map.set(row.id, {
      status: row.status,
      outcome: row.outcomeId
        ? { entered: row.entered ?? false, exitTime: row.exitTime, classification: row.classification ?? "" }
        : null,
    });
  }
  return map;
}

function listedIdea(row: typeof consolidatedIdeas.$inferSelect, members: Map<string, PhaseMember>, spot: number | null): ListedIdea {
  const flags = phaseFromMembers(row.signalIds.map((id) => members.get(id) ?? null));
  return {
    id: row.id,
    direction: row.direction,
    entryMin: row.entryMin,
    entryMax: row.entryMax,
    stopLoss: row.stopLoss,
    targets: row.targets,
    sourceCount: row.sourceCount,
    newestSignalAt: row.newestSignalAt.toISOString(),
    phase: ideaPhase({
      direction: row.direction,
      entryMin: row.entryMin,
      entryMax: row.entryMax,
      stopLoss: row.stopLoss,
      spot,
      ...flags,
    }),
  };
}

/** Ideas inside the viewer's history window. Counting `signalIds` only. */
export async function listIdeasForViewer(viewer: Viewer, spot: number | null): Promise<ListedIdea[]> {
  const db = await getDb();
  const cutoff = historyCutoff(viewer.access);
  const rows = await db
    .select()
    .from(consolidatedIdeas)
    .where(cutoff ? gte(consolidatedIdeas.newestSignalAt, cutoff) : undefined)
    .orderBy(desc(consolidatedIdeas.newestSignalAt));
  const members = await membersById(rows.flatMap((row) => row.signalIds));
  return rows
    .map((row) => listedIdea(row, members, spot))
    .sort((a, b) => PHASE_RANK[a.phase] - PHASE_RANK[b.phase] || Date.parse(b.newestSignalAt) - Date.parse(a.newestSignalAt));
}

export type IdeaForViewer =
  | { kind: "not_found" }
  | { kind: "history_locked"; requiredTier: string | null }
  | { kind: "ok"; idea: ListedIdea; items: Awaited<ReturnType<typeof listSignalListItemsByIds>> };

export async function getIdeaForViewer(id: string, viewer: Viewer, spot: number | null): Promise<IdeaForViewer> {
  const db = await getDb();
  const [row] = await db.select().from(consolidatedIdeas).where(eq(consolidatedIdeas.id, id));
  if (!row) return { kind: "not_found" };
  const now = new Date();
  const cutoff = historyCutoff(viewer.access, now);
  if (cutoff && row.newestSignalAt < cutoff) {
    return { kind: "history_locked", requiredTier: tierForSignalTime(row.newestSignalAt, viewer.config, now) };
  }
  const members = await membersById(row.signalIds);
  return {
    kind: "ok",
    idea: listedIdea(row, members, spot),
    items: await listSignalListItemsByIds(row.signalIds, viewer),
  };
}
