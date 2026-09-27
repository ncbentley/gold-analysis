import { and, asc, desc, eq, gte, ilike, inArray, lte, sql, type SQL } from "drizzle-orm";
import { getCurrentAnalysis } from "@/server/ai/service";
import { getDb } from "@/server/db";
import {
  rawEvents,
  signalOutcomes,
  signals,
  signalTargets,
  sources,
  SIGNAL_STATUSES,
  type SignalStatus,
} from "@/server/db/schema";
import { buildAccess, can, historyCutoff, lowestTierWith } from "@/server/entitlements/access";
import type { Viewer } from "@/server/entitlements/service";
import { presentSignalDetail, presentSignalListItem, type SignalBundle } from "@/server/presenters";
import { getSimilarTradesForSignal } from "@/server/similar/service";
import { getSourceStats } from "@/server/statistics/service";

export interface SignalFilters {
  sourceId?: string;
  status?: SignalStatus | "OPEN" | "CLOSED";
  direction?: "LONG" | "SHORT";
  from?: Date;
  to?: Date;
  // Advanced (Platinum by default)
  entryType?: "MARKET" | "LIMIT" | "ZONE";
  signalType?: string;
  classification?: string;
  q?: string;
}

const OPEN: SignalStatus[] = ["PENDING", "ACTIVE", "PARTIAL"];
const CLOSED: SignalStatus[] = ["WON", "LOST", "BREAKEVEN", "CANCELLED", "EXPIRED", "MANUAL_REVIEW"];

export function parseSignalFilters(params: URLSearchParams | Record<string, string | string[] | undefined>): SignalFilters {
  const get = (k: string) => {
    const v = params instanceof URLSearchParams ? params.get(k) : params[k];
    const s = Array.isArray(v) ? v[0] : v;
    return s && s !== "all" ? s : undefined;
  };
  const date = (s?: string) => (s && !Number.isNaN(Date.parse(s)) ? new Date(s) : undefined);
  const status = get("status");
  const direction = get("direction");
  const entryType = get("entryType");
  return {
    sourceId: get("source"),
    status: status && ([...SIGNAL_STATUSES, "OPEN", "CLOSED"] as string[]).includes(status) ? (status as SignalFilters["status"]) : undefined,
    direction: direction === "LONG" || direction === "SHORT" ? direction : undefined,
    from: date(get("from")),
    to: date(get("to")),
    entryType: entryType === "MARKET" || entryType === "LIMIT" || entryType === "ZONE" ? entryType : undefined,
    signalType: get("signalType"),
    classification: get("classification"),
    q: get("q")?.slice(0, 100),
  };
}

async function hydrate(rows: { signal: typeof signals.$inferSelect; source: typeof sources.$inferSelect; outcome: typeof signalOutcomes.$inferSelect | null }[]) {
  const db = await getDb();
  const ids = rows.map((r) => r.signal.id);
  const targets = ids.length ? await db.select().from(signalTargets).where(inArray(signalTargets.signalId, ids)).orderBy(asc(signalTargets.targetIndex)) : [];
  return rows.map<SignalBundle>((r) => ({
    signal: r.signal,
    source: r.source,
    outcome: r.outcome,
    targets: targets.filter((t) => t.signalId === r.signal.id),
  }));
}

export interface ListResult {
  items: ReturnType<typeof presentSignalListItem>[];
  total: number;
  appliedFilters: SignalFilters;
  ignoredFilters: string[];
  historyCutoff: string | null;
}

