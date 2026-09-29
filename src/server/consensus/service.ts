import { and, eq, gte, inArray, lte, notInArray } from "drizzle-orm";
import { getDb } from "@/server/db";
import { signals, sources, sourceStats, type Signal } from "@/server/db/schema";
import { STATS_VERSION, type SourceStatistics } from "@/server/statistics/compute";
import { refreshSourceStats } from "@/server/statistics/service";
import {
  computeConsensus,
  memberConsensus,
  CONSENSUS_WINDOW_MS,
  type ConsensusComputation,
  type ConsensusParticipant,
  type ConsensusSignal,
  type MemberConsensus,
  type SourcePerformance,
} from "./rules";

const EXCLUDED_STATUSES = ["INVALID", "MANUAL_REVIEW", "CANCELLED"] as const;

function toConsensusSignal(signal: Signal): ConsensusSignal {
  return {
    id: signal.id,
    sourceId: signal.sourceId,
    instrument: signal.instrument,
    direction: signal.direction,
    entryMin: signal.entryMin,
    entryMax: signal.entryMax,
    signalTime: signal.signalTime,
    status: signal.status,
  };
}

function performanceFrom(stats: SourceStatistics, sourceId: string): SourcePerformance {
  return {
    sourceId,
    ratedTrades: stats.ratedTrades,
    winRate: stats.winRate,
    expectancy: stats.expectancy,
  };
}

async function performancesFor(sourceIds: string[]): Promise<Map<string, SourcePerformance>> {
  const db = await getDb();
  const stored = sourceIds.length ? await db.select().from(sourceStats).where(inArray(sourceStats.sourceId, sourceIds)) : [];
  const out = new Map<string, SourcePerformance>();
  for (const row of stored) {
    if (row.calcVersion !== STATS_VERSION) continue;
    out.set(row.sourceId, performanceFrom(row.statsJson as unknown as SourceStatistics, row.sourceId));
  }
  for (const sourceId of sourceIds) {
    if (out.has(sourceId)) continue;
    out.set(sourceId, performanceFrom(await refreshSourceStats(sourceId), sourceId));
  }
  return out;
}

export async function loadConsensus(signalId: string): Promise<ConsensusComputation | null> {
  const db = await getDb();
  const [focalRow] = await db.select().from(signals).where(eq(signals.id, signalId));
  if (!focalRow) return null;

  const from = new Date(focalRow.signalTime.getTime() - CONSENSUS_WINDOW_MS);
  const to = new Date(focalRow.signalTime.getTime() + CONSENSUS_WINDOW_MS);
  const rows = await db
    .select({ signal: signals })
    .from(signals)
    .innerJoin(sources, eq(sources.id, signals.sourceId))
    .where(
      and(
        gte(signals.signalTime, from),
        lte(signals.signalTime, to),
        eq(sources.isQa, false),
        notInArray(signals.status, [...EXCLUDED_STATUSES]),
      ),
    );

  const liveSources = await db.select({ id: sources.id }).from(sources).where(eq(sources.isQa, false));
  const rankableIds = liveSources.map((s) => s.id);
  const perfIds = rankableIds.includes(focalRow.sourceId) ? rankableIds : [...rankableIds, focalRow.sourceId];
  const performances = await performancesFor(perfIds);
  const candidates = rows.map((row) => toConsensusSignal(row.signal));
  if (!candidates.some((candidate) => candidate.id === focalRow.id)) candidates.push(toConsensusSignal(focalRow));

  return computeConsensus(toConsensusSignal(focalRow), candidates, [...performances.values()], {
    rankableSourceIds: new Set(rankableIds),
  });
}

export async function loadMemberConsensus(signalId: string): Promise<MemberConsensus | null> {
  const result = await loadConsensus(signalId);
  return result ? memberConsensus(result) : null;
}

export interface AdminConsensusParticipant extends ConsensusParticipant {
  sourceName: string;
  slug: string;
  telegramUsername: string | null;
}

export interface AdminConsensus extends MemberConsensus {
  participants: AdminConsensusParticipant[];
}

/** Admin-only projection. Real channel names stay on this object and off the member presenter. */
export async function loadAdminConsensus(signalId: string): Promise<AdminConsensus | null> {
  const result = await loadConsensus(signalId);
  if (!result) return null;
  const db = await getDb();
  const ids = [...new Set(result.participants.map((p) => p.sourceId))];
  const srcRows = ids.length
    ? await db
        .select({
          id: sources.id,
          name: sources.name,
          slug: sources.slug,
          telegramUsername: sources.telegramUsername,
        })
        .from(sources)
        .where(inArray(sources.id, ids))
    : [];
  const byId = new Map(srcRows.map((row) => [row.id, row]));
  return {
    ...memberConsensus(result),
    participants: result.participants.map((participant) => {
      const source = byId.get(participant.sourceId);
      return {
        ...participant,
        sourceName: source?.name ?? participant.sourceId,
        slug: source?.slug ?? "",
        telegramUsername: source?.telegramUsername ?? null,
      };
    }),
  };
}
