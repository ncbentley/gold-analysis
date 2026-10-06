import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/server/db";
import { runMigrations } from "@/server/db/migrate";
import { consolidatedIdeas, rawEvents, signals, sources } from "@/server/db/schema";
import { buildAccess } from "@/server/entitlements/access";
import { DEFAULT_TIER_CONFIG } from "@/server/entitlements/config";
import { rebuildConsolidatedIdeas, replaceConsolidatedIdeas, listIdeasForViewer } from "./service";

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

  it("keeps a replaced post on the frozen idea instead of freezing it alone", async () => {
    const db = await getDb();
    const t0 = Date.now() - 2 * 60 * 60_000;
    const [sourceA] = await db
      .insert(sources)
      .values({ name: "Desk E", slug: "desk-e", sourceType: "manual", parserType: "text-generic" })
      .returning();
    const [sourceB] = await db
      .insert(sources)
      .values({ name: "Desk F", slug: "desk-f", sourceType: "manual", parserType: "text-generic" })
      .returning();
    const [firstEvent] = await db
      .insert(rawEvents)
      .values({
        sourceId: sourceA.id,
        rawText: "buy 4800",
        publishedAt: new Date(t0),
        contentHash: "idea-e1",
      })
      .returning();
    const [otherEvent] = await db
      .insert(rawEvents)
      .values({
        sourceId: sourceB.id,
        rawText: "buy 4801",
        publishedAt: new Date(t0 + 5 * 60_000),
        contentHash: "idea-f",
      })
      .returning();
    const [secondEvent] = await db
      .insert(rawEvents)
      .values({
        sourceId: sourceA.id,
        rawText: "buy 4800.5",
        publishedAt: new Date(t0 + 10 * 60_000),
        contentHash: "idea-e2",
      })
      .returning();
    const [firstPost] = await db
      .insert(signals)
      .values({
        sourceId: sourceA.id,
        originEventId: firstEvent.id,
        direction: "LONG",
        entryType: "MARKET",
        entryMin: 4800,
        entryMax: 4800,
        signalTime: new Date(t0),
        parserConfidence: 1,
        status: "ACTIVE",
      })
      .returning();
    const [otherPost] = await db
      .insert(signals)
      .values({
        sourceId: sourceB.id,
        originEventId: otherEvent.id,
        direction: "LONG",
        entryType: "MARKET",
        entryMin: 4801,
        entryMax: 4801,
        signalTime: new Date(t0 + 5 * 60_000),
        parserConfidence: 1,
        status: "ACTIVE",
      })
      .returning();
    const [secondPost] = await db
      .insert(signals)
      .values({
        sourceId: sourceA.id,
        originEventId: secondEvent.id,
        direction: "LONG",
        entryType: "MARKET",
        entryMin: 4800.5,
        entryMax: 4800.5,
        signalTime: new Date(t0 + 10 * 60_000),
        parserConfidence: 1,
        status: "ACTIVE",
      })
      .returning();

    const counting = [secondPost.id, otherPost.id];
    await replaceConsolidatedIdeas(t0 + 45 * 60_000);
    const stored = (await db.select().from(consolidatedIdeas)).filter((row) =>
      counting.some((id) => row.signalIds.includes(id)) || row.replacedSignalIds.includes(firstPost.id),
    );
    expect(stored).toHaveLength(1);
    expect(stored[0].signalIds).toEqual(expect.arrayContaining(counting));
    expect(stored[0].signalIds).toHaveLength(2);
    expect(stored[0].replacedSignalIds).toEqual([firstPost.id]);

    await replaceConsolidatedIdeas(t0 + 46 * 60_000);
    const later = (await db.select().from(consolidatedIdeas)).filter((row) =>
      counting.some((id) => row.signalIds.includes(id)) || row.signalIds.includes(firstPost.id) || row.replacedSignalIds.includes(firstPost.id),
    );
    expect(later).toHaveLength(1);
    expect(later[0].id).toBe(stored[0].id);
    expect(later[0].signalIds).toEqual(expect.arrayContaining(counting));
    expect(later[0].signalIds).toHaveLength(2);
    expect(later[0].replacedSignalIds).toEqual([firstPost.id]);
    expect(later.some((row) => row.signalIds.length === 1 && row.signalIds[0] === firstPost.id)).toBe(false);
  });

  it("replays history older than the live window into one frozen idea", async () => {
    const db = await getDb();
    const t0 = Date.now() - 20 * 24 * 60 * 60_000;
    const [sourceA] = await db
      .insert(sources)
      .values({ name: "Desk G", slug: "desk-g", sourceType: "manual", parserType: "text-generic" })
      .returning();
    const [sourceB] = await db
      .insert(sources)
      .values({ name: "Desk H", slug: "desk-h", sourceType: "manual", parserType: "text-generic" })
      .returning();
    const [firstEvent] = await db
      .insert(rawEvents)
      .values({ sourceId: sourceA.id, rawText: "buy 5100", publishedAt: new Date(t0), contentHash: "idea-g" })
      .returning();
    const [secondEvent] = await db
      .insert(rawEvents)
      .values({ sourceId: sourceB.id, rawText: "buy 5101", publishedAt: new Date(t0 + 10 * 60_000), contentHash: "idea-h" })
      .returning();
    const [firstSignal] = await db
      .insert(signals)
      .values({
        sourceId: sourceA.id,
        originEventId: firstEvent.id,
        direction: "LONG",
        entryType: "MARKET",
        entryMin: 5100,
        entryMax: 5100,
        signalTime: new Date(t0),
        parserConfidence: 1,
        status: "ACTIVE",
      })
      .returning();
    const [secondSignal] = await db
      .insert(signals)
      .values({
        sourceId: sourceB.id,
        originEventId: secondEvent.id,
        direction: "LONG",
        entryType: "MARKET",
        entryMin: 5101,
        entryMax: 5101,
        signalTime: new Date(t0 + 10 * 60_000),
        parserConfidence: 1,
        status: "ACTIVE",
      })
      .returning();

    expect(await replaceConsolidatedIdeas(Date.now())).toBeGreaterThanOrEqual(0);
    const missed = (await db.select().from(consolidatedIdeas)).filter((row) => row.signalIds.includes(firstSignal.id));
    expect(missed).toHaveLength(0);

    await rebuildConsolidatedIdeas(Date.now());
    const rebuilt = (await db.select().from(consolidatedIdeas)).filter((row) =>
      row.signalIds.includes(firstSignal.id) || row.signalIds.includes(secondSignal.id),
    );
    expect(rebuilt).toHaveLength(1);
    expect(rebuilt[0].signalIds).toEqual(expect.arrayContaining([firstSignal.id, secondSignal.id]));
    expect(rebuilt[0].frozenAt).not.toBeNull();

    await replaceConsolidatedIdeas(Date.now());
    const kept = (await db.select().from(consolidatedIdeas)).filter((row) =>
      row.signalIds.includes(firstSignal.id) || row.signalIds.includes(secondSignal.id),
    );
    expect(kept).toHaveLength(1);
    expect(kept[0].id).toBe(rebuilt[0].id);
  });

  it("shows an idea on the consolidated view only when three sources agreed", async () => {
    const db = await getDb();
    const now = new Date();
    await db.insert(consolidatedIdeas).values([
      {
        direction: "LONG",
        entryMin: 1111,
        entryMax: 1111,
        stopLoss: null,
        targets: [],
        exitSpreadStops: null,
        exitSpreadTargets: [],
        sourceCount: 2,
        signalIds: [],
        replacedSignalIds: [],
        newestSignalAt: now,
        phase: "available",
      },
      {
        direction: "SHORT",
        entryMin: 2222,
        entryMax: 2222,
        stopLoss: null,
        targets: [],
        exitSpreadStops: null,
        exitSpreadTargets: [],
        sourceCount: 3,
        signalIds: [],
        replacedSignalIds: [],
        newestSignalAt: now,
        phase: "playing-out",
      },
    ]);
    const viewer = {
      user: null,
      access: buildAccess("silver", DEFAULT_TIER_CONFIG),
      config: DEFAULT_TIER_CONFIG,
      subscription: null,
      complimentary: null,
      viewAs: null,
    };
    const listed = await listIdeasForViewer(viewer, null);
    expect(listed.some((idea) => idea.entryMin === 1111)).toBe(false);
    expect(listed.find((idea) => idea.entryMin === 2222)?.phase).toBe("playing-out");
  });
});
