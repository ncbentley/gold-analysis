/**
 * The model sits in front of the human queue. These tests use a fake client
 * because the environment has no OPENAI_API_KEY.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb, closeDb } from "@/server/db";
import { runMigrations } from "@/server/db/migrate";
import { auditLogs, parseResults, signalTargets, signals, sources } from "@/server/db/schema";
import { ingestRawEvent } from "@/server/ingestion";
import { useQueueReviewClient, type QueueReview, type QueueReviewInput } from "./queue-review";

const T = new Date("2026-04-02T12:00:00Z");
const FIRST = "XAUUSD BUY 3350\nSL 3340\nTP 3360";
const SIMILAR = "XAUUSD BUY 3360\nSL 3350\nTP 3370";
let sourceId = "";
const calls: string[] = [];

function answer(patch: Partial<QueueReview>): QueueReview {
  return {
    decision: "unknown",
    confidence: 0,
    reason: "unspecified",
    direction: null,
    entryType: null,
    entryMin: null,
    entryMax: null,
    stopLoss: null,
    targets: [],
    ...patch,
  };
}

beforeAll(async () => {
  await runMigrations();
  const db = await getDb();
  const [source] = await db
    .insert(sources)
    .values({ name: "LLM Desk", slug: "llm-desk", sourceType: "webhook", parserType: "text-generic" })
    .returning();
  sourceId = source.id;
  useQueueReviewClient({
    async review(input: QueueReviewInput) {
      calls.push(input.rawText);
      if (input.rawText === SIMILAR) throw new Error("model called for a post the learned pattern should handle");
      if (input.rawText === FIRST) {
        return answer({
          decision: "apply",
          confidence: 0.93,
          reason: "Limit entry with a stop and a target.",
          direction: "LONG",
          entryType: "LIMIT",
        });
      }
      if (input.rawText.includes("tp 3410")) return answer({ decision: "apply", confidence: 0.42, reason: "Stop is missing." });
      if (input.rawText.includes("confirm")) return answer({ decision: "unknown", confidence: 0.99, reason: "Cannot tell." });
      throw new Error(`unexpected model call: ${input.rawText}`);
    },
  });
});

afterAll(async () => {
  useQueueReviewClient(null);
  await closeDb();
});

describe("model review in front of the human queue", () => {
  it("learns a confident decision and handles the next similar post without a model call", async () => {
    const db = await getDb();
    const first = await ingestRawEvent(sourceId, { externalMessageId: "llm-1", rawText: FIRST, publishedAt: T });
    expect(first.status).toBe("stored");
    if (first.status !== "stored") return;
    const [parsed] = await db.select().from(parseResults).where(eq(parseResults.rawEventId, first.rawEventId));
    expect(parsed.status).toBe("applied");
    expect(parsed.status).not.toBe("needs_review");
    const [signal] = await db.select().from(signals).where(eq(signals.originEventId, first.rawEventId));
    expect(signal).toMatchObject({ direction: "LONG", entryType: "LIMIT", entryMin: 3350, stopLoss: 3340 });

    const [lesson] = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.entityId, first.rawEventId));
    expect(lesson.action).toBe("parse.learned");
    const learned = lesson.afterJson as {
      decision: string;
      learned: { pattern: string; roles: string[]; direction: string; entryType: string };
    };
    expect(learned.decision).toBe("accept");
    expect(learned.learned).toEqual({
      pattern: "xauusd buy {p} sl {p} tp {p}",
      roles: ["entry", "stop", "target"],
      direction: "LONG",
      entryType: "LIMIT",
    });

    const before = calls.length;
    const second = await ingestRawEvent(sourceId, {
      externalMessageId: "llm-2",
      rawText: SIMILAR,
      publishedAt: new Date(T.getTime() + 60_000),
    });
    expect(second.status).toBe("stored");
    if (second.status !== "stored") return;
    expect(calls.length).toBe(before);
    const [again] = await db.select().from(parseResults).where(eq(parseResults.rawEventId, second.rawEventId));
    expect(again.status).toBe("applied");
    expect(again.issues).toContain("Applied from a learned pattern.");
    const [similar] = await db.select().from(signals).where(eq(signals.originEventId, second.rawEventId));
    expect(similar).toMatchObject({ direction: "LONG", entryType: "LIMIT", entryMin: 3360, entryMax: 3360, stopLoss: 3350 });
    const targets = await db.select().from(signalTargets).where(eq(signalTargets.signalId, similar.id));
    expect(targets.map((target) => target.price)).toEqual([3370]);
  });

  it("leaves a low-confidence or unknown model result in the human queue", async () => {
    const db = await getDb();
    const low = await ingestRawEvent(sourceId, {
      externalMessageId: "llm-low",
      rawText: "Gold buy 3400 tp 3410",
      publishedAt: new Date(T.getTime() + 120_000),
    });
    const unknown = await ingestRawEvent(sourceId, {
      externalMessageId: "llm-unknown",
      rawText: "Gold buy 3600 tp 3610 confirm",
      publishedAt: new Date(T.getTime() + 180_000),
    });
    expect(low.status).toBe("stored");
    expect(unknown.status).toBe("stored");
    if (low.status !== "stored" || unknown.status !== "stored") return;

    const [lowParse] = await db.select().from(parseResults).where(eq(parseResults.rawEventId, low.rawEventId));
    const [unknownParse] = await db.select().from(parseResults).where(eq(parseResults.rawEventId, unknown.rawEventId));
    expect(lowParse.status).toBe("needs_review");
    expect(unknownParse.status).toBe("needs_review");
    expect(await db.select().from(signals).where(eq(signals.originEventId, low.rawEventId))).toHaveLength(0);
    expect(await db.select().from(signals).where(eq(signals.originEventId, unknown.rawEventId))).toHaveLength(0);
    const lessons = await db.select().from(auditLogs).where(eq(auditLogs.action, "parse.learned"));
    expect(lessons.some((row) => row.entityId === low.rawEventId || row.entityId === unknown.rawEventId)).toBe(false);
  });
});
