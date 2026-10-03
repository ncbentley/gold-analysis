import { createHash } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, notInArray } from "drizzle-orm";
import { getDb } from "@/server/db";
import { consolidatedIdeas, signalTargets, signals, sources } from "@/server/db/schema";
import { historyCutoff, tierForSignalTime } from "@/server/entitlements/access";
import type { Viewer } from "@/server/entitlements/service";
import { getEngineBars } from "@/server/market-data";
import { listSignalListItemsByIds } from "@/server/signals/queries";
import type { EngineOutcome } from "@/server/outcomes/engine";
import { groupSignals, type GroupedIdea } from "./group";
import type { IdeaPhase } from "./phase";
import { replayIdea } from "./replay";

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

async function groupStoredSignals(now: number, since: Date | null, excludeFrozen: boolean) {
  const db = await getDb();
  const frozenSignalIds = new Set<string>();
  if (excludeFrozen) {
    const frozen = await db
      .select({ signalIds: consolidatedIdeas.signalIds, replacedSignalIds: consolidatedIdeas.replacedSignalIds })
      .from(consolidatedIdeas)
      .where(isNotNull(consolidatedIdeas.frozenAt));
    for (const row of frozen) {
      for (const id of row.signalIds) frozenSignalIds.add(id);
      for (const id of row.replacedSignalIds) frozenSignalIds.add(id);
    }
  }
  const rows = await db
    .select({ signal: signals, source: sources })
    .from(signals)
    .innerJoin(sources, eq(sources.id, signals.sourceId))
    .where(since ? and(gte(signals.signalTime, since), isNull(sources.removedAt)) : isNull(sources.removedAt));
  const openRows = rows.filter((row) => !frozenSignalIds.has(row.signal.id));
  const ids = openRows.map((row) => row.signal.id);
  const targetRows = ids.length
    ? await db.select().from(signalTargets).where(inArray(signalTargets.signalId, ids)).orderBy(asc(signalTargets.targetIndex))
    : [];
  return groupSignals(
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
}

async function persistIdeas(grouped: GroupedIdea[], replaceFrozen: boolean) {
  const db = await getDb();
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
          ...(replaceFrozen ? {} : { setWhere: isNull(consolidatedIdeas.frozenAt) }),
        });
    }
    const keepIds = values.map((row) => row.id);
    if (!keepIds.length) {
      await tx.delete(consolidatedIdeas).where(replaceFrozen ? undefined : isNull(consolidatedIdeas.frozenAt));
      return;
    }
    await tx.delete(consolidatedIdeas).where(
      replaceFrozen ? notInArray(consolidatedIdeas.id, keepIds) : and(isNull(consolidatedIdeas.frozenAt), notInArray(consolidatedIdeas.id, keepIds)),
    );
  });
  return grouped.length;
}

/** Regroups the last 48 hours. Frozen ideas, including the historical replay, stay put. */
export async function replaceConsolidatedIdeas(now = Date.now()) {
  return persistIdeas(await groupStoredSignals(now, new Date(now - WINDOW_MS), true), false);
}

/**
 * One pass over every stored signal, in publish order, with the same 30-minute
 * and $2 rules the live job uses. Clusters that have been quiet for 30 minutes
 * are frozen. The next live run leaves those rows alone.
 */
export async function rebuildConsolidatedIdeas(now = Date.now()) {
  return persistIdeas(await groupStoredSignals(now, null, false), true);
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

async function startTimes(ids: string[]) {
  const unique = [...new Set(ids)];
  const map = new Map<string, number>();
  if (!unique.length) return map;
  const db = await getDb();
  const rows = await db.select({ id: signals.id, signalTime: signals.signalTime }).from(signals).where(inArray(signals.id, unique));
  for (const row of rows) map.set(row.id, row.signalTime.getTime());
  return map;
}

function ideaStart(signalIds: string[], times: Map<string, number>, newest: Date) {
  let start = newest.getTime();
  for (const id of signalIds) {
    const time = times.get(id);
    if (time != null && time < start) start = time;
  }
  return start;
}

function listedIdea(row: typeof consolidatedIdeas.$inferSelect, phase: IdeaPhase): ListedIdea {
  return {
    id: row.id,
    direction: row.direction,
    entryMin: row.entryMin,
    entryMax: row.entryMax,
    stopLoss: row.stopLoss,
    targets: row.targets,
    sourceCount: row.sourceCount,
    newestSignalAt: row.newestSignalAt.toISOString(),
    phase,
  };
}

async function replayRows(rows: (typeof consolidatedIdeas.$inferSelect)[], spot: number | null) {
  const times = await startTimes(rows.flatMap((row) => row.signalIds));
  const started = new Map(rows.map((row) => [row.id, ideaStart(row.signalIds, times, row.newestSignalAt)]));
  const from = started.size ? Math.min(...started.values()) : Date.now();
  const bars = rows.length ? await getEngineBars(new Date(from), new Date(Date.now() + 60_000)) : [];
  const played = new Map<string, ReturnType<typeof replayIdea> & { startedAt: number }>();
  for (const row of rows) {
    const startedAt = started.get(row.id) ?? row.newestSignalAt.getTime();
    played.set(row.id, { ...replayIdea({ ...row, startedAt }, bars, spot), startedAt });
  }
  return played;
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
  const played = await replayRows(rows, spot);
  return rows
    .map((row) => listedIdea(row, played.get(row.id)?.phase ?? "available"))
    .sort((a, b) => PHASE_RANK[a.phase] - PHASE_RANK[b.phase] || Date.parse(b.newestSignalAt) - Date.parse(a.newestSignalAt));
}

export type IdeaForViewer =
  | { kind: "not_found" }
  | { kind: "history_locked"; requiredTier: string | null }
  | {
      kind: "ok";
      idea: ListedIdea;
      items: Awaited<ReturnType<typeof listSignalListItemsByIds>>;
      startedAt: string;
      outcome: EngineOutcome;
    };

export async function getIdeaForViewer(id: string, viewer: Viewer, spot: number | null): Promise<IdeaForViewer> {
  const db = await getDb();
  const [row] = await db.select().from(consolidatedIdeas).where(eq(consolidatedIdeas.id, id));
  if (!row) return { kind: "not_found" };
  const now = new Date();
  const cutoff = historyCutoff(viewer.access, now);
  if (cutoff && row.newestSignalAt < cutoff) {
    return { kind: "history_locked", requiredTier: tierForSignalTime(row.newestSignalAt, viewer.config, now) };
  }
  const played = await replayRows([row], spot);
  const replay = played.get(row.id)!;
  return {
    kind: "ok",
    idea: listedIdea(row, replay.phase),
    startedAt: new Date(replay.startedAt).toISOString(),
    outcome: replay.outcome,
    items: await listSignalListItemsByIds(row.signalIds, viewer),
  };
}
