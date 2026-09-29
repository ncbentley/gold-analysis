import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/server/db";
import { runMigrations } from "@/server/db/migrate";
import { jobs, sources } from "@/server/db/schema";
import { listRawEvents } from "@/server/admin";
import { enqueueJob } from "@/server/jobs/queue";
import { REVIEW_JOB_CONCURRENCY } from "@/server/jobs/limits";
import { processJobs, useJobRunner } from "@/server/jobs/runner";
import { useQueueReviewClient, type QueueReview } from "@/server/parsing/queue-review";
import { addJoinedTelegramChat, useTelegramHistoryLoader } from "@/server/telegram";
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
    useQueueReviewClient({ async review() { return unknown(); } });

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

describe("review job concurrency", () => {
  it("keeps at most 200 review jobs in flight", async () => {
    const total = REVIEW_JOB_CONCURRENCY + 40;
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
      if (inFlight >= REVIEW_JOB_CONCURRENCY) reached();
      await hold;
      inFlight -= 1;
      return { ok: true };
    });

    const done = processJobs(total, ["PROCESS_EVENT"]);
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`review jobs peaked at ${max}, expected ${REVIEW_JOB_CONCURRENCY}`)), 20_000);
    });
    await Promise.race([saturated, timeout]);
    expect(inFlight).toBe(REVIEW_JOB_CONCURRENCY);
    expect(max).toBeLessThanOrEqual(REVIEW_JOB_CONCURRENCY);
    release();
    await done;
    expect(inFlight).toBe(0);

    const db = await getDb();
    const running = await db.select({ id: jobs.id }).from(jobs).where(eq(jobs.status, "running"));
    expect(running).toHaveLength(0);
  }, 30_000);
});
