import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/server/db";
import { runMigrations } from "@/server/db/migrate";
import { consolidatedIdeas, rawEvents, signals, sources } from "@/server/db/schema";
import { replaceConsolidatedIdeas } from "./service";

function ideaId(signalIds: string[]) {
  return createHash("sha256").update([...signalIds].sort().join(",")).digest("hex");
}

describe("replaceConsolidatedIdeas", () => {
  beforeAll(async () => {
    await runMigrations();
  }, 60_000);

  afterAll(async () => {
    await closeDb();
  });

  it("stores one idea for two nearby signals, then keeps only the remaining signal", async () => {
    const db = await getDb();
    const now = Date.now();
    const [firstSource] = await db
      .insert(sources)
      .values({ name: "Desk A", slug: "desk-a", sourceType: "manual", parserType: "text-generic" })
      .returning();
    const [secondSource] = await db
      .insert(sources)
      .values({ name: "Desk B", slug: "desk-b", sourceType: "manual", parserType: "text-generic" })
      .returning();
    const [firstEvent] = await db
      .insert(rawEvents)
      .values({
        sourceId: firstSource.id,
        rawText: "buy 2650",
        publishedAt: new Date(now - 20 * 60_000),
        contentHash: "idea-a",
      })
      .returning();
    const [secondEvent] = await db
      .insert(rawEvents)
      .values({
        sourceId: secondSource.id,
        rawText: "buy 2651",
        publishedAt: new Date(now - 10 * 60_000),
        contentHash: "idea-b",
      })
      .returning();
    const [firstSignal] = await db
      .insert(signals)
      .values({
        sourceId: firstSource.id,
        originEventId: firstEvent.id,
        direction: "LONG",
        entryType: "MARKET",
        entryMin: 2650,
        entryMax: 2650,
        signalTime: new Date(now - 20 * 60_000),
        parserConfidence: 1,
        status: "ACTIVE",
      })
      .returning();
    const [secondSignal] = await db
      .insert(signals)
      .values({
        sourceId: secondSource.id,
        originEventId: secondEvent.id,
        direction: "LONG",
        entryType: "MARKET",
        entryMin: 2651,
        entryMax: 2651,
        signalTime: new Date(now - 10 * 60_000),
        parserConfidence: 1,
        status: "ACTIVE",
      })
      .returning();

    expect(await replaceConsolidatedIdeas(now)).toBe(1);
    const [stored] = await db.select().from(consolidatedIdeas);
    expect(stored.signalIds).toEqual(expect.arrayContaining([firstSignal.id, secondSignal.id]));
    expect(stored.signalIds).toHaveLength(2);

    await db.update(signals).set({ status: "CANCELLED" }).where(eq(signals.id, secondSignal.id));
    expect(await replaceConsolidatedIdeas(now)).toBe(1);
    const rows = await db.select().from(consolidatedIdeas);
    expect(rows).toHaveLength(1);
    expect(rows[0].signalIds).toEqual([firstSignal.id]);
  });

  it("keeps the same id while an idea is open, then leaves it unchanged after it freezes", async () => {
    const db = await getDb();
    const newest = Date.now() - 10 * 60_000;
    const older = newest - 10 * 60_000;
    const [firstSource] = await db
      .insert(sources)
      .values({ name: "Desk C", slug: "desk-c", sourceType: "manual", parserType: "text-generic" })
      .returning();
    const [secondSource] = await db
      .insert(sources)
      .values({ name: "Desk D", slug: "desk-d", sourceType: "manual", parserType: "text-generic" })
      .returning();
    const [firstEvent] = await db
      .insert(rawEvents)
      .values({
        sourceId: firstSource.id,
        rawText: "buy 4100",
        publishedAt: new Date(older),
        contentHash: "idea-c",
      })
      .returning();
    const [secondEvent] = await db
      .insert(rawEvents)
      .values({
        sourceId: secondSource.id,
        rawText: "buy 4101",
        publishedAt: new Date(newest),
        contentHash: "idea-d",
      })
      .returning();
    const [firstSignal] = await db
      .insert(signals)
      .values({
        sourceId: firstSource.id,
        originEventId: firstEvent.id,
        direction: "LONG",
        entryType: "MARKET",
        entryMin: 4100,
        entryMax: 4100,
        signalTime: new Date(older),
        parserConfidence: 1,
        status: "ACTIVE",
      })
      .returning();
    const [secondSignal] = await db
      .insert(signals)
      .values({
        sourceId: secondSource.id,
        originEventId: secondEvent.id,
        direction: "LONG",
        entryType: "MARKET",
        entryMin: 4101,
        entryMax: 4101,
        signalTime: new Date(newest),
        parserConfidence: 1,
        status: "ACTIVE",
      })
      .returning();

    const openNow = newest + 10 * 60_000;
    const expectedId = ideaId([firstSignal.id, secondSignal.id]);
    await replaceConsolidatedIdeas(openNow);
    await replaceConsolidatedIdeas(openNow);
    const openRows = await db.select().from(consolidatedIdeas);
    const open = openRows.find((row) => row.signalIds.includes(firstSignal.id));
    expect(open?.id).toBe(expectedId);
    expect(open?.frozenAt).toBeNull();
    const entryMin = open?.entryMin;

    const freezeNow = newest + 30 * 60_000;
    await replaceConsolidatedIdeas(freezeNow);
    const frozenRows = await db.select().from(consolidatedIdeas);
    const frozen = frozenRows.find((row) => row.id === expectedId);
    expect(frozen?.frozenAt).not.toBeNull();
    expect(frozen?.frozenAt?.getTime()).toBe(newest + 30 * 60_000);

    await db.update(signals).set({ status: "CANCELLED" }).where(eq(signals.id, secondSignal.id));
    await replaceConsolidatedIdeas(freezeNow + 60 * 60_000);
    const laterRows = await db.select().from(consolidatedIdeas);
    const later = laterRows.find((row) => row.id === expectedId);
    expect(later?.signalIds).toEqual(expect.arrayContaining([firstSignal.id, secondSignal.id]));
    expect(later?.signalIds).toHaveLength(2);
    expect(later?.entryMin).toBe(entryMin);
    expect(laterRows.filter((row) => row.signalIds.includes(firstSignal.id))).toHaveLength(1);
  });
});
