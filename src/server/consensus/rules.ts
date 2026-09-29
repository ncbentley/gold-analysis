/**
 * Cross-trader consensus (`consensus-v1`).
 *
 * Pure scoring. Callers pass signals and the source statistics the app already
 * stores. Nothing here picks a channel by name.
 *
 * Same zone: each signal stores an inclusive entry interval [entryMin, entryMax]
 * (a market or limit price is a zero-width interval). Two signals share a zone
 * when those intervals overlap, or when the gap between them is at most
 * ZONE_BAND_USD ($2). Overlap is the primary rule, so a published zone matches
 * any entry inside it. The $2 band only joins ranges that do not quite touch,
 * which is how "near the same price" is applied to point entries. $2 is tighter
 * than the zones the parser records (typically a few dollars) and far tighter
 * than the $80 quote-sanity gate.
 *
 * Window: signal times within 30 minutes of the signal being scored, inclusive.
 * One source casts one vote: the signal closest in time to the focal signal.
 * The focal source always votes with the focal signal.
 *
 * Historically accurate (top-tier) is measured, not listed: at least
 * MIN_RATED_TRADES closed trades with an R result, win rate at least 55%, and
 * expectancy above 0. The top historical performers are the sources with a
 * large enough rated sample, ordered by expectancy, then win rate, then sample
 * size. The platinum line uses at most the first 10.
 */

export const CONSENSUS_VERSION = "consensus-v1";
export const CONSENSUS_WINDOW_MS = 30 * 60 * 1000;
export const CONSENSUS_WINDOW_MINUTES = 30;
export const ZONE_BAND_USD = 2;
export const MIN_RATED_TRADES = 8;
export const TOP_TIER_WIN_RATE = 0.55;
export const TOP_PERFORMER_COUNT = 10;

const BASE_SCORE = 50;
/** Another source in agreement, without a proven record. */
const ALIGNED_REGULAR_POINTS = 2;
/** Another historically accurate source in agreement. Seven of these reach Grade A (85). */
const ALIGNED_ACCURATE_POINTS = 5;
const OPPOSED_REGULAR_POINTS = 4;
/** An accurate source on the other side. Several of these collapse the score. */
const OPPOSED_ACCURATE_POINTS = 12;

const EXCLUDED_STATUSES = new Set(["INVALID", "MANUAL_REVIEW", "CANCELLED"]);

export type ConsensusGradeLetter = "A" | "B" | "C" | "D" | "F";
export type ConsensusRisk = "low" | "elevated" | "high";

export interface ConsensusSignal {
  id: string;
  sourceId: string;
  instrument: string;
  direction: "LONG" | "SHORT";
  entryMin: number;
  entryMax: number;
  signalTime: Date;
  status: string;
}

export interface SourcePerformance {
  sourceId: string;
  ratedTrades: number;
  winRate: number | null;
  expectancy: number | null;
}

export interface ConsensusGrade {
  version: string;
  score: number;
  grade: ConsensusGradeLetter;
  label: string;
  risk: ConsensusRisk;
  riskNote: string | null;
}

export interface ConsensusTiming {
  windowMinutes: number;
  alignedSources: number;
  opposedSources: number;
  clusterSpanMinutes: number;
  offsetsMinutes: number[];
}

export interface ConsensusMapping {
  poolSize: number;
  aligned: number;
  opposed: number;
  sentence: string;
  oppositionSentence: string | null;
}

export interface ConsensusParticipant {
  signalId: string;
  sourceId: string;
  direction: "LONG" | "SHORT";
  entryMin: number;
  entryMax: number;
  signalTime: Date;
  offsetMinutes: number;
  role: "focal" | "aligned" | "opposed";
  historicallyAccurate: boolean;
  topPerformerRank: number | null;
}

export interface ConsensusComputation {
  grade: ConsensusGrade;
  timing: ConsensusTiming;
  mapping: ConsensusMapping;
  participants: ConsensusParticipant[];
}

export interface MemberConsensus {
  grade: ConsensusGrade;
  timing: ConsensusTiming;
  mapping: ConsensusMapping;
}

export function memberConsensus(result: ConsensusComputation): MemberConsensus {
  return { grade: result.grade, timing: result.timing, mapping: result.mapping };
}