/** Lists signals visible to the viewer. Enforces history depth and advanced-filter entitlements server-side. */
export async function listSignalsForViewer(viewer: Viewer, filters: SignalFilters, opts: { limit?: number; offset?: number } = {}): Promise<ListResult> {
  const db = await getDb();
  const { access, config } = viewer;
  const ignored: string[] = [];
  const f = { ...filters };
  if (!can(access, "filters.advanced")) {
    for (const k of ["entryType", "signalType", "classification"] as const) if (f[k]) { ignored.push(k); delete f[k]; }
  }
  if (!can(access, "search.history") && f.q) { ignored.push("q"); delete f.q; }

  const cutoff = historyCutoff(access);
  const conds: SQL[] = [sql`${signals.status} <> 'INVALID'`];
  if (!access.isAdmin) conds.push(eq(sources.isQa, false));
  if (cutoff) conds.push(gte(signals.signalTime, cutoff));
  if (f.sourceId) conds.push(eq(signals.sourceId, f.sourceId));
  if (f.status === "OPEN") conds.push(inArray(signals.status, OPEN));
  else if (f.status === "CLOSED") conds.push(inArray(signals.status, CLOSED));
  else if (f.status) conds.push(eq(signals.status, f.status));
  if (f.direction) conds.push(eq(signals.direction, f.direction));
  if (f.from) conds.push(gte(signals.signalTime, f.from));
  if (f.to) conds.push(lte(signals.signalTime, new Date(f.to.getTime() + 86_399_999)));
  if (f.entryType) conds.push(eq(signals.entryType, f.entryType));
  if (f.signalType) conds.push(eq(signals.signalType, f.signalType));
  if (f.classification) conds.push(eq(signalOutcomes.classification, f.classification));
  if (f.q) conds.push(ilike(rawEvents.rawText, `%${f.q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`));

  const where = and(...conds);
  const base = db
    .select({ signal: signals, source: sources, outcome: signalOutcomes })
    .from(signals)
    .innerJoin(sources, eq(sources.id, signals.sourceId))
    .innerJoin(rawEvents, eq(rawEvents.id, signals.originEventId))
    .leftJoin(signalOutcomes, and(eq(signalOutcomes.signalId, signals.id), eq(signalOutcomes.isCurrent, true)));
  const rows = await base.where(where).orderBy(desc(signals.signalTime)).limit(opts.limit ?? 50).offset(opts.offset ?? 0);
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(signals)
    .innerJoin(sources, eq(sources.id, signals.sourceId))
    .innerJoin(rawEvents, eq(rawEvents.id, signals.originEventId))
    .leftJoin(signalOutcomes, and(eq(signalOutcomes.signalId, signals.id), eq(signalOutcomes.isCurrent, true)))
    .where(where);

  const bundles = await hydrate(rows);
  return {
    items: bundles.map((b) => presentSignalListItem(b, access, config)),
    total: count,
    appliedFilters: f,
    ignoredFilters: ignored,
    historyCutoff: cutoff?.toISOString() ?? null,
  };
}

export async function getSignalBundle(signalId: string): Promise<SignalBundle | null> {
  const db = await getDb();
  const rows = await db
    .select({ signal: signals, source: sources, outcome: signalOutcomes })
    .from(signals)
    .innerJoin(sources, eq(sources.id, signals.sourceId))
    .leftJoin(signalOutcomes, and(eq(signalOutcomes.signalId, signals.id), eq(signalOutcomes.isCurrent, true)))
    .where(eq(signals.id, signalId));
  if (!rows.length) return null;
  return (await hydrate(rows))[0];
}

export type SignalDetailResult =
  | { kind: "not_found" }
  | { kind: "no_access"; requiredTier: string | null }
  | { kind: "history_locked"; requiredTier: string | null }
  | { kind: "ok"; detail: ReturnType<typeof presentSignalDetail> };

