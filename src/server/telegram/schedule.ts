import { and, asc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { recordAudit, SYSTEM } from "@/server/audit";
import { getDb } from "@/server/db";
import { jobs, signals, sources } from "@/server/db/schema";
import { SIGNAL_SILENCE_MS, TELEGRAM_CATCHUP_STALE_MS, TELEGRAM_SYNC_BATCH } from "@/server/jobs/limits";
import { enqueueJob } from "@/server/jobs/queue";
import { canActOnTelegramHere, connectTelegram, leaveTelegramSource, stopTelegramSignalTracking } from "./index";

/**
 * Queues catch-up for the channels that have been quiet the longest.
 *
 * One job per channel, and never more than `limit` of those jobs queued or
 * running. The old sweep synced every channel inside a single job, and the
 * next sweep was inserted while that job was still running.
 */
export async function enqueueDueTelegramSyncs(limit = TELEGRAM_SYNC_BATCH) {
  if (process.env.JOBS_WORKER !== "off") {
    const client = await connectTelegram();
    if (!client) return { enqueued: 0, skipped: "not_connected" as const };
  }

  const db = await getDb();
  const [{ waiting }] = await db
    .select({ waiting: sql<number>`count(*)::int` })
    .from(jobs)
    .where(and(eq(jobs.type, "TELEGRAM_SYNC"), inArray(jobs.status, ["queued", "running"]), sql`${jobs.dedupeKey} like 'telegram-sync:%'`));
  const room = Math.max(0, limit - Number(waiting ?? 0));
  if (room === 0) return { enqueued: 0 };

  const dueBefore = new Date(Date.now() - TELEGRAM_CATCHUP_STALE_MS);
  const rows = await db
    .select({ id: sources.id })
    .from(sources)
    .where(
      and(
        eq(sources.sourceType, "telegram"),
        eq(sources.active, true),
        isNull(sources.removedAt),
        or(isNull(sources.importStatus), inArray(sources.importStatus, ["caught_up", "failed"])),
        or(isNull(sources.lastSyncedAt), lt(sources.lastSyncedAt, dueBefore)),
        sql`not exists (
          select 1 from ${jobs}
          where ${jobs.dedupeKey} = 'telegram-sync:' || ${sources.id}
            and ${jobs.status} in ('queued', 'running')
        )`,
      ),
    )
    .orderBy(sql`${sources.lastSyncedAt} asc nulls first`, asc(sources.id))
    .limit(room);

  for (const row of rows) {
    await enqueueJob("TELEGRAM_SYNC", { sourceId: row.id }, { dedupeKey: `telegram-sync:${row.id}` });
  }
  if (rows.length > 0) console.log(`[telegram] queued ${rows.length} channel catch-up${rows.length === 1 ? "" : "s"}`);
  return { enqueued: rows.length };
}

/**
 * Drops signal tracking on channels that have been silent for 15 days.
 * The account leaves first when the stored access can do it. A disconnect or
 * flood waits for the next pass so the chat is not abandoned half-done.
 * A starred source stays joined and keeps collecting headlines.
 */
export async function dropSilentTrackedChannels(now = Date.now()) {
  if (!canActOnTelegramHere()) return { dropped: 0, left: 0, skipped: "remote" as const };

  const db = await getDb();
  const cutoff = new Date(now - SIGNAL_SILENCE_MS);
  const silent = await db
    .select()
    .from(sources)
    .where(
      and(
        eq(sources.sourceType, "telegram"),
        eq(sources.active, true),
        eq(sources.parseSignals, true),
        isNull(sources.removedAt),
        lt(sources.createdAt, cutoff),
        sql`not exists (
          select 1 from ${signals}
          where ${signals.sourceId} = ${sources.id}
            and ${signals.signalTime} >= ${cutoff}
        )`,
      ),
    );

  let left = 0;
  let dropped = 0;
  for (const source of silent) {
    let departure: "left" | "impossible" | null = null;
    if (!source.starred) {
      const result = await leaveTelegramSource(source);
      if (result === "retry") continue;
      departure = result;
    }
    await recordAudit({
      actor: SYSTEM,
      entityType: "source",
      entityId: source.id,
      action: "telegram.tracking_expired",
      reason: "No signal for 15 days",
      after: { starred: source.starred, channel: source.telegramUsername ?? source.telegramChannelId },
    });
    await stopTelegramSignalTracking(source.id, SYSTEM);
    dropped += 1;
    if (!departure) continue;
    await recordAudit({
      actor: SYSTEM,
      entityType: "source",
      entityId: source.id,
      action: "telegram.channel_left",
      after: { result: departure, channel: source.telegramUsername ?? source.telegramChannelId },
    });
    if (departure === "left") left += 1;
  }
  if (dropped > 0) {
    console.log(`[telegram] stopped tracking ${dropped} silent channel${dropped === 1 ? "" : "s"}; left ${left}`);
  }
  return { dropped, left };
}
