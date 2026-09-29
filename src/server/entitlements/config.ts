import type { Tier } from "@/server/db/schema";

export const FEATURE_CATALOG = {
  "signals.core": "Signal source, instrument, direction, entry, stop, targets, time and status",
  "signals.raw_text": "Original source text (where the source permits)",
  "signals.basic_result": "Final result after the trade closes",
  "sources.stats.summary": "Source lifetime count, win rate, average R and expectancy",
  "sources.stats.recent": "Recent 10 / 30 trade performance",
  "sources.stats.time_of_day": "Performance by hour of day",
  "sources.stats.direction": "Performance by direction",
  "sources.stats.signal_type": "Performance by signal type",
  "similar.summary": "Similar historical trade summary",
  "outcome.excursion_summary": "MFE / MAE summary",
  "sources.history.full": "Full historical dataset",
  "sources.stats.extended": "Day-of-week, session, entry-type, median and percentile statistics",
  "filters.advanced": "Advanced filters (date range, entry type, signal type, outcome)",
  "search.history": "Historical signal search",
  "ai.classification": "AI setup classification",
  "ai.summary": "AI context summary",
  "ai.patterns": "AI pattern analysis",
  "similar.details": "Similar-trade details",
  "outcome.excursion_detail": "Detailed MFE / MAE data and trade timeline",
  "outcome.time_to_target": "Time-to-target statistics",
  "consensus.grade": "Consensus score and grade when sources cluster on the same entry zone",
  "consensus.timing": "How that cluster lines up in time, without source names",
  "consensus.mapping": "How many top historical performers are aligned on the zone, without source names",
  "export.csv": "CSV export (disabled by default)",
} as const;

export type Feature = keyof typeof FEATURE_CATALOG;
export const ALL_FEATURES = Object.keys(FEATURE_CATALOG) as Feature[];

const SILVER: Feature[] = ["signals.core", "signals.raw_text", "signals.basic_result"];
const GOLD: Feature[] = [
  ...SILVER,
  "sources.stats.summary",
  "sources.stats.recent",
  "sources.stats.time_of_day",
  "sources.stats.direction",
  "sources.stats.signal_type",
  "similar.summary",
  "outcome.excursion_summary",
  "consensus.grade",
  "consensus.timing",
];
const PLATINUM: Feature[] = [
  ...GOLD,
  "consensus.mapping",
  "sources.history.full",
  "sources.stats.extended",
  "filters.advanced",
  "search.history",
  "ai.classification",
  "ai.summary",
  "ai.patterns",
  "similar.details",
  "outcome.excursion_detail",
  "outcome.time_to_target",
];

export interface TierConfig {
  features: Feature[];
  historyDays: number | null;
}

/** Seed defaults. The live configuration is stored in the tier_entitlements table. */
export const DEFAULT_TIER_CONFIG: Record<Tier, TierConfig> = {
  silver: { features: SILVER, historyDays: 30 },
  gold: { features: GOLD, historyDays: 180 },
  platinum: { features: PLATINUM, historyDays: null },
};

export const TIER_ORDER: Tier[] = ["silver", "gold", "platinum"];
export const TIER_LABEL: Record<Tier, string> = { silver: "Silver", gold: "Gold", platinum: "Platinum" };
