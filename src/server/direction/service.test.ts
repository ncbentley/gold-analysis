import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/server/db";
import { runMigrations } from "@/server/db/migrate";
import { jobs, sources } from "@/server/db/schema";
import { setTelegramSourceStarred, starJoinedTelegramChat, stopTelegramSignalTracking, syncTelegramSource, useTelegramHistoryLoader } from "@/server/telegram";
import { latestMarketDirection, refreshMarketDirection } from "./service";

const actor = { userId: null, label: "test" };

describe("starred headline direction", () => {
  const previousProvider = process.env.AI_PROVIDER;

  beforeAll(async () => {
    process.env.AI_PROVIDER = "mock";
    await runMigrations();
  }, 60_000);

  afterAll(async () => {
    if (previousProvider === undefined) delete process.env.AI_PROVIDER;
    else process.env.AI_PROVIDER = previousProvider;
    useTelegramHistoryLoader(null);
    await closeDb();
  });

  it("reads a starred channel as headlines and skips the signal parser", async () => {
    const saved = await starJoinedTelegramChat(
      { id: "88021", accessHash: "1", username: "goldnews", title: "GoldNews", kind: "channel" },
      "text-generic",
      actor,
    );
    const db = await getDb();
    const [source] = await db.select().from(sources).where(eq(sources.id, saved.sourceId));
    expect(source.starred).toBe(true);
    expect(source.parseSignals).toBe(false);

    useTelegramHistoryLoader(async () => [
      { id: 1, text: "Projectile strike ignites a tanker in the Strait of Hormuz", date: new Date() },
      { id: 2, text: "US deploys a third carrier and more troops to the region", date: new Date() },
    ]);
    await syncTelegramSource(saved.sourceId, { backfill: 40 });

    const reviews = await db.select().from(jobs).where(eq(jobs.type, "PROCESS_EVENT"));
    expect(reviews.filter((job) => job.payloadJson.sourceId === saved.sourceId)).toHaveLength(0);

    const written = await refreshMarketDirection();
    expect(written).toMatchObject({ skipped: false, lean: "bid" });
    const view = await latestMarketDirection();
    expect(view?.label).toBe("Bid under gold");
    expect(view?.summary).not.toMatch(/\b(buy|sell|long|short)\b/i);
    expect(view?.headlines.map((headline) => headline.sourceName)).toContain("GoldNews");
  });

  it("keeps a starred channel when signal tracking stops, and drops it when the star goes", async () => {
    const db = await getDb();
    const [source] = await db.select().from(sources).where(eq(sources.telegramChannelId, "88021"));
    await db.update(sources).set({ parseSignals: true }).where(eq(sources.id, source.id));
    expect(await stopTelegramSignalTracking(source.id, actor)).toBe("GoldNews");
    const [kept] = await db.select().from(sources).where(eq(sources.id, source.id));
    expect(kept.parseSignals).toBe(false);
    expect(kept.removedAt).toBeNull();
    expect(kept.starred).toBe(true);

    await setTelegramSourceStarred(source.id, false, actor);
    const [gone] = await db.select().from(sources).where(eq(sources.id, source.id));
    expect(gone.removedAt).not.toBeNull();
    expect(gone.active).toBe(false);
  });

  it("folds a news channel and a tracked channel into one direction read", async () => {
    const news = await starJoinedTelegramChat(
      { id: "88041", accessHash: "1", username: "wire", title: "Wire", kind: "channel" },
      "text-generic",
      actor,
    );
    const tracked = await starJoinedTelegramChat(
      { id: "88042", accessHash: "2", username: "calls", title: "Calls", kind: "channel" },
      "text-generic",
      actor,
    );
    const db = await getDb();
    await db.update(sources).set({ parseSignals: true }).where(eq(sources.id, tracked.sourceId));

    useTelegramHistoryLoader(async (source) => {
      const text = source.id === news.sourceId ? "Iran stays open to talks" : "Putin hopes the strait reopens";
      return [{ id: 7, text, date: new Date() }];
    });
    await syncTelegramSource(news.sourceId, { backfill: 40 });
    await syncTelegramSource(tracked.sourceId, { backfill: 40 });

    const written = await refreshMarketDirection();
    expect(written).toMatchObject({ skipped: false, lean: "offered" });
    const view = await latestMarketDirection();
    const ids = new Set(view?.headlines.map((headline) => headline.sourceId));
    expect(ids.has(news.sourceId)).toBe(true);
    expect(ids.has(tracked.sourceId)).toBe(true);
  });
});
