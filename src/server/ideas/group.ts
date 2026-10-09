import { sameZone } from "@/server/consensus/rules";

const QUIET_MS = 30 * 60_000;

/**
 * One idea is one order. Members still have to sit within $2 of each other, and
 * the whole entry has to fit in this window. A chain of $2 steps can no longer
 * walk up with price into a different trade.
 */
export const IDEA_ENTRY_SPAN_USD = 6;

export function entrySpan(rows: { entryMin: number; entryMax: number }[]) {
  if (!rows.length) return 0;
  return Math.max(...rows.map((row) => row.entryMax)) - Math.min(...rows.map((row) => row.entryMin));
}

/** The silver call starts when a third source agrees, not at the first post. */
export function qualifiedCallAt(times: number[]) {
  const ordered = times.filter((time) => Number.isFinite(time)).sort((a, b) => a - b);
  if (ordered.length >= 3) return ordered[2];
  return ordered[0] ?? null;
}

export interface GroupSignal {
  id: string;
  sourceId: string;
  direction: "LONG" | "SHORT";
  entryMin: number;
  entryMax: number;
  stopLoss: number | null;
  targets: number[];
  signalTime: number;
  status: string;
  qa: boolean;
}

export interface GroupedIdea {
  direction: "LONG" | "SHORT";
  entryMin: number;
  entryMax: number;
  stopLoss: number | null;
  targets: number[];
  exitSpreadStops: number | null;
  exitSpreadTargets: number[];
  sourceCount: number;
  signalIds: string[];
  replacedSignalIds: string[];
  newestSignalAt: number;
  frozenAt: number | null;
}

const mean = (xs: number[]) => xs.reduce((s, n) => s + n, 0) / xs.length;
const range = (xs: number[]) => (xs.length < 2 ? 0 : Math.max(...xs) - Math.min(...xs));

function clusterMid(rows: GroupSignal[]) {
  return mean(rows.map((row) => (row.entryMin + row.entryMax) / 2));
}

function canJoin(rows: GroupSignal[], signal: GroupSignal) {
  const newest = rows.reduce((latest, row) => Math.max(latest, row.signalTime), 0);
  if (signal.signalTime - newest > QUIET_MS) return false;
  if (rows[0].direction !== signal.direction) return false;
  if (!rows.some((row) => sameZone(row, signal))) return false;
  return entrySpan([...rows, signal]) <= IDEA_ENTRY_SPAN_USD;
}

export function groupSignals(signals: GroupSignal[], now: number): GroupedIdea[] {
  const usable = signals
    .filter((s) => !s.qa && s.status !== "INVALID" && s.status !== "CANCELLED" && s.status !== "MANUAL_REVIEW")
    .filter((s) => Number.isFinite(s.entryMin) && Number.isFinite(s.entryMax))
    .sort((a, b) => a.signalTime - b.signalTime);
  const open: { rows: GroupSignal[]; replacedSignalIds: string[] }[] = [];
  for (const signal of usable) {
    const matches = open.filter(({ rows }) => canJoin(rows, signal));
    const mid = (signal.entryMin + signal.entryMax) / 2;
    matches.sort((a, b) => Math.abs(clusterMid(a.rows) - mid) - Math.abs(clusterMid(b.rows) - mid));
    const cluster = matches[0];
    if (!cluster) open.push({ rows: [signal], replacedSignalIds: [] });
    else {
      const prior = cluster.rows.findIndex((row) => row.sourceId === signal.sourceId);
      if (prior >= 0) {
        const [removed] = cluster.rows.splice(prior, 1);
        cluster.replacedSignalIds.push(removed.id);
      }
      cluster.rows.push(signal);
    }
  }
  return open.map(({ rows, replacedSignalIds }) => {
    const stops = rows.map((r) => r.stopLoss).filter((n): n is number => n !== null);
    const slots = Math.max(...rows.map((r) => r.targets.length));
    const targets = Array.from({ length: slots }, (_, i) => mean(rows.map((r) => r.targets[i]).filter((n): n is number => n !== undefined)));
    const newest = Math.max(...rows.map((r) => r.signalTime));
    return {
      direction: rows[0].direction,
      entryMin: mean(rows.map((r) => r.entryMin)),
      entryMax: mean(rows.map((r) => r.entryMax)),
      stopLoss: stops.length ? mean(stops) : null,
      targets,
      exitSpreadStops: stops.length ? range(stops) : null,
      exitSpreadTargets: Array.from({ length: slots }, (_, i) => range(rows.map((r) => r.targets[i]).filter((n): n is number => n !== undefined))),
      sourceCount: new Set(rows.map((r) => r.sourceId)).size,
      signalIds: rows.map((r) => r.id),
      replacedSignalIds,
      newestSignalAt: newest,
      frozenAt: now - newest >= QUIET_MS ? newest + QUIET_MS : null,
    };
  });
}
