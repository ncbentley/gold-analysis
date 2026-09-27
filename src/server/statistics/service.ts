import { and, eq } from "drizzle-orm";
import { getDb } from "@/server/db";
import { signalOutcomes, signals, signalTargets, sourceStats } from "@/server/db/schema";
import { computeSourceStatistics, STATS_VERSION, type SourceStatistics, type StatsInputRow } from "./compute";

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

export async function getSourceStatsMeta(sourceId: string) {
  const db = await getDb();
  const [row] = await db.select({ computedAt: sourceStats.computedAt, calcVersion: sourceStats.calcVersion }).from(sourceStats).where(eq(sourceStats.sourceId, sourceId));
  return row ?? null;
}
