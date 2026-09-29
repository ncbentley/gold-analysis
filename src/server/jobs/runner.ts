import { and, asc, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import { analyzeSignal, analyzeSourcePatterns } from "@/server/ai/service";
import { reconcileSubscriptions } from "@/server/billing/service";
import { getDb } from "@/server/db";
import { jobs, signalOutcomes, signals, type Job } from "@/server/db/schema";
import { ensureMarketDataCoverage, syncMarketData } from "@/server/market-data";
import { openSignalIds, recalculateOutcome } from "@/server/outcomes/service";
import { processRawEvent } from "@/server/normalization";
import { repairShortZones } from "@/server/parsing/repair-zones";
import { refreshSourceStats } from "@/server/statistics/service";
import { finishImportIfIdle } from "@/server/telegram/import-status";
import { syncAllTelegramSources, syncTelegramSource } from "@/server/telegram";
import { REVIEW_JOB_CONCURRENCY, REVIEW_JOB_TYPES } from "./limits";
import { enqueueJob, JOB_TYPES, type JobType } from "./queue";

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
  PROCESS_EVENT: async (p) => {
    const rawEventId = String(p.rawEventId ?? "");
    if (!rawEventId) return { skipped: true };
    const result = await processRawEvent(rawEventId);
    return { status: result.status };
  },
  MARKET_DATA_BACKFILL: async () => {
    const res = await ensureMarketDataCoverage();
    await enqueueJob("RECALC_ALL_SIGNALS", { onlyMissing: true }, { dedupeKey: "recalc-all-missing" });
    return res;
  },
  REPAIR_QUOTE_PARSES: async () => {
    const res = await repairShortZones();
    await enqueueJob("RECALC_ALL_SIGNALS", {}, { dedupeKey: "recalc-all-after-repair" });
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

let jobRunner: ((job: Job) => Promise<unknown>) | null = null;

/** Tests replace handlers with a fake that never calls DeepInfra or Telegram. */
export function useJobRunner(runner: ((job: Job) => Promise<unknown>) | null) {
  jobRunner = runner;
}

const reviewTypes = new Set<string>(REVIEW_JOB_TYPES);

function isReviewJob(type: string) {
  return reviewTypes.has(type);
}

export async function runJob(job: Job) {
  const db = await getDb();
  const handler = handlers[job.type as JobType];
  const runner = jobRunner;
  try {
    if (!runner && !handler) throw new Error(`No handler for job type ${job.type}`);
    const result = runner ? await runner(job) : await handler(job.payloadJson);
    await db
      .update(jobs)
      .set({ status: "succeeded", finishedAt: new Date(), lastError: null, payloadJson: { ...job.payloadJson, result: JSON.parse(JSON.stringify(result ?? null)) } })
      .where(eq(jobs.id, job.id));
    // Count remaining message jobs only after this one is no longer "running".
    if (!runner && job.type === "PROCESS_EVENT" && job.payloadJson.sourceId) await finishImportIfIdle(String(job.payloadJson.sourceId));
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

function typesForOpen(open: Array<"review" | "other">, types?: JobType[]): JobType[] | undefined {
  if (!types && open.length === 2) return undefined;
  const pool = types ?? [...JOB_TYPES];
  return pool.filter((type) => open.includes(isReviewJob(type) ? "review" : "other"));
}

/**
 * Claims queued jobs and runs them. Review jobs (message processing and AI) share a cap of
 * REVIEW_JOB_CONCURRENCY. Everything else, including Telegram sync, runs one at a time.
 * Concurrent callers share one drain loop.
 */
export function processJobs(limit = 500, types?: JobType[]): Promise<number> {
  if (draining) return draining;
  draining = (async () => {
    let n = 0;
    const running = { review: 0, other: 0 };
    const pending = new Set<Promise<void>>();
    const openClasses = () =>
      (["review", "other"] as const).filter((klass) => running[klass] < (klass === "review" ? REVIEW_JOB_CONCURRENCY : 1));
    try {
      while (n < limit) {
        const open = openClasses();
        if (open.length === 0) {
          if (pending.size === 0) break;
          await Promise.race(pending);
          continue;
        }
        const claimTypes = typesForOpen(open, types);
        if (claimTypes && claimTypes.length === 0) {
          if (pending.size === 0) break;
          await Promise.race(pending);
          continue;
        }
        const job = await claimNext(claimTypes);
        if (!job) {
          if (pending.size === 0) break;
          await Promise.race(pending);
          continue;
        }
        n += 1;
        const klass = isReviewJob(job.type) ? "review" : "other";
        running[klass] += 1;
        const task = runJob(job).finally(() => {
          running[klass] -= 1;
          pending.delete(task);
        });
        pending.add(task);
      }
      await Promise.all(pending);
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
