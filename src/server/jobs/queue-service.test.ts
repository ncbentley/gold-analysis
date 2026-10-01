import { eq, inArray } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/server/db";
import { runMigrations } from "@/server/db/migrate";
import { jobs, sources } from "@/server/db/schema";
import { listRawEvents } from "@/server/admin";
import { enqueueJob } from "@/server/jobs/queue";
import { JOB_CONCURRENCY } from "@/server/jobs/limits";
import { processJobs, useJobRunner } from "@/server/jobs/runner";
import { useQueueReviewClient, type QueueReview } from "@/server/parsing/queue-review";
import { addJoinedTelegramChat, queueJoinedTelegramChats, useTelegramHistoryLoader } from "@/server/telegram";
import { describeSourceImport, messageQueueState } from "@/server/telegram/import-status";

process.env.JOBS_WORKER = "off";

function unknown(): QueueReview {
  return {
    decision: "unknown",
    confidence: 0,
    reason: "test",
    direction: null,
    entryType: null,
    entryMin: null,
    entryMax: null,
    stopLoss: null,
    targets: [],
  };
}

beforeAll(async () => {
  await runMigrations();
}, 60_000);

afterEach(() => {
  useJobRunner(null);
  useTelegramHistoryLoader(null);
  useQueueReviewClient(null);
});

afterAll(async () => {
  await closeDb();
});

describe("adding a telegram source", () => {
  it("enqueues its messages and the row moves queued, importing, then caught up", async () => {
    const created = await addJoinedTelegramChat(
      {
        chat: { id: "91001", accessHash: "1", username: "queuedesk", title: "Queue Desk", kind: "channel" },
        isQa: true,
        parserType: "text-generic",
        backfill: 2,
      },
      { userId: null, label: "test" },
    );
    expect(created.importStatus).toBe("queued");
    const db = await getDb();
    const [queuedRow] = await db.select().from(sources).where(eq(sources.id, created.sourceId));
    expect(describeSourceImport(queuedRow.importStatus)).toBe("queued");

    useTelegramHistoryLoader(async () => [
      { id: 11, text: "XAUUSD BUY 3350\nSL 3340\nTP 3360", date: new Date("2026-04-02T12:00:00Z") },
      { id: 12, text: "morning note, no trade", date: new Date("2026-04-02T12:01:00Z") },
    ]);
    useQueueReviewClient({ async review() { return { review: unknown(), sentToLarger: false, smallDeclined: true }; } });

    await enqueueJob("TELEGRAM_SYNC", { sourceId: created.sourceId, backfill: 2 }, { dedupeKey: `telegram-sync:${created.sourceId}` });
    await processJobs(10, ["TELEGRAM_SYNC"]);

    const [importing] = await db.select().from(sources).where(eq(sources.id, created.sourceId));
    expect(describeSourceImport(importing.importStatus)).toBe("importing");
    const waiting = await listRawEvents({ sourceId: created.sourceId, status: "queued" });
    expect(waiting.total).toBe(2);
    expect(waiting.rows.map((row) => messageQueueState(row.parse?.status))).toEqual(["queued", "queued"]);

    await processJobs(10, ["PROCESS_EVENT"]);
    const [done] = await db.select().from(sources).where(eq(sources.id, created.sourceId));
    expect(describeSourceImport(done.importStatus)).toBe("caught up");
    const stillQueued = await listRawEvents({ sourceId: created.sourceId, status: "queued" });
    expect(stillQueued.total).toBe(0);
  });

  it("marks the row failed when history cannot be fetched", async () => {
    const created = await addJoinedTelegramChat(
      {
        chat: { id: "91002", accessHash: "2", username: null, title: "Fail Desk", kind: "channel" },
        isQa: true,
        parserType: "text-generic",
        backfill: 1,
      },
      { userId: null, label: "test" },
    );
    useTelegramHistoryLoader(async () => {
      throw new Error("telegram down");
    });
    await enqueueJob("TELEGRAM_SYNC", { sourceId: created.sourceId, backfill: 1 });
    await processJobs(5, ["TELEGRAM_SYNC"]);
    const db = await getDb();
    const [row] = await db.select().from(sources).where(eq(sources.id, created.sourceId));
    expect(describeSourceImport(row.importStatus)).toBe("failed");
  });
});

