import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/server/db";
import { runMigrations } from "@/server/db/migrate";
import { marketMinutePaths, marketTicks } from "@/server/db/schema";
import { getEngineTicks } from "./index";
import { PATH_RETENTION_MS } from "./minute-path";
import { compactClosedMinutes, deleteExpiredPaths, deleteSealedBuffer, mergeSealedPrint, sealMinute } from "./paths";

const INSTRUMENT = "XAUUSD";
const MINUTE = 60_000;

beforeAll(async () => {
  await runMigrations();
});

afterAll(async () => {
  await closeDb();
});

describe("minute path storage", () => {
  it("seals buffer prints in order and removes them", async () => {
    const db = await getDb();
    const minute = new Date(0);
    await db.insert(marketTicks).values([
      { instrument: INSTRUMENT, at: new Date(30), seq: 0, price: 100, receivedAt: new Date(2) },
      { instrument: INSTRUMENT, at: new Date(10), seq: 1, price: 100, receivedAt: new Date(1) },
      { instrument: INSTRUMENT, at: new Date(20), seq: 2, price: 101, receivedAt: new Date(1) },
    ]);
    await sealMinute(INSTRUMENT, minute);
    const ticks = await getEngineTicks(minute, new Date(MINUTE));
    expect(ticks).toEqual([
      { t: 10, price: 100 },
      { t: 20, price: 101 },
      { t: 30, price: 100 },
    ]);
    const left = await db.select().from(marketTicks);
    expect(left).toEqual([]);
  });

  it("reads a sealed minute and an unsealed minute together", async () => {
    const db = await getDb();
    await db.insert(marketTicks).values({ instrument: INSTRUMENT, at: new Date(MINUTE + 5), seq: 0, price: 110, receivedAt: new Date(0) });
    const ticks = await getEngineTicks(new Date(0), new Date(2 * MINUTE));
    expect(ticks).toEqual([
      { t: 10, price: 100 },
      { t: 20, price: 101 },
      { t: 30, price: 100 },
      { t: MINUTE + 5, price: 110 },
    ]);
  });

  it("merges a print into a sealed minute", async () => {
    await mergeSealedPrint(INSTRUMENT, 15, 100.5);
    const ticks = await getEngineTicks(new Date(0), new Date(MINUTE));
    expect(ticks.map((tick) => tick.price)).toEqual([100, 100.5, 101, 100]);
  });

  it("compacts a closed minute and leaves the open minute buffered", async () => {
    const db = await getDb();
    await db.insert(marketTicks).values({ instrument: INSTRUMENT, at: new Date(2 * MINUTE + 5), seq: 0, price: 120, receivedAt: new Date(1) });
    await compactClosedMinutes(INSTRUMENT, 2 * MINUTE);
    const ticks = await getEngineTicks(new Date(MINUTE), new Date(3 * MINUTE));
    expect(ticks).toEqual([
      { t: MINUTE + 5, price: 110 },
      { t: 2 * MINUTE + 5, price: 120 },
    ]);
    const buffered = await db.select().from(marketTicks);
    expect(buffered).toHaveLength(1);
  });

  it("drops paths older than 30 days and leaves a buffer row that has no path", async () => {
    const db = await getDb();
    const old = new Date(Date.now() - PATH_RETENTION_MS - MINUTE);
    await db.insert(marketMinutePaths).values({ instrument: INSTRUMENT, minute: old, offsets: [0], prices: [1] });
    await db.insert(marketTicks).values({ instrument: INSTRUMENT, at: new Date(3 * MINUTE), seq: 0, price: 130, receivedAt: new Date(0) });
    await deleteExpiredPaths(Date.now());
    await deleteSealedBuffer(INSTRUMENT);
    const paths = await db.select().from(marketMinutePaths);
    expect(paths.some((row) => row.minute.getTime() === old.getTime())).toBe(false);
    const buffered = await db.select().from(marketTicks);
    expect(buffered.map((row) => row.price).sort()).toEqual([120, 130]);
  });

  it("clips path prints to the requested time window", async () => {
    const db = await getDb();
    const instrument = "TESTPATH";
    await db.insert(marketMinutePaths).values({ instrument, minute: new Date(0), offsets: [10, 40], prices: [1, 2] });
    expect(await getEngineTicks(new Date(20), new Date(30), instrument)).toEqual([]);
    expect(await getEngineTicks(new Date(0), new Date(20), instrument)).toEqual([{ t: 10, price: 1 }]);
  });

  it("merges buffer prints into an existing path on reseal", async () => {
    const db = await getDb();
    const instrument = "TESTPATH";
    const minute = new Date(MINUTE);
    await db.insert(marketMinutePaths).values({ instrument, minute, offsets: [0], prices: [100] });
    await db.insert(marketTicks).values({
      instrument,
      at: new Date(MINUTE + 20),
      seq: 0,
      price: 101,
      receivedAt: new Date(3),
    });
    await sealMinute(instrument, minute);
    expect(await getEngineTicks(minute, new Date(2 * MINUTE), instrument)).toEqual([
      { t: MINUTE, price: 100 },
      { t: MINUTE + 20, price: 101 },
    ]);
    expect(await db.select().from(marketTicks).where(eq(marketTicks.instrument, instrument))).toEqual([]);
  });
});
