/**
 * Deterministic similar-trade matching. Only trades that closed before the target
 * signal was published are eligible, so the comparison never uses future information.
 */
import { sessionFor } from "@/server/statistics/compute";

export interface SimilarCandidate {
  signalId: string;
  sourceId: string;
  direction: "LONG" | "SHORT";
  entryType: string;
  signalType: string | null;
  signalTime: Date;
  closedAt: Date | null;
  classification: string;
  rResult: number | null;
  mfeR: number | null;
  maeR: number | null;
  durationMinutes: number | null;
  tags: string[];
}

export type Dimension = "source" | "direction" | "session" | "dayOfWeek" | "entryType" | "signalType" | "tags";

export interface SimilarTradesResult {
  dimensions: Dimension[];
  matched: {
    signalId: string;
    signalTime: string;
    direction: string;
    classification: string;
    rResult: number | null;
    mfeR: number | null;
    maeR: number | null;
    durationMinutes: number | null;
  }[];
  summary: { n: number; wins: number; losses: number; winRate: number | null; avgR: number | null };
}

const CLOSED = new Set(["WON", "LOST", "BREAKEVEN"]);

const matchers: Record<Dimension, (a: SimilarCandidate, b: SimilarCandidate) => boolean> = {
  source: (a, b) => a.sourceId === b.sourceId,
  direction: (a, b) => a.direction === b.direction,
  session: (a, b) => sessionFor(a.signalTime) === sessionFor(b.signalTime),
  dayOfWeek: (a, b) => a.signalTime.getUTCDay() === b.signalTime.getUTCDay(),
  entryType: (a, b) => a.entryType === b.entryType,
  signalType: (a, b) => (a.signalType ?? "") === (b.signalType ?? ""),
  tags: (a, b) => a.tags.length > 0 && a.tags.some((t) => b.tags.includes(t)),
};

/** Dimensions are relaxed from the end of this list until enough matches exist. */
const RELAX_ORDER: Dimension[] = ["source", "direction", "session", "entryType", "signalType", "dayOfWeek", "tags"];
const ALWAYS_KEEP = 2;

export function findSimilarTrades(
  target: SimilarCandidate,
  candidates: SimilarCandidate[],
  minMatches = 5,
): SimilarTradesResult {
  const eligible = candidates.filter(
    (c) =>
      c.signalId !== target.signalId &&
      CLOSED.has(c.classification) &&
      c.closedAt !== null &&
      c.closedAt.getTime() <= target.signalTime.getTime(),
  );

  let dims = [...RELAX_ORDER];
  if (target.tags.length === 0) dims = dims.filter((d) => d !== "tags");
  let matched = eligible;
  while (true) {
    matched = eligible.filter((c) => dims.every((d) => matchers[d](target, c)));
    if (matched.length >= minMatches || dims.length <= ALWAYS_KEEP) break;
    dims = dims.slice(0, -1);
  }

  matched = [...matched].sort((a, b) => b.signalTime.getTime() - a.signalTime.getTime());
  const wins = matched.filter((m) => m.classification === "WON").length;
  const losses = matched.filter((m) => m.classification === "LOST").length;
  const rs = matched.map((m) => m.rResult).filter((x): x is number => x !== null);
  return {
    dimensions: dims,
    matched: matched.map((m) => ({
      signalId: m.signalId,
      signalTime: m.signalTime.toISOString(),
      direction: m.direction,
      classification: m.classification,
      rResult: m.rResult,
      mfeR: m.mfeR,
      maeR: m.maeR,
      durationMinutes: m.durationMinutes,
    })),
    summary: {
      n: matched.length,
      wins,
      losses,
      winRate: matched.length ? Math.round((wins / matched.length) * 100) / 100 : null,
      avgR: rs.length ? Math.round((rs.reduce((a, b) => a + b, 0) / rs.length) * 100) / 100 : null,
    },
  };
}