describe("queueing several telegram sources", () => {
  it("queues two channels while another import is still running and does not fetch history", async () => {
    const actor = { userId: null, label: "test" };
    const opts = { isQa: true, parserType: "text-generic", backfill: 5 };
    const first = await queueJoinedTelegramChats(
      [{ id: "92001", accessHash: "1", username: null, title: "First Desk", kind: "channel" }],
      opts,
      actor,
    );
    const db = await getDb();
    await db.update(sources).set({ importStatus: "importing" }).where(eq(sources.id, first.queued[0].sourceId));
    let historyCalls = 0;
    useTelegramHistoryLoader(async () => {
      historyCalls += 1;
      return [];
    });

    const added = await queueJoinedTelegramChats(
      [
        { id: "92001", accessHash: "1", username: null, title: "First Desk", kind: "channel" },
        { id: "92002", accessHash: "2", username: null, title: "Second Desk", kind: "channel" },
        { id: "92003", accessHash: "3", username: null, title: "Third Desk", kind: "group" },
      ],
      opts,
      actor,
    );

    expect(historyCalls).toBe(0);
    expect(added.alreadyTracked).toEqual(["First Desk"]);
    expect(added.queued.map((chat) => chat.title)).toEqual(["Second Desk", "Third Desk"]);
    expect(added.queued.every((chat) => chat.importStatus === "queued")).toBe(true);
    const [stillImporting] = await db.select().from(sources).where(eq(sources.id, first.queued[0].sourceId));
    expect(stillImporting.importStatus).toBe("importing");
    const rows = await db.select().from(sources).where(inArray(sources.telegramChannelId, ["92002", "92003"]));
    expect(rows.map((row) => row.importStatus).sort()).toEqual(["queued", "queued"]);
    const syncs = await db.select().from(jobs).where(eq(jobs.type, "TELEGRAM_SYNC"));
    const queuedIds = new Set(added.queued.map((chat) => chat.sourceId));
    const waiting = syncs.filter((job) => job.status === "queued" && queuedIds.has(String(job.payloadJson.sourceId)));
    expect(waiting).toHaveLength(2);
    const createdIds = [first.queued[0].sourceId, ...added.queued.map((chat) => chat.sourceId)];
    await db.delete(jobs).where(inArray(jobs.dedupeKey, createdIds.map((id) => `telegram-sync:${id}`)));
  });
});

describe("per-type workers", () => {
  it("keeps PROCESS_EVENT inside its own concurrency cap", async () => {
    const cap = JOB_CONCURRENCY.PROCESS_EVENT;
    const total = cap + 40;
    for (let i = 0; i < total; i++) {
      await enqueueJob("PROCESS_EVENT", { n: i });
    }
    let inFlight = 0;
    let max = 0;
    let release!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    let reached!: () => void;
    const saturated = new Promise<void>((resolve) => {
      reached = resolve;
    });
    useJobRunner(async (job) => {
      if (job.type !== "PROCESS_EVENT") return null;
      inFlight += 1;
      max = Math.max(max, inFlight);
      if (inFlight >= cap) reached();
      await hold;
      inFlight -= 1;
      return { ok: true };
    });

    const done = processJobs(total, ["PROCESS_EVENT"]);
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`PROCESS_EVENT peaked at ${max}, expected ${cap}`)), 20_000);
    });
    await Promise.race([saturated, timeout]);
    expect(inFlight).toBe(cap);
    expect(max).toBeLessThanOrEqual(cap);
    release();
    await done;
    expect(inFlight).toBe(0);

    const db = await getDb();
    const running = await db.select({ id: jobs.id }).from(jobs).where(eq(jobs.status, "running"));
    expect(running).toHaveLength(0);
  }, 30_000);

  it("runs a live message while telegram sync and AI analysis are still in flight", async () => {
    let release!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const syncId = await enqueueJob("TELEGRAM_SYNC", { hold: true });
    const aiId = await enqueueJob("AI_ANALYZE_SIGNAL", { hold: true });
    const eventId = await enqueueJob("PROCESS_EVENT", { live: true, hold: true });
    useJobRunner(async (job) => {
      if (job.id === syncId || job.id === aiId) await hold;
      return { ok: true };
    });

    const done = processJobs(50);
    const db = await getDb();
    const deadline = Date.now() + 10_000;
    let status = "";
    while (Date.now() < deadline) {
      const [row] = await db.select({ status: jobs.status }).from(jobs).where(eq(jobs.id, eventId));
      status = row.status;
      if (status === "succeeded") break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(status).toBe("succeeded");
    const [sync] = await db.select({ status: jobs.status }).from(jobs).where(eq(jobs.id, syncId));
    const [ai] = await db.select({ status: jobs.status }).from(jobs).where(eq(jobs.id, aiId));
    expect(sync.status).toBe("running");
    expect(ai.status).toBe("running");
    release();
    await done;
  }, 15_000);

  it("claims a live PROCESS_EVENT before an older history import", async () => {
    await enqueueJob("PROCESS_EVENT", { tag: "priority", id: "old" });
    await enqueueJob("PROCESS_EVENT", { tag: "priority", id: "live", live: true });
    const seen: string[] = [];
    useJobRunner(async (job) => {
      if (job.payloadJson.tag === "priority") seen.push(String(job.payloadJson.id));
      return { ok: true };
    });
    await processJobs(50, ["PROCESS_EVENT"]);
    expect(seen.slice(0, 2)).toEqual(["live", "old"]);
  });
});
