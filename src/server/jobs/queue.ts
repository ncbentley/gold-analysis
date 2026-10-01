import { and, eq } from "drizzle-orm";
import { getDb } from "@/server/db";
import { jobs } from "@/server/db/schema";

export const JOB_TYPES = [
  "MARKET_DATA_SYNC",
  "RECALC_OUTCOME",
  "RECALC_OPEN_SIGNALS",
  "REFRESH_SOURCE_STATS",
  "AI_ANALYZE_SIGNAL",
  "AI_ANALYZE_SOURCE",
  "TELEGRAM_SYNC",
  "PROCESS_EVENT",
  "MARKET_DATA_BACKFILL",
  "RECALC_ALL_SIGNALS",
  "REPAIR_QUOTE_PARSES",
  "RECONCILE_SUBSCRIPTIONS",
] as const;
export type JobType = (typeof JOB_TYPES)[number];

type EnqueuedListener = (type: JobType) => void;
let enqueuedListener: EnqueuedListener | null = null;

/** The worker registers this so a new row wakes that type's lane immediately. */
export function setJobEnqueuedListener(listener: EnqueuedListener | null) {
  enqueuedListener = listener;
}

/**
 * Enqueues a durable job. When dedupeKey is given and an identical job is already queued,
 * no new job is created, which keeps repeated triggers idempotent.
 */
export async function enqueueJob(
  type: JobType,
  payload: Record<string, unknown> = {},
  opts: { dedupeKey?: string; runAfter?: Date; maxAttempts?: number } = {},
) {
  const db = await getDb();
  if (opts.dedupeKey) {
    const [existing] = await db
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(eq(jobs.dedupeKey, opts.dedupeKey), eq(jobs.status, "queued")))
      .limit(1);
    if (existing) {
      enqueuedListener?.(type);
      return existing.id;
    }
  }
  const [row] = await db
    .insert(jobs)
    .values({
      type,
      payloadJson: payload,
      dedupeKey: opts.dedupeKey ?? null,
      runAfter: opts.runAfter ?? new Date(),
      maxAttempts: opts.maxAttempts ?? 3,
    })
    .returning({ id: jobs.id });
  enqueuedListener?.(type);
  return row.id;
}