export function normalizeInstrument(instrument: string) {
  return instrument.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function entryInterval(signal: { entryMin: number; entryMax: number }) {
  const lo = Math.min(signal.entryMin, signal.entryMax);
  const hi = Math.max(signal.entryMin, signal.entryMax);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
  return { lo, hi };
}

/** True when stored entry intervals overlap or sit within ZONE_BAND_USD of each other. */
export function sameZone(
  a: { entryMin: number; entryMax: number },
  b: { entryMin: number; entryMax: number },
  band = ZONE_BAND_USD,
) {
  const left = entryInterval(a);
  const right = entryInterval(b);
  if (!left || !right) return false;
  const gap = left.lo > right.hi ? left.lo - right.hi : right.lo > left.hi ? right.lo - left.hi : 0;
  return gap <= band;
}

export function isHistoricallyAccurate(perf: SourcePerformance) {
  return (
    perf.ratedTrades >= MIN_RATED_TRADES &&
    perf.winRate !== null &&
    perf.winRate >= TOP_TIER_WIN_RATE &&
    perf.expectancy !== null &&
    perf.expectancy > 0
  );
}

export function rankHistoricalPerformers(perfs: SourcePerformance[], limit = TOP_PERFORMER_COUNT) {
  return perfs
    .filter((p) => p.ratedTrades >= MIN_RATED_TRADES && p.expectancy !== null && p.winRate !== null)
    .sort((a, b) => {
      if (a.expectancy !== b.expectancy) return (b.expectancy ?? 0) - (a.expectancy ?? 0);
      if (a.winRate !== b.winRate) return (b.winRate ?? 0) - (a.winRate ?? 0);
      if (a.ratedTrades !== b.ratedTrades) return b.ratedTrades - a.ratedTrades;
      return a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0;
    })
    .slice(0, limit);
}

export function gradeLetter(score: number): ConsensusGradeLetter {
  if (score >= 85) return "A";
  if (score >= 70) return "B";
  if (score >= 50) return "C";
  if (score >= 30) return "D";
  return "F";
}

export function formatConsensusLabel(score: number, grade: ConsensusGradeLetter) {
  return `Consensus Score: ${score}/100 - Grade ${grade}`;
}

function offsetMinutes(signalTime: Date, focalTime: Date) {
  return Math.round((signalTime.getTime() - focalTime.getTime()) / 60_000);
}

function closer(candidate: ConsensusSignal, current: ConsensusSignal, focal: ConsensusSignal) {
  const candidateDelta = Math.abs(candidate.signalTime.getTime() - focal.signalTime.getTime());
  const currentDelta = Math.abs(current.signalTime.getTime() - focal.signalTime.getTime());
  if (candidateDelta !== currentDelta) return candidateDelta < currentDelta;
  if (candidate.signalTime.getTime() !== current.signalTime.getTime()) return candidate.signalTime < current.signalTime;
  return candidate.id < current.id;
}

function inWindow(signal: ConsensusSignal, focal: ConsensusSignal) {
  return Math.abs(signal.signalTime.getTime() - focal.signalTime.getTime()) <= CONSENSUS_WINDOW_MS;
}

function poolPhrase(poolSize: number) {
  if (poolSize >= TOP_PERFORMER_COUNT) return "our top 10 historical performers";
  if (poolSize === 1) return "our historical performer with a measured record";
  return `our ${poolSize} historical performers with a measured record`;
}

function alignmentSentence(count: number, poolSize: number) {
  if (poolSize === 0) return "No sources have a large enough measured record to rank historical performers yet.";
  const subject = poolPhrase(poolSize);
  if (count === 0) return `None of ${subject} are currently aligned on this exact entry zone.`;
  const verb = count === 1 ? "is" : "are";
  return `${count} of ${subject} ${verb} currently aligned on this exact entry zone.`;
}

function oppositionSentence(count: number, poolSize: number) {
  if (count <= 0 || poolSize === 0) return null;
  const subject = poolPhrase(poolSize);
  const verb = count === 1 ? "is" : "are";
  return `${count} of ${subject} ${verb} positioned the other way on this zone.`;
}

function riskNote(risk: ConsensusRisk, opposedAccurate: number) {
  if (risk === "low") return null;
  if (opposedAccurate >= 2) {
    return "Disagreement raises risk. Several historically accurate sources are positioned the other way on this zone.";
  }
  if (opposedAccurate === 1) {
    return "Disagreement raises risk. A historically accurate source is positioned the other way on this zone.";
  }
  return "Disagreement raises risk. Another source in this 30-minute window is positioned the other way.";
}

export function computeConsensus(
  focal: ConsensusSignal,
  candidates: ConsensusSignal[],
  performances: SourcePerformance[],
  opts: { rankableSourceIds?: ReadonlySet<string> } = {},
): ConsensusComputation {
  const perfBySource = new Map(performances.map((p) => [p.sourceId, p]));
  const rankable = opts.rankableSourceIds;
  const ranked = rankHistoricalPerformers(
    performances.filter((p) => (rankable ? rankable.has(p.sourceId) : true)),
  );
  const rankBySource = new Map(ranked.map((p, index) => [p.sourceId, index + 1]));

  const eligible = candidates.filter((candidate) => {
    if (candidate.id === focal.id) return true;
    if (EXCLUDED_STATUSES.has(candidate.status)) return false;
    if (normalizeInstrument(candidate.instrument) !== normalizeInstrument(focal.instrument)) return false;
    if (!inWindow(candidate, focal)) return false;
    return sameZone(focal, candidate);
  });

  const bySource = new Map<string, ConsensusSignal>();
  bySource.set(focal.sourceId, focal);
  for (const candidate of eligible) {
    if (candidate.sourceId === focal.sourceId) continue;
    const current = bySource.get(candidate.sourceId);
    if (!current || closer(candidate, current, focal)) bySource.set(candidate.sourceId, candidate);
  }

  let score = BASE_SCORE;
  let opposedAccurate = 0;
  let alignedAccuratePeers = 0;
  let opposedSources = 0;
  let alignedSources = 0;

  const participants: ConsensusParticipant[] = [];
  for (const signal of bySource.values()) {
    const perf = perfBySource.get(signal.sourceId);
    const accurate = perf ? isHistoricallyAccurate(perf) : false;
    const aligned = signal.direction === focal.direction;
    const isFocal = signal.id === focal.id;
    if (aligned) alignedSources += 1;
    else opposedSources += 1;
    if (!isFocal && aligned) {
      score += accurate ? ALIGNED_ACCURATE_POINTS : ALIGNED_REGULAR_POINTS;
      if (accurate) alignedAccuratePeers += 1;
    } else if (!aligned) {
      score -= accurate ? OPPOSED_ACCURATE_POINTS : OPPOSED_REGULAR_POINTS;
      if (accurate) opposedAccurate += 1;
    }
    participants.push({
      signalId: signal.id,
      sourceId: signal.sourceId,
      direction: signal.direction,
      entryMin: Math.min(signal.entryMin, signal.entryMax),
      entryMax: Math.max(signal.entryMin, signal.entryMax),
      signalTime: signal.signalTime,
      offsetMinutes: offsetMinutes(signal.signalTime, focal.signalTime),
      role: isFocal ? "focal" : aligned ? "aligned" : "opposed",
      historicallyAccurate: accurate,
      topPerformerRank: rankBySource.get(signal.sourceId) ?? null,
    });
  }

  score = Math.max(0, Math.min(100, score));
  const grade = gradeLetter(score);
  const risk: ConsensusRisk =
    opposedAccurate >= 2 || (opposedAccurate >= 1 && opposedAccurate > alignedAccuratePeers)
      ? "high"
      : opposedSources > 0
        ? "elevated"
        : "low";

  const offsets = participants.map((p) => p.offsetMinutes).sort((a, b) => a - b);
  const alignedTop = participants.filter((p) => p.role !== "opposed" && p.topPerformerRank !== null).length;
  const opposedTop = participants.filter((p) => p.role === "opposed" && p.topPerformerRank !== null).length;

  participants.sort((a, b) => a.offsetMinutes - b.offsetMinutes || a.signalId.localeCompare(b.signalId));

  return {
    grade: {
      version: CONSENSUS_VERSION,
      score,
      grade,
      label: formatConsensusLabel(score, grade),
      risk,
      riskNote: riskNote(risk, opposedAccurate),
    },
    timing: {
      windowMinutes: CONSENSUS_WINDOW_MINUTES,
      alignedSources,
      opposedSources,
      clusterSpanMinutes: offsets.length ? offsets[offsets.length - 1] - offsets[0] : 0,
      offsetsMinutes: offsets,
    },
    mapping: {
      poolSize: ranked.length,
      aligned: alignedTop,
      opposed: opposedTop,
      sentence: alignmentSentence(alignedTop, ranked.length),
      oppositionSentence: oppositionSentence(opposedTop, ranked.length),
    },
    participants,
  };
}
