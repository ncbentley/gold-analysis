/**
 * Builds the structured fact sets supplied to the AI layer. Every number here is computed
 * deterministically in code; the model only describes them.
 */
import { and, asc, eq, gte, lt } from "drizzle-orm";
import { getDb } from "@/server/db";
import { marketBars, signals, signalTargets, sources } from "@/server/db/schema";
import { getCurrentOutcome } from "@/server/outcomes/service";
import { getSimilarTradesForSignal } from "@/server/similar/service";
import { sessionFor, type Bucket, type SourceStatistics } from "@/server/statistics/compute";
import { getSourceStats } from "@/server/statistics/service";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const r2 = (n: number) => Math.round(n * 100) / 100;

export interface SignalFacts {
  signal: {
    sourceName: string;
    direction: "LONG" | "SHORT";
    entryType: string;
    entryMin: number;
    entryMax: number;
    stopLoss: number | null;
    targets: number[];
    signalType: string | null;
    signalTimeUtc: string;
    session: string;
    dayOfWeek: string;
  };
  geometry: { riskUsd: number | null; rewardRiskTp1: number | null; rewardRiskLast: number | null; zoneWidth: number };
  marketContext: {
    priceAtSignal: number | null;
    change60m: number | null;
    change240m: number | null;
    range240m: number | null;
    avgBarRange60m: number | null;
    volatilityRatio: number | null;
  };
  sourceHistory: {
    closedTrades: number;
    winRate: number | null;
    avgR: number | null;
    sameSession: Bucket | null;
    sameDirection: Bucket | null;
  };
  similar: { n: number; winRate: number | null; avgR: number | null; dimensions: string[] };
  outcome: null | {
    classification: string;
    rResult: number | null;
    mfeR: number | null;
    maeR: number | null;
    durationMinutes: number | null;
    exitReason: string | null;
  };
}

export async function buildSignalFacts(signalId: string): Promise<SignalFacts> {
  const db = await getDb();
  const [signal] = await db.select().from(signals).where(eq(signals.id, signalId));
  if (!signal) throw new Error("Signal not found");
  const [source] = await db.select().from(sources).where(eq(sources.id, signal.sourceId));
  const targets = (await db.select().from(signalTargets).where(eq(signalTargets.signalId, signalId)).orderBy(asc(signalTargets.targetIndex))).map(
    (t) => t.price,
  );

  const t = signal.signalTime.getTime();
  const context = await db
    .select()
    .from(marketBars)
    .where(and(eq(marketBars.instrument, signal.instrument), gte(marketBars.timestamp, new Date(t - 86_400_000)), lt(marketBars.timestamp, signal.signalTime)))
    .orderBy(asc(marketBars.timestamp));
  const last = context.at(-1) ?? null;
  const since = (mins: number) => context.filter((b) => b.timestamp.getTime() >= t - mins * 60_000);
  const w60 = since(60);
  const w240 = since(240);
  const avgRange = (bars: typeof context) => (bars.length ? bars.reduce((s, b) => s + (b.high - b.low), 0) / bars.length : null);
  const ar60 = avgRange(w60);
  const ar5d = avgRange(context);

  const refEntry = signal.direction === "LONG" ? signal.entryMax : signal.entryMin;
  const risk = signal.stopLoss !== null ? Math.abs(refEntry - signal.stopLoss) : null;
  const rr = (p: number | undefined) => (risk && p !== undefined ? r2(Math.abs(p - refEntry) / risk) : null);

  const stats: SourceStatistics = await getSourceStats(signal.sourceId);
  const similar = await getSimilarTradesForSignal(signalId);
  const outcome = await getCurrentOutcome(signalId);
  const closed = outcome && ["WON", "LOST", "BREAKEVEN"].includes(outcome.classification);
  const session = sessionFor(signal.signalTime);

  return {
    signal: {
      sourceName: source.name,
      direction: signal.direction,
      entryType: signal.entryType,
      entryMin: signal.entryMin,
      entryMax: signal.entryMax,
      stopLoss: signal.stopLoss,
      targets,
      signalType: signal.signalType,
      signalTimeUtc: signal.signalTime.toISOString(),
      session,
      dayOfWeek: DAYS[signal.signalTime.getUTCDay()],
    },
    geometry: { riskUsd: risk === null ? null : r2(risk), rewardRiskTp1: rr(targets[0]), rewardRiskLast: rr(targets.at(-1)), zoneWidth: r2(signal.entryMax - signal.entryMin) },
    marketContext: {
      priceAtSignal: last ? last.close : null,
      change60m: last && w60.length ? r2(last.close - w60[0].open) : null,
      change240m: last && w240.length ? r2(last.close - w240[0].open) : null,
      range240m: w240.length ? r2(Math.max(...w240.map((b) => b.high)) - Math.min(...w240.map((b) => b.low))) : null,
      avgBarRange60m: ar60 === null ? null : r2(ar60),
      volatilityRatio: ar60 !== null && ar5d ? r2(ar60 / ar5d) : null,
    },
    sourceHistory: {
      closedTrades: stats.closedTrades,
      winRate: stats.winRate,
      avgR: stats.avgR,
      sameSession: stats.bySession[session] ?? null,
      sameDirection: stats.byDirection[signal.direction] ?? null,
    },
    similar: {
      n: similar?.summary.n ?? 0,
      winRate: similar?.summary.winRate ?? null,
      avgR: similar?.summary.avgR ?? null,
      dimensions: similar?.dimensions ?? [],
    },
    outcome: closed
      ? {
          classification: outcome.classification,
          rResult: outcome.rResult,
          mfeR: outcome.mfeR,
          maeR: outcome.maeR,
          durationMinutes: outcome.durationMinutes,
          exitReason: outcome.exitReason,
        }
      : null,
  };
}

export interface SourcePatternFacts {
  sourceName: string;
  closedTrades: number;
  winRate: number | null;
  avgR: number | null;
  expectancy: number | null;
  avgMfeR: number | null;
  avgMaeR: number | null;
  recent30: Bucket;
  bySession: Record<string, Bucket>;
  byDirection: Record<string, Bucket>;
}

export async function buildSourcePatternFacts(sourceId: string): Promise<SourcePatternFacts> {
  const db = await getDb();
  const [source] = await db.select().from(sources).where(eq(sources.id, sourceId));
  const s = await getSourceStats(sourceId);
  return {
    sourceName: source.name,
    closedTrades: s.closedTrades,
    winRate: s.winRate,
    avgR: s.avgR,
    expectancy: s.expectancy,
    avgMfeR: s.avgMfeR,
    avgMaeR: s.avgMaeR,
    recent30: s.recent30,
    bySession: s.bySession,
    byDirection: s.byDirection,
  };
}
