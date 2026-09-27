/**
 * Source statistics computed only from deterministic outcomes. Pure functions.
 */

export const STATS_VERSION = "stats-v1";

export interface StatsInputRow {
  signalId: string;
  direction: "LONG" | "SHORT";
  entryType: string;
  signalType: string | null;
  signalTime: Date;
  classification: string;
  entered: boolean;
  rResult: number | null;
  mfe: number | null;
  mae: number | null;
  mfeR: number | null;
  maeR: number | null;
  durationMinutes: number | null;
  targetMinutes: (number | null)[];
}

export interface Bucket {
  n: number;
  wins: number;
  losses: number;
  breakevens: number;
  winRate: number | null;
  avgR: number | null;
  sumR: number;
}

export interface SourceStatistics {
  calcVersion: string;
  totalSignals: number;
  enteredSignals: number;
  closedTrades: number;
  openTrades: number;
  wins: number;
  losses: number;
  breakevens: number;
  ambiguous: number;
  cancelled: number;
  expired: number;
  winRate: number | null;
  avgR: number | null;
  medianR: number | null;
  avgWinR: number | null;
  avgLossR: number | null;
  expectancy: number | null;
  ratedTrades: number;
  avgMfe: number | null;
  avgMae: number | null;
  avgMfeR: number | null;
  avgMaeR: number | null;
  mfeRPercentiles: { p25: number; p50: number; p75: number } | null;
  maeRPercentiles: { p25: number; p50: number; p75: number } | null;
  avgDurationMinutes: number | null;
  recent10: Bucket;
  recent30: Bucket;
  byDirection: Record<string, Bucket>;
  byHour: Bucket[];
  byDayOfWeek: Bucket[];
  bySession: Record<string, Bucket>;
  bySignalType: Record<string, Bucket>;
  byEntryType: Record<string, Bucket>;
  timeToTarget: { target: number; n: number; hitRate: number | null; medianMinutes: number | null; avgMinutes: number | null }[];
}

const CLOSED = new Set(["WON", "LOST", "BREAKEVEN"]);
const r2 = (n: number | null) => (n === null ? null : Math.round(n * 100) / 100);
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function quantile(xs: number[], q: number): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

export function bucket(rows: StatsInputRow[]): Bucket {
  const closed = rows.filter((r) => r.entered && CLOSED.has(r.classification));
  const wins = closed.filter((r) => r.classification === "WON").length;
  const losses = closed.filter((r) => r.classification === "LOST").length;
  const rs = closed.map((r) => r.rResult).filter((x): x is number => x !== null);
  return {
    n: closed.length,
    wins,
    losses,
    breakevens: closed.length - wins - losses,
    winRate: closed.length ? r2(wins / closed.length) : null,
    avgR: r2(mean(rs)),
    sumR: r2(rs.reduce((a, b) => a + b, 0)) ?? 0,
  };
}

export function sessionFor(date: Date): string {
  const h = date.getUTCHours();
  if (h >= 22 || h < 7) return "Asia";
  if (h < 12) return "London";
  if (h < 17) return "New York";
  return "Late US";
}

function groupBy(rows: StatsInputRow[], key: (r: StatsInputRow) => string | null) {
  const out: Record<string, Bucket> = {};
  const groups = new Map<string, StatsInputRow[]>();
  for (const r of rows) {
    const k = key(r);
    if (k === null) continue;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  for (const [k, g] of groups) out[k] = bucket(g);
  return out;
}

export function computeSourceStatistics(input: StatsInputRow[]): SourceStatistics {
  const rows = [...input].sort((a, b) => a.signalTime.getTime() - b.signalTime.getTime());
  const entered = rows.filter((r) => r.entered);
  const closed = entered.filter((r) => CLOSED.has(r.classification));
  const overall = bucket(rows);
  const rated = closed.filter((r) => r.rResult !== null);
  const rs = rated.map((r) => r.rResult as number);
  const winRs = rated.filter((r) => r.classification === "WON").map((r) => r.rResult as number);
  const lossRs = rated.filter((r) => r.classification === "LOST").map((r) => r.rResult as number);
  const ratedWinRate = rated.length ? winRs.length / rated.length : null;
  const ratedLossRate = rated.length ? lossRs.length / rated.length : null;
  const avgWinR = mean(winRs);
  const avgLossR = mean(lossRs);
  const expectancy =
    ratedWinRate === null ? null : ratedWinRate * (avgWinR ?? 0) + (ratedLossRate ?? 0) * (avgLossR ?? 0);

  const mfeR = closed.map((r) => r.mfeR).filter((x): x is number => x !== null);
  const maeR = closed.map((r) => r.maeR).filter((x): x is number => x !== null);
  const pct = (xs: number[]) =>
    xs.length ? { p25: r2(quantile(xs, 0.25))!, p50: r2(quantile(xs, 0.5))!, p75: r2(quantile(xs, 0.75))! } : null;

  const maxTargets = Math.max(0, ...entered.map((r) => r.targetMinutes.length));
  const timeToTarget = Array.from({ length: maxTargets }, (_, i) => {
    const eligible = entered.filter((r) => r.targetMinutes.length > i && r.classification !== "OPEN");
    const mins = eligible.map((r) => r.targetMinutes[i]).filter((x): x is number => x !== null);
    return {
      target: i + 1,
      n: eligible.length,
      hitRate: eligible.length ? r2(mins.length / eligible.length) : null,
      medianMinutes: r2(quantile(mins, 0.5)),
      avgMinutes: r2(mean(mins)),
    };
  });

  const byHour = Array.from({ length: 24 }, (_, h) => bucket(rows.filter((r) => r.signalTime.getUTCHours() === h)));
  const byDayOfWeek = Array.from({ length: 7 }, (_, d) => bucket(rows.filter((r) => r.signalTime.getUTCDay() === d)));

  return {
    calcVersion: STATS_VERSION,
    totalSignals: rows.length,
    enteredSignals: entered.length,
    closedTrades: closed.length,
    openTrades: entered.filter((r) => r.classification === "OPEN").length,
    wins: overall.wins,
    losses: overall.losses,
    breakevens: overall.breakevens,
    ambiguous: rows.filter((r) => r.classification === "AMBIGUOUS").length,
    cancelled: rows.filter((r) => r.classification === "CANCELLED").length,
    expired: rows.filter((r) => r.classification === "EXPIRED").length,
    winRate: overall.winRate,
    avgR: r2(mean(rs)),
    medianR: r2(quantile(rs, 0.5)),
    avgWinR: r2(avgWinR),
    avgLossR: r2(avgLossR),
    expectancy: r2(expectancy),
    ratedTrades: rated.length,
    avgMfe: r2(mean(closed.map((r) => r.mfe).filter((x): x is number => x !== null))),
    avgMae: r2(mean(closed.map((r) => r.mae).filter((x): x is number => x !== null))),
    avgMfeR: r2(mean(mfeR)),
    avgMaeR: r2(mean(maeR)),
    mfeRPercentiles: pct(mfeR),
    maeRPercentiles: pct(maeR),
    avgDurationMinutes: r2(mean(closed.map((r) => r.durationMinutes).filter((x): x is number => x !== null))),
    recent10: bucket(closed.slice(-10)),
    recent30: bucket(closed.slice(-30)),
    byDirection: groupBy(rows, (r) => r.direction),
    byHour,
    byDayOfWeek,
    bySession: groupBy(rows, (r) => sessionFor(r.signalTime)),
    bySignalType: groupBy(rows, (r) => r.signalType),
    byEntryType: groupBy(rows, (r) => r.entryType),
    timeToTarget,
  };
}
