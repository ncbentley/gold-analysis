/**
 * Entitlement-aware projections. Every payload that leaves the server for members
 * is built here, so locked fields are never serialized (not just hidden in the UI).
 */
import type { AiAnalysis, Signal, SignalOutcome, SignalTarget, Source, Tier } from "@/server/db/schema";
import { gate, type Access, type Gated } from "@/server/entitlements/access";
import type { TierConfig } from "@/server/entitlements/config";
import type { SourceStatistics } from "@/server/statistics/compute";
import type { SimilarTradesResult } from "@/server/similar";

type Config = Record<Tier, TierConfig>;
const CLOSED = new Set(["WON", "LOST", "BREAKEVEN"]);
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export interface SignalBundle {
  signal: Signal;
  source: Pick<Source, "id" | "name" | "slug" | "showRawText" | "isQa">;
  targets: SignalTarget[];
  outcome: SignalOutcome | null;
}

export function presentSignalListItem({ signal, source, targets, outcome }: SignalBundle, access: Access, config: Config) {
  const isClosed = outcome ? CLOSED.has(outcome.classification) : false;
  return {
    id: signal.id,
    source: { id: source.id, name: source.name, slug: source.slug, isQa: source.isQa },
    instrument: signal.instrument,
    direction: signal.direction,
    entryType: signal.entryType,
    entryMin: signal.entryMin,
    entryMax: signal.entryMax,
    stopLoss: signal.stopLoss,
    targets: [...targets]
      .sort((a, b) => a.targetIndex - b.targetIndex)
      .map((t) => ({ index: t.targetIndex, price: t.price, status: t.status, hitAt: iso(t.hitAt) })),
    signalTime: signal.signalTime.toISOString(),
    closedAt: iso(signal.closedAt),
    status: signal.status,
    result: gate(access, "signals.basic_result", config, () =>
      isClosed && outcome
        ? { classification: outcome.classification, rResult: outcome.rResult, exitReason: outcome.exitReason }
        : null,
    ),
  };
}
export type SignalListItem = ReturnType<typeof presentSignalListItem>;

export interface SignalDetailInput extends SignalBundle {
  rawText: string | null;
  updates: { publishedAt: Date; eventType: string | null; rawText: string }[];
  sourceStats: SourceStatistics | null;
  similar: SimilarTradesResult | null;
  analysis: AiAnalysis | null;
}

export function presentSignalDetail(input: SignalDetailInput, access: Access, config: Config) {
  const base = presentSignalListItem(input, access, config);
  const { outcome, sourceStats: stats, similar, analysis } = input;
  const detail = (outcome?.detailJson ?? {}) as {
    timeline?: unknown[];
    targets?: { index: number; minutesFromEntry: number | null; ambiguous: boolean }[];
    notes?: string[];
    risk?: number | null;
  };
  const isClosed = outcome ? CLOSED.has(outcome.classification) : false;
  const ai = (analysis?.outputJson ?? null) as null | {
    setupClassification?: { label: string; confidence: number; rationale: string };
    summary?: string;
    patternTags?: string[];
    marketContextTags?: string[];
    similarPatternExplanation?: string;
    sourceStrengths?: string[];
    sourceWeaknesses?: string[];
    factsReferenced?: string[];
  };

  return {
    ...base,
    version: input.signal.version,
    parserConfidence: input.signal.parserConfidence,
    sourceConfidenceText: input.signal.sourceConfidenceText,
    rawText: gate(access, "signals.raw_text", config, () => (input.source.showRawText ? input.rawText : null)),
    updates: input.updates.map((u) => ({
      publishedAt: u.publishedAt.toISOString(),
      eventType: u.eventType,
      text: input.source.showRawText && access.features.has("signals.raw_text") ? u.rawText : null,
    })),
    outcome: {
      calcVersion: outcome?.calcVersion ?? null,
      kind: outcome?.kind ?? null,
      ambiguous: outcome?.ambiguous ?? false,
      entered: outcome?.entered ?? false,
      entryTime: iso(outcome?.entryTime),
      entryPrice: outcome?.entryPrice ?? null,
      basic: base.result,
      notes: detail.notes ?? [],
      excursionSummary: gate(access, "outcome.excursion_summary", config, () =>
        outcome?.entered ? { mfeR: outcome.mfeR, maeR: outcome.maeR } : null,
      ),
      excursionDetail: gate(access, "outcome.excursion_detail", config, () =>
        outcome?.entered
          ? {
              mfe: outcome.mfe,
              mae: outcome.mae,
              bestPrice: outcome.bestPrice,
              worstPrice: outcome.worstPrice,
              durationMinutes: outcome.durationMinutes,
              exitTime: iso(outcome.exitTime),
              risk: detail.risk ?? null,
              timeline: detail.timeline ?? [],
            }
          : null,
      ),
      timeToTarget: gate(access, "outcome.time_to_target", config, () =>
        (detail.targets ?? []).map((t) => ({ index: t.index, minutesFromEntry: t.minutesFromEntry, ambiguous: t.ambiguous })),
      ),
      isClosed,
    },
    sourceStats: stats ? presentSourceStats(stats, access, config) : null,
    similar: {
      summary: gate(access, "similar.summary", config, () =>
        similar
          ? {
              matched: similar.matched.length,
              dimensions: similar.dimensions,
              winRate: similar.summary.winRate,
              avgR: similar.summary.avgR,
              wins: similar.summary.wins,
              losses: similar.summary.losses,
            }
          : null,
      ),
      details: gate(access, "similar.details", config, () => similar?.matched.slice(0, 25) ?? []),
    },
    ai: {
      meta: analysis
        ? { model: analysis.model, promptVersion: analysis.promptVersion, createdAt: analysis.createdAt.toISOString() }
        : null,
      classification: gate(access, "ai.classification", config, () => ai?.setupClassification ?? null),
      summary: gate(access, "ai.summary", config, () =>
        ai ? { summary: ai.summary ?? null, marketContextTags: ai.marketContextTags ?? [], factsReferenced: ai.factsReferenced ?? [] } : null,
      ),
      patterns: gate(access, "ai.patterns", config, () =>
        ai
          ? {
              patternTags: ai.patternTags ?? [],
              similarPatternExplanation: ai.similarPatternExplanation ?? null,
              sourceStrengths: ai.sourceStrengths ?? [],
              sourceWeaknesses: ai.sourceWeaknesses ?? [],
            }
          : null,
      ),
    },
  };
}
export type SignalDetail = ReturnType<typeof presentSignalDetail>;

