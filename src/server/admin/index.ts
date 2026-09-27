import { and, asc, desc, eq, gte, inArray, sql, type SQL } from "drizzle-orm";
import { listAudit, recordAudit, type Actor } from "@/server/audit";
import { listAnalysisHistory } from "@/server/ai/service";
import { getDb } from "@/server/db";
import {
  analyticsEvents,
  jobs,
  parseResults,
  rawEvents,
  signalAdjustments,
  signals,
  sources,
  subscriptions,
  users,
  type Source,
} from "@/server/db/schema";
import { getMarketDataSummary, getSyncState } from "@/server/market-data";
import { listOutcomeHistory } from "@/server/outcomes/service";
import { getSignalBundle } from "@/server/signals/queries";

export async function getAdminOverview() {
  const db = await getDb();
  const dayAgo = new Date(Date.now() - 86_400_000);
  const weekAgo = new Date(Date.now() - 7 * 86_400_000);
  const [events] = await db
    .select({ total: sql<number>`count(*)::int`, day: sql<number>`count(*) filter (where ${rawEvents.receivedAt} >= ${dayAgo})::int` })
    .from(rawEvents);
  const signalStatus = await db.select({ status: signals.status, n: sql<number>`count(*)::int` }).from(signals).groupBy(signals.status);
  const parseStatus = await db
    .select({ status: parseResults.status, n: sql<number>`count(*)::int` })
    .from(parseResults)
    .where(eq(parseResults.isCurrent, true))
    .groupBy(parseResults.status);
  const jobStatus = await db.select({ status: jobs.status, n: sql<number>`count(*)::int` }).from(jobs).groupBy(jobs.status);
  const subs = await db
    .select({ tier: subscriptions.tier, n: sql<number>`count(*)::int` })
    .from(subscriptions)
    .where(and(inArray(subscriptions.status, ["active", "trialing", "past_due"]), gte(subscriptions.currentPeriodEnd, new Date())))
    .groupBy(subscriptions.tier);
  const [userCount] = await db.select({ n: sql<number>`count(*)::int` }).from(users);
  const analytics = await db
    .select({ name: analyticsEvents.name, n: sql<number>`count(*)::int` })
    .from(analyticsEvents)
    .where(gte(analyticsEvents.createdAt, weekAgo))
    .groupBy(analyticsEvents.name)
    .orderBy(desc(sql`count(*)`));
  const failedJobs = await db.select().from(jobs).where(eq(jobs.status, "failed")).orderBy(desc(jobs.finishedAt)).limit(5);
  const [market, sync] = await Promise.all([getMarketDataSummary(), getSyncState()]);
  const toMap = (rows: { status: string; n: number }[]) => Object.fromEntries(rows.map((r) => [r.status, r.n])) as Record<string, number>;
  return {
    events,
    signals: toMap(signalStatus),
    parses: toMap(parseStatus),
    jobs: toMap(jobStatus),
    subscriptions: Object.fromEntries(subs.map((s) => [s.tier, s.n])) as Record<string, number>,
    users: userCount.n,
    analytics,
    failedJobs,
    market,
    sync,
  };
}

export interface EventFilters {
  sourceId?: string;
  status?: string;
  eventType?: string;
}

export async function listRawEvents(f: EventFilters, opts: { limit?: number; offset?: number } = {}) {
  const db = await getDb();
  const conds: SQL[] = [];
  if (f.sourceId) conds.push(eq(rawEvents.sourceId, f.sourceId));
  if (f.status) conds.push(eq(parseResults.status, f.status as never));
  if (f.eventType) conds.push(eq(rawEvents.eventType, f.eventType as never));
  const where = conds.length ? and(...conds) : undefined;
  const q = db
    .select({ event: rawEvents, source: { id: sources.id, name: sources.name }, parse: parseResults })
    .from(rawEvents)
    .innerJoin(sources, eq(sources.id, rawEvents.sourceId))
    .leftJoin(parseResults, and(eq(parseResults.rawEventId, rawEvents.id), eq(parseResults.isCurrent, true)));
  const rows = await q.where(where).orderBy(desc(rawEvents.publishedAt)).limit(opts.limit ?? 50).offset(opts.offset ?? 0);
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(rawEvents)
    .leftJoin(parseResults, and(eq(parseResults.rawEventId, rawEvents.id), eq(parseResults.isCurrent, true)))
    .where(where);
  return { rows, total: n };
}

export async function getRawEventDetail(id: string) {
  const db = await getDb();
  const [row] = await db
    .select({ event: rawEvents, source: sources })
    .from(rawEvents)
    .innerJoin(sources, eq(sources.id, rawEvents.sourceId))
    .where(eq(rawEvents.id, id));
  if (!row) return null;
  const parses = await db.select().from(parseResults).where(eq(parseResults.rawEventId, id)).orderBy(desc(parseResults.createdAt));
  const [signal] = await db.select({ id: signals.id }).from(signals).where(eq(signals.originEventId, id));
  const audit = await listAudit({ entityType: "raw_event", entityId: id, limit: 20 });
  return { ...row, parses, signalId: signal?.id ?? null, audit };
}

