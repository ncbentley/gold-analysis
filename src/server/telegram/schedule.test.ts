import { eq, inArray } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/server/db";
import { runMigrations } from "@/server/db/migrate";
import { jobs, sources } from "@/server/db/schema";
import { enqueueJob } from "@/server/jobs/queue";
import { processJobs, scheduleRecurring } from "@/server/jobs/runner";
import { useTelegramHistoryLoader } from "@/server/telegram";
import { enqueueDueTelegramSyncs } from "./schedule";

process.env.JOBS_WORKER = "off";

beforeAll(async () => {
  await runMigrations();
}, 60_000);

afterEach(async () => {
  useTelegramHistoryLoader(null);
  const db = await getDb();
  await db.delete(jobs);
});

afterAll(async () => {
  await closeDb();
});

let n = 0;

async function addSource(patch: Partial<typeof sources.$inferInsert> = {}) {
  n += 1;
  const db = await getDb();
  const [row] = await db
    .insert(sources)
    .values({
      name: `Desk ${n}`,
      slug: `desk-${n}-${crypto.randomUUID().slice(0, 8)}`,
      sourceType: "telegram",
      parserType: "text-generic",
      telegramChannelId: String(800_000 + n),
      active: true,
      ...patch,
    })
    .returning();
  return row;
}

describe("telegram catch-up schedule", () => {
  it("does not enqueue when this process owns the socket and Telegram is disconnected", async () => {
    process.env.JOBS_WORKER = "on";
    try {
      await addSource({ lastSyncedAt: null });
      const result = await enqueueDueTelegramSyncs(5);
      expect(result).toEqual({ enqueued: 0, skipped: "not_connected" });
      const db = await getDb();
      const queued = await db.select({ id: jobs.id }).from(jobs).where(eq(jobs.type, "TELEGRAM_SYNC"));
      expect(queued).toHaveLength(0);
    } finally {
      process.env.JOBS_WORKER = "off";
    }
  });

  it("queues the stalest quiet channels, and will not stack another batch while those jobs are still waiting", async () => {
    const db = await getDb();
    await db.update(sources).set({ active: false });
    const never = await addSource({ lastSyncedAt: null });
    const failed = await addSource({ importStatus: "failed", lastSyncedAt: new Date(Date.now() - 3 * 60 * 60_000) });
    const oldest = await addSource({ lastSyncedAt: new Date(Date.now() - 2 * 60 * 60_000) });
    const stale = await addSource({ importStatus: "caught_up", lastSyncedAt: new Date(Date.now() - 30 * 60_000) });
    await addSource({ lastSyncedAt: new Date() });
    await addSource({ active: false, lastSyncedAt: null });
    await addSource({ importStatus: "importing", lastSyncedAt: null });
    await addSource({ importStatus: "queued", lastSyncedAt: null });
    await addSource({ active: false, removedAt: new Date(), lastSyncedAt: null });
    await addSource({ sourceType: "webhook", telegramChannelId: null, lastSyncedAt: null });

    const first = await enqueueDueTelegramSyncs(2);
    expect(first).toEqual({ enqueued: 2 });
    const queued = await db.select({ payloadJson: jobs.payloadJson }).from(jobs).where(eq(jobs.status, "queued"));
    expect(queued.map((row) => row.payloadJson.sourceId).sort()).toEqual([failed.id, never.id].sort());

    const second = await enqueueDueTelegramSyncs(2);
    expect(second).toEqual({ enqueued: 0 });

    await db.update(jobs).set({ status: "succeeded" }).where(eq(jobs.status, "queued"));
    await db.update(sources).set({ lastSyncedAt: new Date() }).where(inArray(sources.id, [never.id, failed.id]));
    const third = await enqueueDueTelegramSyncs(2);
    expect(third).toEqual({ enqueued: 2 });
    const next = await db.select({ payloadJson: jobs.payloadJson }).from(jobs).where(eq(jobs.status, "queued"));
    expect(next.map((row) => row.payloadJson.sourceId).sort()).toEqual([oldest.id, stale.id].sort());

    await scheduleRecurring("telegram");
    const afterTimer = await db.select({ id: jobs.id }).from(jobs).where(eq(jobs.status, "queued"));
    expect(afterTimer).toHaveLength(2);
    const sweep = await db.select({ id: jobs.id }).from(jobs).where(eq(jobs.dedupeKey, "telegram-sync"));
    expect(sweep).toHaveLength(0);

    await db.update(jobs).set({ status: "succeeded" }).where(eq(jobs.status, "queued"));
    const held = await addSource({ lastSyncedAt: new Date(Date.now() - 4 * 60 * 60_000) });
    await enqueueJob("TELEGRAM_SYNC", { sourceId: held.id }, { dedupeKey: `telegram-sync:${held.id}` });
    await db.update(jobs).set({ status: "running" }).where(eq(jobs.dedupeKey, `telegram-sync:${held.id}`));
    const capped = await enqueueDueTelegramSyncs(2);
    expect(capped).toEqual({ enqueued: 1 });
    const room = await db.select({ payloadJson: jobs.payloadJson }).from(jobs).where(eq(jobs.status, "queued"));
    expect(room.map((row) => row.payloadJson.sourceId)).toEqual([oldest.id]);
  });

  it("retires a full-sweep job without fetching channel history", async () => {
    await addSource({ lastSyncedAt: null });
    let calls = 0;
    useTelegramHistoryLoader(async () => {
      calls += 1;
      return [];
    });
    await enqueueJob("TELEGRAM_SYNC", {}, { dedupeKey: "telegram-sync" });
    await processJobs(5, ["TELEGRAM_SYNC"]);
    expect(calls).toBe(0);
    const db = await getDb();
    const [row] = await db.select().from(jobs).where(eq(jobs.dedupeKey, "telegram-sync"));
    expect(row.status).toBe("succeeded");
    expect(row.payloadJson.result).toEqual({ skipped: "per-channel" });
  });
});
