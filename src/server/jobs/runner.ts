import { and, asc, eq, isNull, lte, sql } from "drizzle-orm";
import { PIPELINE } from "@/server/audit";
import { analyzeSignal, analyzeSourcePatterns } from "@/server/ai/service";
import { refreshMarketDirection } from "@/server/direction/service";
import { reconcileSubscriptions } from "@/server/billing/service";
import { getDb } from "@/server/db";
import { jobs, signalOutcomes, signals, type Job } from "@/server/db/schema";
import { ensureMarketDataCoverage, syncMarketData } from "@/server/market-data";
import { openSignalIds, recalculateOutcome } from "@/server/outcomes/service";
import { processRawEvent } from "@/server/normalization";
import { repairShortZones } from "@/server/parsing/repair-zones";
import { refreshBoard } from "@/server/board/service";
import { relabelFeed } from "@/server/feed/relabel";
import { syncDashboardCache } from "@/server/feed/snapshot";
import { replaceConsolidatedIdeas } from "@/server/ideas/service";
import { refreshSourceStats } from "@/server/statistics/service";
import { finishImportIfIdle } from "@/server/telegram/import-status";
import { enqueueDueTelegramSyncs } from "@/server/telegram/schedule";
import { syncTelegramSource } from "@/server/telegram";
import { JOB_CONCURRENCY } from "./limits";
import { enqueueJob, JOB_TYPES, type JobType } from "./queue";

type Handler = (payload: Record<string, unknown>) => Promise<unknown>;

