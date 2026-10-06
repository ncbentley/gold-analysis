import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/server/db";
import { runMigrations } from "@/server/db/migrate";
import { boardPosts, consolidatedIdeas, goldBookEntries, rawEvents, signals, sources } from "@/server/db/schema";
import { closeRetiredGold, collapseDuplicateGold, reconcileGoldBook, syncGoldBook } from "./from-board";
import { listGoldEntries } from "./store";

describe("syncGoldBook", () => {
  beforeAll(async () => {
    await runMigrations();
  }, 60_000);

  afterAll(async () => {
    await closeDb();
  });

  it("closes a gold call whose sources expired, and stores a zone the model composed", async () => {
    const db = await getDb();
    const now = Date.now();
    const [source] = await db
      .insert(sources)
      .values({ name: "Expired desk", slug: `expired-desk-${now}`, sourceType: "manual", parserType: "text-generic" })
      .returning();
    const [liveSource] = await db
      .insert(sources)
      .values({ name: "Live desk", slug: `live-desk-${now}`, sourceType: "manual", parserType: "text-generic" })
      .returning();
    const [expiredEvent] = await db
      .insert(rawEvents)
      .values({ sourceId: source.id, rawText: "buy 4105", publishedAt: new Date(now - 20 * 60 * 60_000), contentHash: `expired-${now}` })
      .returning();
    const [liveEvent] = await db
      .insert(rawEvents)
      .values({ sourceId: liveSource.id, rawText: "buy 4200", publishedAt: new Date(now - 60_000), contentHash: `live-${now}` })
      .returning();
    const [expiredSignal] = await db
      .insert(signals)
      .values({
        sourceId: source.id,
        originEventId: expiredEvent.id,
        direction: "LONG",
        entryType: "ZONE",
        entryMin: 4105.33,
        entryMax: 4108,
        stopLoss: 4095.83,
        signalTime: new Date(now - 20 * 60 * 60_000),
        closedAt: new Date(now - 16 * 60 * 60_000),
        parserConfidence: 1,
        status: "EXPIRED",
      })
      .returning();
    const [liveSignal] = await db
      .insert(signals)
      .values({
        sourceId: liveSource.id,
        originEventId: liveEvent.id,
        direction: "LONG",
        entryType: "ZONE",
        entryMin: 4200,
        entryMax: 4202,
        stopLoss: 4190,
        signalTime: new Date(now - 60_000),
        parserConfidence: 1,
        status: "PENDING",
      })
      .returning();
    const [expiredIdea] = await db
      .insert(consolidatedIdeas)
      .values({
        direction: "LONG",
        entryMin: 4105.33,
        entryMax: 4108,
        stopLoss: 4095.83,
        targets: [4113.67],
        exitSpreadStops: null,
        exitSpreadTargets: [0],
        sourceCount: 1,
        signalIds: [expiredSignal.id],
        replacedSignalIds: [],
        newestSignalAt: new Date(now - 20 * 60 * 60_000),
        phase: "available",
      })
      .returning();
    const [liveIdea] = await db
      .insert(consolidatedIdeas)
      .values({
        direction: "LONG",
        entryMin: 4200,
        entryMax: 4202,
        stopLoss: 4190,
        targets: [4210],
        exitSpreadStops: null,
        exitSpreadTargets: [0],
        sourceCount: 3,
        signalIds: [liveSignal.id],
        replacedSignalIds: [],
        newestSignalAt: new Date(now - 60_000),
        phase: "available",
      })
      .returning();
    const [expiredGold] = await db
      .insert(goldBookEntries)
      .values({
        ideaId: expiredIdea.id,
        direction: "LONG",
        entryMin: 4105.33,
        entryMax: 4108,
        stopLoss: 4095.83,
        targets: [4113.67],
      })
      .returning();
    await db.insert(goldBookEntries).values({
      ideaId: liveIdea.id,
      direction: "LONG",
      entryMin: 4200,
      entryMax: 4202,
      stopLoss: 4190,
      targets: [4210],
    });
    await db.insert(boardPosts).values({
      active: true,
      promptVersion: "board-v3",
      signalIds: [],
      ideaIds: [expiredIdea.id],
      primary: {
        direction: "LONG",
        entryMin: 4105.33,
        entryMax: 4108,
        stopLoss: 4095.83,
        targets: [4113.67],
        writeup: "The sources behind this zone have expired.",
        ideaIds: [expiredIdea.id],
      },
      alternates: [],
      cardState: [],
    });

    const closed = await closeRetiredGold(new Date(now));
    expect(closed).toContain(expiredIdea.id);
    expect(closed).not.toContain(liveIdea.id);
    const [expiredRow] = await db.select().from(goldBookEntries).where(eq(goldBookEntries.id, expiredGold.id));
    expect(expiredRow.closeCalledAt).toEqual(new Date(now - 16 * 60 * 60_000));
    expect(expiredRow.sectionAtCall).toBe("available");

    await syncGoldBook();
    const afterExpired = await listGoldEntries();
    const liveExpired = afterExpired.filter((row) => row.ideaId === expiredIdea.id && row.exitTime === null && !row.retired && row.closeCalledAt === null);
    expect(liveExpired).toHaveLength(0);

    await db.update(boardPosts).set({ active: false }).where(eq(boardPosts.active, true));
    await db.insert(boardPosts).values({
      active: true,
      promptVersion: "board-v3",
      signalIds: [],
      ideaIds: [],
      primary: {
        direction: "SHORT",
        entryMin: 4300,
        entryMax: 4304,
        stopLoss: 4312,
        targets: [4288, 4270],
        writeup: "A short zone composed above the market.",
        ideaIds: [],
      },
      alternates: [],
      cardState: [],
    });

    await syncGoldBook();
    const composed = (await listGoldEntries()).filter((row) => row.ideaId === null && row.entryMin === 4300);
    expect(composed).toHaveLength(1);
    expect(composed[0].direction).toBe("SHORT");
    expect(composed[0].stopLoss).toBe(4312);
    expect(composed[0].targets).toEqual([4288, 4270]);

    await syncGoldBook();
    expect((await listGoldEntries()).filter((row) => row.ideaId === null && row.entryMin === 4300)).toHaveLength(1);
  });

  it("keeps one live row when a composed zone copies a sourced call", async () => {
    const db = await getDb();
    const now = Date.now();
    const [idea] = await db
      .insert(consolidatedIdeas)
      .values({
        direction: "SHORT",
        entryMin: 4168.89,
        entryMax: 4168.89,
        stopLoss: 4173.79,
        targets: [4165.22, 4144.4],
        exitSpreadStops: null,
        exitSpreadTargets: [0, 0],
        sourceCount: 3,
        signalIds: [],
        replacedSignalIds: [],
        newestSignalAt: new Date(now - 18 * 60_000),
      })
      .returning();
    const [sourced] = await db
      .insert(goldBookEntries)
      .values({
        ideaId: idea.id,
        direction: "SHORT",
        entryMin: 4168.89,
        entryMax: 4168.89,
        stopLoss: 4173.79,
        targets: [4165.22, 4144.4],
        createdAt: new Date(now - 18 * 60_000),
      })
      .returning();
    await db.insert(goldBookEntries).values({
      ideaId: null,
      direction: "SHORT",
      entryMin: 4168.89,
      entryMax: 4168.89,
      stopLoss: 4173.79,
      targets: [4165.22, 4144.4],
      createdAt: new Date(now - 14 * 60_000),
    });

    const removed = await collapseDuplicateGold();
    expect(removed).toHaveLength(1);
    const zone = (await listGoldEntries()).filter((row) => row.entryMin === 4168.89 && row.exitTime === null && !row.retired);
    expect(zone).toHaveLength(1);
    expect(zone[0].id).toBe(sourced.id);
    expect(zone[0].ideaId).toBe(idea.id);

    await db.update(boardPosts).set({ active: false }).where(eq(boardPosts.active, true));
    await db.insert(boardPosts).values({
      active: true,
      promptVersion: "board-v3",
      signalIds: [],
      ideaIds: [],
      primary: {
        direction: "SHORT",
        entryMin: 4168.89,
        entryMax: 4168.89,
        stopLoss: 4173.79,
        targets: [4165.22, 4144.4],
        writeup: "The same short, written again without a source.",
        ideaIds: [],
      },
      alternates: [
        {
          direction: "SHORT",
          entryMin: 4168.89,
          entryMax: 4168.89,
          stopLoss: 4173.79,
          targets: [4165.22, 4144.4],
          writeup: "And once more from the silver idea.",
          ideaIds: [idea.id],
        },
      ],
      cardState: [],
    });
    await syncGoldBook();
    expect((await listGoldEntries()).filter((row) => row.entryMin === 4168.89 && row.exitTime === null && !row.retired)).toHaveLength(1);
  });

  it("takes an old one-source gold call off the live book", async () => {
    const db = await getDb();
    const now = Date.now();
    const [idea] = await db
      .insert(consolidatedIdeas)
      .values({
        direction: "SHORT",
        entryMin: 4334.88,
        entryMax: 4334.88,
        stopLoss: 4343.53,
        targets: [4302.26],
        exitSpreadStops: null,
        exitSpreadTargets: [0],
        sourceCount: 1,
        signalIds: [],
        replacedSignalIds: [],
        newestSignalAt: new Date(now - 13 * 24 * 60 * 60_000),
        phase: "available",
      })
      .returning();
    await db.insert(goldBookEntries).values({
      ideaId: idea.id,
      direction: "SHORT",
      entryMin: 4334.88,
      entryMax: 4334.88,
      stopLoss: 4343.53,
      targets: [4302.26],
      createdAt: new Date(now - 13 * 24 * 60 * 60_000),
    });
    const result = await reconcileGoldBook(new Date(now));
    expect(result.closed).toContain(idea.id);
    const [row] = await db.select().from(goldBookEntries).where(eq(goldBookEntries.ideaId, idea.id));
    expect(row.closeCalledAt).not.toBeNull();
    expect(row.sectionAtCall).toBe("available");
  });
});