export async function getSignalDetailForViewer(signalId: string, viewer: Viewer): Promise<SignalDetailResult> {
  const { access, config } = viewer;
  const bundle = await getSignalBundle(signalId);
  if (!bundle || bundle.signal.status === "INVALID") return { kind: "not_found" };
  if (bundle.source.isQa && !access.isAdmin) return { kind: "not_found" };
  if (!can(access, "signals.core")) return { kind: "no_access", requiredTier: lowestTierWith("signals.core", config) };
  const cutoff = historyCutoff(access);
  if (cutoff && bundle.signal.signalTime < cutoff) return { kind: "history_locked", requiredTier: lowestTierWith("sources.history.full", config) };

  const db = await getDb();
  const [origin] = await db.select().from(rawEvents).where(eq(rawEvents.id, bundle.signal.originEventId));
  const updates = await db.execute<{ published_at: Date; event_type: string | null; raw_text: string }>(sql`
    select distinct re.published_at, re.event_type, re.raw_text
    from raw_events re
    left join signal_adjustments sa on sa.raw_event_id = re.id
    left join parse_results pr on pr.raw_event_id = re.id and pr.is_current
    where (sa.signal_id = ${signalId} or pr.signal_id = ${signalId}) and re.id <> ${bundle.signal.originEventId}
    order by re.published_at asc`);

  const needSimilar = can(access, "similar.summary") || can(access, "similar.details");
  const needAi = can(access, "ai.classification") || can(access, "ai.summary") || can(access, "ai.patterns");

  const [stats, similar, analysis] = await Promise.all([
    getSourceStats(bundle.signal.sourceId),
    needSimilar ? getSimilarTradesForSignal(signalId) : Promise.resolve(null),
    needAi ? getCurrentAnalysis({ signalId, analysisType: "signal_setup" }) : Promise.resolve(null),
  ]);

  const detail = presentSignalDetail(
    {
      ...bundle,
      rawText: origin?.rawText ?? null,
      updates: (updates.rows ?? []).map((u) => ({ publishedAt: new Date(u.published_at), eventType: u.event_type, rawText: u.raw_text })),
      sourceStats: stats,
      similar,
      analysis,
    },
    access,
    config,
  );
  return { kind: "ok", detail };
}

/**
 * Public sample for the landing page: closed trades older than `delayDays`, projected
 * with Silver-level fields only so nothing premium leaks to anonymous visitors.
 */
export async function listPublicSampleSignals(config: Viewer["config"], opts: { delayDays?: number; limit?: number } = {}) {
  const db = await getDb();
  const before = new Date(Date.now() - (opts.delayDays ?? 7) * 86_400_000);
  const rows = await db
    .select({ signal: signals, source: sources, outcome: signalOutcomes })
    .from(signals)
    .innerJoin(sources, eq(sources.id, signals.sourceId))
    .leftJoin(signalOutcomes, and(eq(signalOutcomes.signalId, signals.id), eq(signalOutcomes.isCurrent, true)))
    .where(and(inArray(signals.status, ["WON", "LOST", "BREAKEVEN"]), lte(signals.signalTime, before), eq(sources.isQa, false), eq(sources.active, true)))
    .orderBy(desc(signals.signalTime))
    .limit(opts.limit ?? 6);
  const access = buildAccess("silver", config);
  return (await hydrate(rows)).map((b) => presentSignalListItem(b, access, config));
}

/** QA channels are admin-only and excluded unless `includeQa` is set. */
export async function listSources(opts: { includeInactive?: boolean; includeQa?: boolean } = {}) {
  const db = await getDb();
  return db
    .select()
    .from(sources)
    .where(and(opts.includeInactive ? undefined : eq(sources.active, true), opts.includeQa ? undefined : eq(sources.isQa, false)))
    .orderBy(asc(sources.name));
}

export async function getSourceBySlugOrId(key: string, opts: { includeQa?: boolean } = {}) {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(sources)
    .where(sql`${sources.slug} = ${key} or ${sources.id} = ${key}`);
  if (row?.isQa && !opts.includeQa) return null;
  return row ?? null;
}

export async function listSignalTypes() {
  const db = await getDb();
  const rows = await db.selectDistinct({ t: signals.signalType }).from(signals).where(sql`${signals.signalType} is not null`);
  return rows.map((r) => r.t!).sort();
}