const handlers: Record<JobType, Handler> = {
  MARKET_DATA_SYNC: async () => {
    const res = await syncMarketData();
    if (res.inserted > 0) {
      await enqueueJob("RECALC_OPEN_SIGNALS", {}, { dedupeKey: "recalc-open" });
      await enqueueJob("RELABEL_FEED", {}, { dedupeKey: "relabel-feed" });
    }
    return res;
  },
  RECALC_OUTCOME: async (p) => {
    const result = await recalculateOutcome(String(p.signalId), { force: Boolean(p.force) });
    await enqueueJob("RELABEL_FEED", { cacheOnly: true }, { dedupeKey: "dashboard-cache" });
    return result;
  },
  RECALC_OPEN_SIGNALS: async () => {
    const ids = await openSignalIds();
    for (const id of ids) await recalculateOutcome(id);
    await enqueueJob("RELABEL_FEED", { cacheOnly: true }, { dedupeKey: "dashboard-cache" });
    return { recalculated: ids.length };
  },
  REFRESH_SOURCE_STATS: async (p) => {
    const stats = await refreshSourceStats(String(p.sourceId));
    await enqueueJob("AI_ANALYZE_SOURCE", { sourceId: p.sourceId }, { dedupeKey: `ai-source:${p.sourceId}` });
    await enqueueJob("RELABEL_FEED", { cacheOnly: true }, { dedupeKey: "dashboard-cache" });
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
  MARKET_DIRECTION: async () => {
    const result = await refreshMarketDirection();
    if ("id" in result) await enqueueJob("RELABEL_FEED", { cacheOnly: true }, { dedupeKey: "dashboard-cache" });
    return result;
  },
  TELEGRAM_SYNC: async (p) => {
    // Jobs with no channel are the old full sweep. They stacked because each
    // one ran longer than the timer. Per-channel catch-up is queued by
    // enqueueDueTelegramSyncs; running one of these only retires the row.
    if (!p.sourceId) return { skipped: "per-channel" };
    return syncTelegramSource(String(p.sourceId), { backfill: Number(p.backfill ?? 0) });
  },
  PROCESS_EVENT: async (p) => {
    const rawEventId = String(p.rawEventId ?? "");
    if (!rawEventId) return { skipped: true };
    const result = await processRawEvent(rawEventId, PIPELINE, { live: p.live === true });
    if (result.status === "applied" || result.status === "resolved") {
      await enqueueJob("CONSOLIDATE_SIGNALS", {}, { dedupeKey: "consolidate-signals" });
      await enqueueJob("RELABEL_FEED", { cacheOnly: true }, { dedupeKey: "dashboard-cache" });
    }
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
    await enqueueJob("RELABEL_FEED", { cacheOnly: true }, { dedupeKey: "dashboard-cache" });
    return { recalculated: rows.length };
  },
  RECONCILE_SUBSCRIPTIONS: async () => reconcileSubscriptions(),
  CONSOLIDATE_SIGNALS: async () => {
    const count = await replaceConsolidatedIdeas();
    await enqueueJob("REFRESH_BOARD", {}, { dedupeKey: "refresh-board" });
    await enqueueJob("RELABEL_FEED", { cacheOnly: true }, { dedupeKey: "dashboard-cache" });
    return { ideas: count };
  },
  REFRESH_BOARD: async (payload) => {
    const result = await refreshBoard({ fullHistory: payload.fullHistory === true });
    if (result.action === "failed") console.error("[board]", result.error);
    await enqueueJob("RELABEL_FEED", { cacheOnly: true }, { dedupeKey: "dashboard-cache" });
    return result;
  },
  RELABEL_FEED: async (payload) => {
    const labels = payload.cacheOnly === true ? null : await relabelFeed();
    const wrote = await syncDashboardCache();
    return { labels, wrote };
  },
};

async function claimNext(type: JobType): Promise<Job | null> {
  const db = await getDb();
  // Live posts carry payload.live. Sort that first: run_after is the enqueue
  // time, so a history row queued a few milliseconds earlier would otherwise win.
  const liveFirst = type === "PROCESS_EVENT" || type === "AI_ANALYZE_SIGNAL";
  const order = liveFirst
    ? [sql`case when ${jobs.payloadJson}->>'live' = 'true' then 0 else 1 end`, asc(jobs.runAfter), asc(jobs.createdAt)]
    : [asc(jobs.runAfter), asc(jobs.createdAt)];
  return db.transaction(async (tx) => {
    const [next] = await tx
      .select()
      .from(jobs)
      .where(and(eq(jobs.status, "queued"), eq(jobs.type, type), lte(jobs.runAfter, new Date())))
      .orderBy(...order)
      .limit(1)
      .for("update", { skipLocked: true });
    if (!next) return null;
    const [claimed] = await tx
      .update(jobs)
      .set({ status: "running", startedAt: new Date(), attempts: sql`${jobs.attempts} + 1` })
      .where(eq(jobs.id, next.id))
      .returning();
    return claimed ?? null;
  });
}

let jobRunner: ((job: Job) => Promise<unknown>) | null = null;

/** Tests replace handlers with a fake that never calls DeepInfra or Telegram. */
export function useJobRunner(runner: ((job: Job) => Promise<unknown>) | null) {
  jobRunner = runner;
}

export async function runJob(job: Job) {
  const db = await getDb();
  const handler = handlers[job.type as JobType];
  const runner = jobRunner;
  if (job.type === "PROCESS_EVENT") {
    const readyAt = Math.max(new Date(job.runAfter).getTime(), new Date(job.createdAt).getTime());
    const waitedMs = Date.now() - readyAt;
    if (waitedMs > 3_000) console.warn(`[jobs] PROCESS_EVENT ${job.id} waited ${Math.round(waitedMs / 1000)}s in queue`);
  }
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

const laneDrain = new Map<JobType, Promise<number>>();
const laneWake = new Set<JobType>();

async function drainLane(type: JobType, limit: number): Promise<number> {
  // This drain is the wake that started it. A flag set again means a row
  // arrived while we were claiming, and the loop below must look once more.
  laneWake.delete(type);
  const concurrency = JOB_CONCURRENCY[type];
  let n = 0;
  let running = 0;
  const pending = new Set<Promise<void>>();

  const claimMore = async () => {
    while (n < limit) {
      if (running >= concurrency) {
        await Promise.race(pending);
        continue;
      }
      const job = await claimNext(type);
      if (!job) {
        if (pending.size > 0) {
          await Promise.race(pending);
          continue;
        }
        if (laneWake.delete(type)) continue;
        return;
      }
      n += 1;
      running += 1;
      const task = runJob(job).finally(() => {
        running -= 1;
        pending.delete(task);
      });
      pending.add(task);
    }
  };

  await claimMore();
  await Promise.all(pending);
  while (laneWake.delete(type) && n < limit) {
    await claimMore();
    await Promise.all(pending);
  }
  return n;
}

function startLane(type: JobType, limit: number): Promise<number> {
  const existing = laneDrain.get(type);
  if (existing) return existing;
  const run = drainLane(type, limit).finally(() => {
    if (laneDrain.get(type) === run) laneDrain.delete(type);
    // A row inserted as this drain exited still needs a lane. The flag is set
    // before startLane, so a drain that already finished does not swallow it.
    if (laneWake.has(type) && !laneDrain.has(type)) {
      laneWake.delete(type);
      void startLane(type, limit).catch((err) => console.error(`[jobs] ${type} lane failed:`, (err as Error).message));
    }
  });
  laneDrain.set(type, run);
  return run;
}

/**
 * Claims queued jobs and runs them. Each type has its own lane and concurrency,
 * so a long Telegram sync or AI analysis cannot block PROCESS_EVENT.
 * A caller that arrives while that type's lane is already draining joins it.
 */
export function processJobs(limit = 500, types?: JobType[]): Promise<number> {
  const selected = types?.length ? types : [...JOB_TYPES];
  for (const type of selected) laneWake.add(type);
  return Promise.all(selected.map((type) => startLane(type, limit))).then((counts) => counts.reduce((sum, count) => sum + count, 0));
}

/** Jobs left in "running" by a crashed process are returned to the queue on startup. */
export async function requeueStaleJobs() {
  const db = await getDb();
  await db
    .update(jobs)
    .set({ status: "queued" })
    .where(and(eq(jobs.status, "running"), lte(jobs.startedAt, new Date(Date.now() - 10 * 60_000))));
}

export async function scheduleRecurring(kind: "minute" | "telegram" | "hourly" | "board") {
  if (kind === "minute") {
    await enqueueJob("MARKET_DATA_SYNC", {}, { dedupeKey: "market-sync" });
    await enqueueJob("CONSOLIDATE_SIGNALS", {}, { dedupeKey: "consolidate-signals" });
  }
  if (kind === "telegram") await enqueueDueTelegramSyncs();
  if (kind === "hourly") {
    await enqueueJob("RECONCILE_SUBSCRIPTIONS", {}, { dedupeKey: "reconcile" });
    await enqueueJob("MARKET_DIRECTION", {}, { dedupeKey: "market-direction" });
  }
  if (kind === "board") await enqueueJob("REFRESH_BOARD", {}, { dedupeKey: "refresh-board" });
}
