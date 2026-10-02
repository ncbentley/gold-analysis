import { sameZone } from "@/server/consensus/rules";

const QUIET_MS = 30 * 60_000;

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
  newestSignalAt: number;
  frozenAt: number | null;
}

const mean = (xs: number[]) => xs.reduce((s, n) => s + n, 0) / xs.length;
const range = (xs: number[]) => (xs.length < 2 ? 0 : Math.max(...xs) - Math.min(...xs));

export function groupSignals(signals: GroupSignal[], now: number): GroupedIdea[] {
  const usable = signals
    .filter((s) => !s.qa && s.status !== "INVALID" && s.status !== "CANCELLED" && s.status !== "MANUAL_REVIEW")
    .filter((s) => Number.isFinite(s.entryMin) && Number.isFinite(s.entryMax))
    .sort((a, b) => a.signalTime - b.signalTime);
  const open: GroupSignal[][] = [];
  for (const signal of usable) {
    const cluster = open.find((rows) => {
      const newest = rows.reduce((m, r) => Math.max(m, r.signalTime), 0);
      if (signal.signalTime - newest > QUIET_MS) return false;
      if (rows[0].direction !== signal.direction) return false;
      return rows.some((row) => sameZone(row, signal));
    });
    if (!cluster) open.push([signal]);
    else {
      const prior = cluster.findIndex((row) => row.sourceId === signal.sourceId);
      if (prior >= 0) cluster.splice(prior, 1);
      cluster.push(signal);
    }
  }
  return open.map((rows) => {
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
      newestSignalAt: newest,
      frozenAt: now - newest >= QUIET_MS ? now : null,
    };
  });
}
