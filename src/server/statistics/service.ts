import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/server/db";
import { signalOutcomes, signals, signalTargets, sourceStats } from "@/server/db/schema";
import { computeSourceStatistics, STATS_VERSION, TOP_SOURCES_MIN_TRADES, type SourceStatistics, type StatsInputRow } from "./compute";

export async function loadStatsRows(sourceId: string): Promise<StatsInputRow[]> {
  const db = await getDb();
  const rows = await db
    .select({ signal: signals, outcome: signalOutcomes })
    .from(signals)
    .leftJoin(signalOutcomes, and(eq(signalOutcomes.signalId, signals.id), eq(signalOutcomes.isCurrent, true)))
    .where(eq(signals.sourceId, sourceId));
  const targets = await db
    .select({ signalId: signalTargets.signalId, targetIndex: signalTargets.targetIndex })
    .from(signalTargets)
    .innerJoin(signals, eq(signals.id, signalTargets.signalId))
    .where(eq(signals.sourceId, sourceId));
  const targetCount = new Map<string, number>();
  for (const t of targets) targetCount.set(t.signalId, Math.max(targetCount.get(t.signalId) ?? 0, t.targetIndex));

  return rows
    .filter((r) => r.signal.status !== "INVALID")
    .map(({ signal, outcome }) => {
      const detailTargets = ((outcome?.detailJson as { targets?: { minutesFromEntry: number | null }[] })?.targets ?? []).map(
        (t) => t.minutesFromEntry,
      );
      return {
        signalId: signal.id,
        direction: signal.direction,
        entryType: signal.entryType,
        signalType: signal.signalType,
        signalTime: signal.signalTime,
        classification: outcome?.classification ?? "PENDING",
        entered: outcome?.entered ?? false,
        rResult: outcome?.rResult ?? null,
        mfe: outcome?.mfe ?? null,
        mae: outcome?.mae ?? null,
        mfeR: outcome?.mfeR ?? null,
        maeR: outcome?.maeR ?? null,
        durationMinutes: outcome?.durationMinutes ?? null,
        targetMinutes: detailTargets.length ? detailTargets : Array(targetCount.get(signal.id) ?? 0).fill(null),
      };
    });
}

export async function refreshSourceStats(sourceId: string): Promise<SourceStatistics> {
  const db = await getDb();
  const stats = computeSourceStatistics(await loadStatsRows(sourceId));
  const statsJson = JSON.parse(JSON.stringify(stats));
  await db
    .insert(sourceStats)
    .values({ sourceId, calcVersion: STATS_VERSION, statsJson, computedAt: new Date() })
    .onConflictDoUpdate({ target: sourceStats.sourceId, set: { calcVersion: STATS_VERSION, statsJson, computedAt: new Date() } });
  return stats;
}

export async function getSourceStats(sourceId: string): Promise<SourceStatistics> {
  const db = await getDb();
  const [row] = await db.select().from(sourceStats).where(eq(sourceStats.sourceId, sourceId));
  if (row && row.calcVersion === STATS_VERSION) return row.statsJson as unknown as SourceStatistics;
  return refreshSourceStats(sourceId);
}

export async function getSourceStatsMany(sourceIds: string[]): Promise<Map<string, SourceStatistics>> {
  if (!sourceIds.length) return new Map();
  const db = await getDb();
  const rows = await db.select().from(sourceStats).where(inArray(sourceStats.sourceId, sourceIds));
  const cached = new Map(rows.filter((r) => r.calcVersion === STATS_VERSION).map((r) => [r.sourceId, r.statsJson as unknown as SourceStatistics]));
  const out = new Map<string, SourceStatistics>();
  for (const id of sourceIds) out.set(id, cached.get(id) ?? (await refreshSourceStats(id)));
  return out;
}

/** Ranks by expectancy; sources below the closed-trade minimum are left out so small samples can't top the list. */
export async function getTopSources(sourceIds: string[], limit = 5) {
  const all = await getSourceStatsMany(sourceIds);
  const stats = [...all].map(([sourceId, s]) => ({ sourceId, stats: s }));
  const eligible = stats.filter((s) => s.stats.closedTrades >= TOP_SOURCES_MIN_TRADES && s.stats.expectancy !== null);
  eligible.sort((a, b) => b.stats.expectancy! - a.stats.expectancy! || b.stats.closedTrades - a.stats.closedTrades);
  return {
    top: eligible.slice(0, limit),
    eligibleCount: eligible.length,
    sourceCount: stats.length,
    totalClosed: stats.reduce((n, s) => n + s.stats.closedTrades, 0),
  };
}

export async function getSourceStatsMeta(sourceId: string) {
  const db = await getDb();
  const [row] = await db.select({ computedAt: sourceStats.computedAt, calcVersion: sourceStats.calcVersion }).from(sourceStats).where(eq(sourceStats.sourceId, sourceId));
  return row ?? null;
}
