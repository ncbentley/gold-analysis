import { and, eq } from "drizzle-orm";
import { getDb } from "@/server/db";
import { aiAnalyses, signalOutcomes, signals } from "@/server/db/schema";
import { findSimilarTrades, type SimilarCandidate } from "./index";

async function candidatesForSource(sourceId: string): Promise<SimilarCandidate[]> {
  const db = await getDb();
  const rows = await db
    .select({ signal: signals, outcome: signalOutcomes, ai: aiAnalyses.outputJson })
    .from(signals)
    .leftJoin(signalOutcomes, and(eq(signalOutcomes.signalId, signals.id), eq(signalOutcomes.isCurrent, true)))
    .leftJoin(
      aiAnalyses,
      and(eq(aiAnalyses.signalId, signals.id), eq(aiAnalyses.isCurrent, true), eq(aiAnalyses.analysisType, "signal_setup")),
    )
    .where(eq(signals.sourceId, sourceId));
  return rows.map(({ signal, outcome, ai }) => ({
    signalId: signal.id,
    sourceId: signal.sourceId,
    direction: signal.direction,
    entryType: signal.entryType,
    signalType: signal.signalType,
    signalTime: signal.signalTime,
    closedAt: signal.closedAt,
    classification: outcome?.classification ?? "PENDING",
    rResult: outcome?.rResult ?? null,
    mfeR: outcome?.mfeR ?? null,
    maeR: outcome?.maeR ?? null,
    durationMinutes: outcome?.durationMinutes ?? null,
    tags: ((ai as { patternTags?: string[] } | null)?.patternTags ?? []).filter((t) => !t.endsWith("-session")),
  }));
}

export async function getSimilarTradesForSignal(signalId: string) {
  const db = await getDb();
  const [signal] = await db.select().from(signals).where(eq(signals.id, signalId));
  if (!signal) return null;
  const candidates = await candidatesForSource(signal.sourceId);
  const target = candidates.find((c) => c.signalId === signalId);
  if (!target) return null;
  return findSimilarTrades(target, candidates);
}