export async function listReviewQueue() {
  const db = await getDb();
  return db
    .select({ event: rawEvents, source: { id: sources.id, name: sources.name, parserType: sources.parserType }, parse: parseResults })
    .from(parseResults)
    .innerJoin(rawEvents, eq(rawEvents.id, parseResults.rawEventId))
    .innerJoin(sources, eq(sources.id, rawEvents.sourceId))
    .where(and(eq(parseResults.isCurrent, true), eq(parseResults.status, "needs_review")))
    .orderBy(asc(rawEvents.publishedAt))
    .limit(100);
}

export async function getAdminSignalDetail(signalId: string) {
  const db = await getDb();
  const bundle = await getSignalBundle(signalId);
  if (!bundle) return null;
  const [origin] = await db.select().from(rawEvents).where(eq(rawEvents.id, bundle.signal.originEventId));
  const [adjustments, outcomes, analyses, audit, outcomeAudit] = await Promise.all([
    db.select().from(signalAdjustments).where(eq(signalAdjustments.signalId, signalId)).orderBy(asc(signalAdjustments.effectiveAt)),
    listOutcomeHistory(signalId),
    listAnalysisHistory(signalId),
    listAudit({ entityType: "signal", entityId: signalId, limit: 50 }),
    listAudit({ entityType: "signal_outcome", entityId: signalId, limit: 50 }),
  ]);
  const combinedAudit = [...audit, ...outcomeAudit].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return { ...bundle, origin, adjustments, outcomes, analyses, audit: combinedAudit };
}

export async function listJobs(f: { status?: string; type?: string }, limit = 100) {
  const db = await getDb();
  const conds: SQL[] = [];
  if (f.status) conds.push(eq(jobs.status, f.status as never));
  if (f.type) conds.push(eq(jobs.type, f.type));
  const where = conds.length ? and(...conds) : undefined;
  const rows = await db.select().from(jobs).where(where).orderBy(desc(jobs.createdAt)).limit(limit);
  const counts = await db.select({ status: jobs.status, n: sql<number>`count(*)::int` }).from(jobs).groupBy(jobs.status);
  return { rows, counts: Object.fromEntries(counts.map((c) => [c.status, c.n])) as Record<string, number> };
}

export async function retryJob(id: string, actor: Actor) {
  const db = await getDb();
  const [job] = await db
    .update(jobs)
    .set({ status: "queued", attempts: 0, runAfter: new Date(), lastError: null, finishedAt: null })
    .where(and(eq(jobs.id, id), eq(jobs.status, "failed")))
    .returning();
  if (job) await recordAudit({ actor, entityType: "job", entityId: id, action: "job.retried", after: { type: job.type } });
  return job ?? null;
}

export type SourceInput = Pick<Source, "name" | "slug" | "sourceType" | "sourceUrl" | "description" | "active" | "timezone" | "parserType" | "showRawText" | "isQa">;

export async function upsertSource(id: string | null, input: SourceInput, actor: Actor) {
  const db = await getDb();
  if (id) {
    const [before] = await db.select().from(sources).where(eq(sources.id, id));
    if (!before) throw new Error("Source not found");
    if ((before.sourceType === "telegram") !== (input.sourceType === "telegram")) {
      throw new Error("A Telegram channel's type can't be changed. Add other sources separately.");
    }
    await db.update(sources).set(input).where(eq(sources.id, id));
    await recordAudit({ actor, entityType: "source", entityId: id, action: "source.updated", before, after: input });
    return id;
  }
  if (input.sourceType === "telegram") throw new Error("Add Telegram channels from the Telegram page so they are linked to the channel.");
  const [row] = await db.insert(sources).values(input).returning({ id: sources.id });
  await recordAudit({ actor, entityType: "source", entityId: row.id, action: "source.created", after: input });
  return row.id;
}

export async function sourceEventCounts() {
  const db = await getDb();
  const rows = await db
    .select({ sourceId: rawEvents.sourceId, events: sql<number>`count(*)::int`, last: sql<Date | null>`max(${rawEvents.publishedAt})` })
    .from(rawEvents)
    .groupBy(rawEvents.sourceId);
  const sig = await db.select({ sourceId: signals.sourceId, n: sql<number>`count(*)::int` }).from(signals).groupBy(signals.sourceId);
  const sigMap = new Map(sig.map((s) => [s.sourceId, s.n]));
  return new Map(rows.map((r) => [r.sourceId, { events: r.events, last: r.last ? new Date(r.last) : null, signals: sigMap.get(r.sourceId) ?? 0 }]));
}