export function presentSourceStats(s: SourceStatistics, access: Access, config: Config) {
  return {
    calcVersion: s.calcVersion,
    totalSignals: s.totalSignals,
    closedTrades: s.closedTrades,
    summary: gate(access, "sources.stats.summary", config, () => ({
      enteredSignals: s.enteredSignals,
      wins: s.wins,
      losses: s.losses,
      breakevens: s.breakevens,
      ambiguous: s.ambiguous,
      cancelled: s.cancelled,
      expired: s.expired,
      openTrades: s.openTrades,
      winRate: s.winRate,
      avgR: s.avgR,
      avgWinR: s.avgWinR,
      avgLossR: s.avgLossR,
      expectancy: s.expectancy,
      ratedTrades: s.ratedTrades,
      avgDurationMinutes: s.avgDurationMinutes,
    })),
    recent: gate(access, "sources.stats.recent", config, () => ({ recent10: s.recent10, recent30: s.recent30 })),
    timeOfDay: gate(access, "sources.stats.time_of_day", config, () => s.byHour),
    direction: gate(access, "sources.stats.direction", config, () => s.byDirection),
    signalType: gate(access, "sources.stats.signal_type", config, () => s.bySignalType),
    excursion: gate(access, "outcome.excursion_summary", config, () => ({ avgMfeR: s.avgMfeR, avgMaeR: s.avgMaeR, n: s.closedTrades })),
    extended: gate(access, "sources.stats.extended", config, () => ({
      medianR: s.medianR,
      byDayOfWeek: s.byDayOfWeek,
      bySession: s.bySession,
      byEntryType: s.byEntryType,
      avgMfe: s.avgMfe,
      avgMae: s.avgMae,
      mfeRPercentiles: s.mfeRPercentiles,
      maeRPercentiles: s.maeRPercentiles,
    })),
    timeToTarget: gate(access, "outcome.time_to_target", config, () => s.timeToTarget),
  };
}
export type PresentedSourceStats = ReturnType<typeof presentSourceStats>;

export function presentSourceSummary(source: Source, stats: SourceStatistics | null, access: Access, config: Config) {
  return {
    id: source.id,
    name: source.name,
    slug: source.slug,
    description: source.description,
    sourceType: source.sourceType,
    telegramUsername: source.telegramUsername,
    isQa: source.isQa,
    active: source.active,
    stats: stats ? presentSourceStats(stats, access, config) : null,
  };
}

export type { Gated };
