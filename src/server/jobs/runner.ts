import { and, asc, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import { analyzeSignal, analyzeSourcePatterns } from "@/server/ai/service";
import { reconcileSubscriptions } from "@/server/billing/service";
import { getDb } from "@/server/db";
import { jobs, signalOutcomes, signals, type Job } from "@/server/db/schema";
import { ensureMarketDataCoverage, syncMarketData } from "@/server/market-data";
import { openSignalIds, recalculateOutcome } from "@/server/outcomes/service";
import { refreshSourceStats } from "@/server/statistics/service";
import { syncAllTelegramSources, syncTelegramSource } from "@/server/telegram";
import { enqueueJob, type JobType } from "./queue";

type Handler = (payload: Record<string, unknown>) => Promise<unknown>;

const handlers: Record<JobType, Handler> = {
  MARKET_DATA_SYNC: async () => {
    const res = await syncMarketData();
    if (res.inserted > 0) await enqueueJob("RECALC_OPEN_SIGNALS", {}, { dedupeKey: "recalc-open" });
    return res;
  },
  RECALC_OUTCOME: async (p) => recalculateOutcome(String(p.signalId), { force: Boolean(p.force) }),
  RECALC_OPEN_SIGNALS: async () => {
    const ids = await openSignalIds();
    for (const id of ids) await recalculateOutcome(id);
    return { recalculated: ids.length };
  },
  REFRESH_SOURCE_STATS: async (p) => {
    const stats = await refreshSourceStats(String(p.sourceId));
    await enqueueJob("AI_ANALYZE_SOURCE", { sourceId: p.sourceId }, { dedupeKey: `ai-source:${p.sourceId}` });
    return { closedTrades: stats.closedTrades };
  },
  AI_ANALYZE_SIGNAL: async (p) => {
    const r = await analyzeSignal(String(p.signalId), { promptVersion: p.promptVersion as string | undefined, force: Boolean(p.force) });
    return { skipped: r.skipped, analysisId: r.analysis.id };
  },
  AI_ANALYZE_SOURCE: async (p) => {
    const r = await analyzeSourcePatterns(String(p.sourceId), { force: Boolean(p.force) });
    return { skipped: r.skipped };
  },
  TELEGRAM_SYNC: async (p) =>
    p.sourceId ? syncTelegramSource(String(p.sourceId), { backfill: Number(p.backfill ?? 0) }) : syncAllTelegramSources(),
  MARKET_DATA_BACKFILL: async () => {
    const res = await ensureMarketDataCoverage();
    await enqueueJob("RECALC_ALL_SIGNALS", { onlyMissing: true }, { dedupeKey: "recalc-all-missing" });
    return res;
  },
  RECALC_ALL_SIGNALS: async (p) => {
    const db = await getDb();
    const rows = p.onlyMissing
      ? await db
          .select({ id: signals.id })
          .from(signals)
          .leftJoin(signalOutcomes, and(eq(signalOutcomes.signalId, signals.id), eq(signalOutcomes.isCurrent, true)))
          .where(isNull(signalOutcomes.id))
      : await db.select({ id: signals.id }).from(signals);
    for (const r of rows) await recalculateOutcome(r.id, { force: !p.onlyMissing });
    return { recalculated: rows.length };
  },
  RECONCILE_SUBSCRIPTIONS: async () => reconcileSubscriptions(),
};

async function claimNext(types?: JobType[]): Promise<Job | null> {
  const db = await getDb();
  const [next] = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.status, "queued"), lte(jobs.runAfter, new Date()), types ? inArray(jobs.type, types) : undefined))
    .orderBy(asc(jobs.runAfter), asc(jobs.createdAt))
    .limit(1);
  if (!next) return null;
  const claimed = await db
    .update(jobs)
    .set({ status: "running", startedAt: new Date(), attempts: sql`${jobs.attempts} + 1` })
    .where(and(eq(jobs.id, next.id), eq(jobs.status, "queued")))
    .returning();
  return claimed[0] ?? null;
}

export async function runJob(job: Job) {
  const db = await getDb();
  const handler = handlers[job.type as JobType];
  try {
    if (!handler) throw new Error(`No handler for job type ${job.type}`);
    const result = await handler(job.payloadJson);
    await db
      .update(jobs)
      .set({ status: "succeeded", finishedAt: new Date(), lastError: null, payloadJson: { ...job.payloadJson, result: JSON.parse(JSON.stringify(result ?? null)) } })
      .where(eq(jobs.id, job.id));
  } catch (err) {
    const message = (err as Error).stack ?? String(err);
    const retry = job.attempts < job.maxAttempts;
    await db
      .update(jobs)
      .set({
        status: retry ? "queued" : "failed",
        lastError: message.slice(0, 4000),
        finishedAt: retry ? null : new Date(),
        runAfter: new Date(Date.now() + 2 ** job.attempts * 5_000),
      })
      .where(eq(jobs.id, job.id));
    console.error(`[jobs] ${job.type} ${job.id} failed (attempt ${job.attempts}/${job.maxAttempts})`, (err as Error).message);
  }
}

let draining: Promise<number> | null = null;

/** Processes queued jobs sequentially. Concurrent callers share one drain loop. */
export function processJobs(limit = 500, types?: JobType[]): Promise<number> {
  if (draining) return draining;
  draining = (async () => {
    let n = 0;
    try {
      while (n < limit) {
        const job = await claimNext(types);
        if (!job) break;
        await runJob(job);
        n++;
      }
    } finally {
      draining = null;
    }
    return n;
  })();
  return draining;
}

/** Jobs left in "running" by a crashed process are returned to the queue on startup. */
export async function requeueStaleJobs() {
  const db = await getDb();
  await db
    .update(jobs)
    .set({ status: "queued" })
    .where(and(eq(jobs.status, "running"), lte(jobs.startedAt, new Date(Date.now() - 10 * 60_000))));
}

export async function scheduleRecurring(kind: "minute" | "telegram" | "hourly") {
  if (kind === "minute") await enqueueJob("MARKET_DATA_SYNC", {}, { dedupeKey: "market-sync" });
  if (kind === "telegram") await enqueueJob("TELEGRAM_SYNC", {}, { dedupeKey: "telegram-sync" });
  if (kind === "hourly") await enqueueJob("RECONCILE_SUBSCRIPTIONS", {}, { dedupeKey: "reconcile" });
}
