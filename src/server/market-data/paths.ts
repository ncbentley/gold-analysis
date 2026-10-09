import { and, asc, eq, gte, lt } from "drizzle-orm";
import { getDb } from "@/server/db";
import { marketMinutePaths, marketTicks } from "@/server/db/schema";
import type { EngineTick } from "@/server/outcomes/engine";
import { collapsePrints, expandPath, mergePrint, minuteStart, PATH_RETENTION_MS } from "./minute-path";

const MINUTE = 60_000;

export async function sealMinute(instrument: string, minute: Date, extra: { t: number; price: number; seq: number }[] = []) {
  const db = await getDb();
  const end = new Date(minute.getTime() + MINUTE);
  await db.transaction(async (tx) => {
    if (extra.length) {
      const receivedAt = new Date();
      await tx.insert(marketTicks).values(
        extra.map((row) => ({ instrument, at: new Date(row.t), seq: row.seq, price: row.price, receivedAt })),
      );
    }
    const rows = await tx
      .select({ at: marketTicks.at, price: marketTicks.price })
      .from(marketTicks)
      .where(and(eq(marketTicks.instrument, instrument), gte(marketTicks.at, minute), lt(marketTicks.at, end)))
      .orderBy(asc(marketTicks.at), asc(marketTicks.receivedAt), asc(marketTicks.seq));
    const prints = rows.map((row) => ({ t: row.at.getTime(), price: row.price }));
    const [existing] = await tx
      .select({ offsets: marketMinutePaths.offsets, prices: marketMinutePaths.prices })
      .from(marketMinutePaths)
      .where(and(eq(marketMinutePaths.instrument, instrument), eq(marketMinutePaths.minute, minute)));
    if (existing) {
      let path = { minute: minute.getTime(), offsets: existing.offsets, prices: existing.prices };
      for (const print of prints) path = mergePrint(path, print);
      if (prints.length) {
        await tx
          .update(marketMinutePaths)
          .set({ offsets: path.offsets, prices: path.prices })
          .where(and(eq(marketMinutePaths.instrument, instrument), eq(marketMinutePaths.minute, minute)));
      }
    } else {
      const path = collapsePrints(minute.getTime(), prints);
      if (path.prices.length) {
        await tx.insert(marketMinutePaths).values({ instrument, minute, offsets: path.offsets, prices: path.prices });
      }
    }
    await tx.delete(marketTicks).where(and(eq(marketTicks.instrument, instrument), gte(marketTicks.at, minute), lt(marketTicks.at, end)));
  });
}

/** Returns false when that minute has no path yet. The caller keeps the print in the buffer. */
export async function mergeSealedPrint(instrument: string, t: number, price: number) {
  const db = await getDb();
  const minute = new Date(minuteStart(t));
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ offsets: marketMinutePaths.offsets, prices: marketMinutePaths.prices })
      .from(marketMinutePaths)
      .where(and(eq(marketMinutePaths.instrument, instrument), eq(marketMinutePaths.minute, minute)));
    if (!row) return false;
    const merged = mergePrint({ minute: minute.getTime(), offsets: row.offsets, prices: row.prices }, { t, price });
    await tx
      .update(marketMinutePaths)
      .set({ offsets: merged.offsets, prices: merged.prices })
      .where(and(eq(marketMinutePaths.instrument, instrument), eq(marketMinutePaths.minute, minute)));
    return true;
  });
}

export async function compactClosedMinutes(instrument: string, openMinute: number) {
  const db = await getDb();
  const rows = await db
    .select({ at: marketTicks.at })
    .from(marketTicks)
    .where(and(eq(marketTicks.instrument, instrument), lt(marketTicks.at, new Date(openMinute))));
  const minutes = [...new Set(rows.map((row) => minuteStart(row.at.getTime())))].sort((a, b) => a - b);
  for (const minute of minutes) await sealMinute(instrument, new Date(minute));
}

export async function deleteExpiredPaths(now: number) {
  const db = await getDb();
  await db.delete(marketMinutePaths).where(lt(marketMinutePaths.minute, new Date(now - PATH_RETENTION_MS)));
}

export async function deleteSealedBuffer(instrument: string) {
  const db = await getDb();
  const sealed = await db.select({ minute: marketMinutePaths.minute }).from(marketMinutePaths).where(eq(marketMinutePaths.instrument, instrument));
  for (const row of sealed) {
    const end = new Date(row.minute.getTime() + MINUTE);
    await db.delete(marketTicks).where(and(eq(marketTicks.instrument, instrument), gte(marketTicks.at, row.minute), lt(marketTicks.at, end)));
  }
}

export async function maintainMinutePaths(instrument: string, now = Date.now()) {
  await compactClosedMinutes(instrument, minuteStart(now));
  await deleteExpiredPaths(now);
  await deleteSealedBuffer(instrument);
}

export async function readStoredTicks(instrument: string, from: Date, end: Date): Promise<EngineTick[]> {
  const db = await getDb();
  const fromMs = from.getTime();
  const endMs = end.getTime();
  const inWindow = (t: number) => t >= fromMs && t < endMs;
  const paths = await db
    .select({ minute: marketMinutePaths.minute, offsets: marketMinutePaths.offsets, prices: marketMinutePaths.prices })
    .from(marketMinutePaths)
    .where(
      and(
        eq(marketMinutePaths.instrument, instrument),
        gte(marketMinutePaths.minute, new Date(minuteStart(fromMs))),
        lt(marketMinutePaths.minute, end),
      ),
    )
    .orderBy(asc(marketMinutePaths.minute));
  const buffered = await db
    .select({ at: marketTicks.at, price: marketTicks.price })
    .from(marketTicks)
    .where(and(eq(marketTicks.instrument, instrument), gte(marketTicks.at, from), lt(marketTicks.at, end)))
    .orderBy(asc(marketTicks.at), asc(marketTicks.receivedAt), asc(marketTicks.seq));
  const covered = new Set(paths.map((row) => row.minute.getTime()));
  const groups = new Map<number, EngineTick[]>();
  for (const row of paths) {
    const ticks = expandPath({ minute: row.minute.getTime(), offsets: row.offsets, prices: row.prices }).filter((tick) =>
      inWindow(tick.t),
    );
    if (ticks.length) groups.set(row.minute.getTime(), ticks);
  }
  for (const row of buffered) {
    const t = row.at.getTime();
    if (!inWindow(t)) continue;
    const minute = minuteStart(t);
    if (covered.has(minute)) continue;
    const list = groups.get(minute) ?? [];
    list.push({ t, price: row.price });
    groups.set(minute, list);
  }
  return [...groups.keys()].sort((a, b) => a - b).flatMap((minute) => groups.get(minute) ?? []);
}
