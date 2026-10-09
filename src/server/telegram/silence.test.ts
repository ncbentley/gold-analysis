import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/server/db";
import { runMigrations } from "@/server/db/migrate";
import { auditLogs, rawEvents, signals, sources } from "@/server/db/schema";
import { SIGNAL_SILENCE_MS } from "@/server/jobs/limits";
import { useTelegramChannelLeaver } from "@/server/telegram";
import { dropSilentTrackedChannels } from "./schedule";

process.env.JOBS_WORKER = "off";

const DAY = 24 * 60 * 60_000;

beforeAll(async () => {
  await runMigrations();
}, 60_000);

afterEach(() => {
  useTelegramChannelLeaver(null);
});

afterAll(async () => {
  await closeDb();
});

let n = 0;

async function addChannel(patch: Partial<typeof sources.$inferInsert> = {}) {
  n += 1;
  const db = await getDb();
  const [row] = await db
    .insert(sources)
    .values({
      name: `Quiet ${n}`,
      slug: `quiet-${n}-${crypto.randomUUID().slice(0, 8)}`,
      sourceType: "telegram",
      parserType: "text-generic",
      telegramChannelId: String(900_000 + n),
      telegramAccessHash: String(700_000 + n),
      description: `Telegram channel Quiet ${n}`,
      active: true,
      parseSignals: true,
      createdAt: new Date(Date.now() - SIGNAL_SILENCE_MS - DAY),
      ...patch,
    })
    .returning();
  return row;
}

async function addSignal(sourceId: string, signalTime: Date) {
  const db = await getDb();
  const [event] = await db
    .insert(rawEvents)
    .values({
      sourceId,
      rawText: "buy gold",
      publishedAt: signalTime,
      contentHash: `silence-${sourceId}-${signalTime.getTime()}`,
    })
    .returning();
  await db.insert(signals).values({
    sourceId,
    originEventId: event.id,
    direction: "LONG",
    entryType: "MARKET",
    entryMin: 2650,
    entryMax: 2650,
    signalTime,
    parserConfidence: 1,
  });
}

describe("silent channel cleanup", () => {
  it("removes tracking and leaves a channel that has had no signal for 15 days", async () => {
    const stale = await addChannel();
    const recent = await addChannel();
    await addSignal(recent.id, new Date(Date.now() - 2 * DAY));
    const fresh = await addChannel({ createdAt: new Date(Date.now() - 2 * DAY) });
    const headline = await addChannel({ parseSignals: false, starred: true });
    const left: string[] = [];
    useTelegramChannelLeaver(async (source) => {
      left.push(source.id);
    });

    const result = await dropSilentTrackedChannels();

    expect(result.dropped).toBeGreaterThanOrEqual(1);
    expect(left).toContain(stale.id);
    expect(left).not.toContain(recent.id);
    expect(left).not.toContain(fresh.id);
    expect(left).not.toContain(headline.id);
    const db = await getDb();
    const [gone] = await db.select().from(sources).where(eq(sources.id, stale.id));
    expect(gone.active).toBe(false);
    expect(gone.removedAt).not.toBeNull();
    const [kept] = await db.select().from(sources).where(eq(sources.id, recent.id));
    expect(kept.parseSignals).toBe(true);
    expect(kept.removedAt).toBeNull();
    const [stillNew] = await db.select().from(sources).where(eq(sources.id, fresh.id));
    expect(stillNew.parseSignals).toBe(true);
  });

  it("stops signal tracking on a starred channel and stays in the chat", async () => {
    const starred = await addChannel({ starred: true });
    const left: string[] = [];
    useTelegramChannelLeaver(async (source) => {
      left.push(source.id);
    });

    await dropSilentTrackedChannels();

    expect(left).not.toContain(starred.id);
    const db = await getDb();
    const [row] = await db.select().from(sources).where(eq(sources.id, starred.id));
    expect(row.parseSignals).toBe(false);
    expect(row.starred).toBe(true);
    expect(row.removedAt).toBeNull();
    expect(row.active).toBe(true);
  });

  it("drops tracking when the stored access cannot leave, and waits when Telegram refuses", async () => {
    const unreachable = await addChannel({ telegramAccessHash: null, description: "Telegram channel no hash" });
    const flooded = await addChannel();
    useTelegramChannelLeaver(async (source) => {
      if (source.id === flooded.id) throw new Error("FLOOD_WAIT_20");
    });

    await dropSilentTrackedChannels();

    const db = await getDb();
    const [gone] = await db.select().from(sources).where(eq(sources.id, unreachable.id));
    expect(gone.removedAt).not.toBeNull();
    const [waiting] = await db.select().from(sources).where(eq(sources.id, flooded.id));
    expect(waiting.parseSignals).toBe(true);
    expect(waiting.removedAt).toBeNull();
    const notes = await db.select().from(auditLogs).where(eq(auditLogs.entityId, unreachable.id));
    expect(notes.map((note) => note.action)).toEqual(expect.arrayContaining(["telegram.tracking_expired", "source.removed", "telegram.channel_left"]));
  });

  it("does nothing from the web process, which does not own the Telegram socket", async () => {
    const stale = await addChannel();
    const result = await dropSilentTrackedChannels();
    expect(result).toEqual({ dropped: 0, left: 0, skipped: "remote" });
    const db = await getDb();
    const [row] = await db.select().from(sources).where(eq(sources.id, stale.id));
    expect(row.parseSignals).toBe(true);
    expect(row.removedAt).toBeNull();
  });
});
