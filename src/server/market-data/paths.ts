import { and, asc, eq, gte, lt } from "drizzle-orm";
import { getDb } from "@/server/db";
import { marketMinutePaths, marketTicks } from "@/server/db/schema";
import type { EngineTick } from "@/server/outcomes/engine";
import { expandPath, mergePrint, minuteStart, PATH_RETENTION_MS } from "./minute-path";

const MINUTE = 60_000;

function collapseSealedPrints(minute: number, prints: { t: number; price: number }[]) {
  const ordered = [...prints].sort((a, b) => a.t - b.t);
  const offsets: number[] = [];
  const prices: number[] = [];
  for (const print of ordered) {
    if (prices.length && prices[prices.length - 1] === print.price) continue;
    if (prices.length > 1 && print.price === prices[0] && prices[prices.length - 1] !== print.price) continue;
    offsets.push(print.t - minute);
    prices.push(print.price);
  }
  return { minute, offsets, prices };
}

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
    const path = collapseSealedPrints(
      minute.getTime(),
      rows.map((row) => ({ t: row.at.getTime(), price: row.price })),
    );
    if (path.prices.length) {
      await tx
        .insert(marketMinutePaths)
        .values({ instrument, minute, offsets: path.offsets, prices: path.prices })
        .onConflictDoUpdate({
          target: [marketMinutePaths.instrument, marketMinutePaths.minute],
          set: { offsets: path.offsets, prices: path.prices },
        });
    }
    await tx.delete(marketTicks).where(and(eq(marketTicks.instrument, instrument), gte(marketTicks.at, minute), lt(marketTicks.at, end)));
  });
}

/** Returns false when that minute has no path yet. The caller keeps the print in the buffer. */
export async function mergeSealedPrint(instrument: string, t: number, price: number) {
  const db = await getDb();
  const minute = new Date(minuteStart(t));
  const [row] = await db
    .select({ offsets: marketMinutePaths.offsets, prices: marketMinutePaths.prices })
    .from(marketMinutePaths)
    .where(and(eq(marketMinutePaths.instrument, instrument), eq(marketMinutePaths.minute, minute)));
  if (!row) return false;
  const merged = mergePrint({ minute: minute.getTime(), offsets: row.offsets, prices: row.prices }, { t, price });
  await db
    .update(marketMinutePaths)
    .set({ offsets: merged.offsets, prices: merged.prices })
    .where(and(eq(marketMinutePaths.instrument, instrument), eq(marketMinutePaths.minute, minute)));
  return true;
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
  const paths = await db
    .select({ minute: marketMinutePaths.minute, offsets: marketMinutePaths.offsets, prices: marketMinutePaths.prices })
    .from(marketMinutePaths)
    .where(and(eq(marketMinutePaths.instrument, instrument), gte(marketMinutePaths.minute, from), lt(marketMinutePaths.minute, end)))
    .orderBy(asc(marketMinutePaths.minute));
  const buffered = await db
    .select({ at: marketTicks.at, price: marketTicks.price })
    .from(marketTicks)
    .where(and(eq(marketTicks.instrument, instrument), gte(marketTicks.at, from), lt(marketTicks.at, end)))
    .orderBy(asc(marketTicks.at), asc(marketTicks.receivedAt), asc(marketTicks.seq));
  const covered = new Set(paths.map((row) => row.minute.getTime()));
  const groups = new Map<number, EngineTick[]>();
  for (const row of paths) {
    groups.set(row.minute.getTime(), expandPath({ minute: row.minute.getTime(), offsets: row.offsets, prices: row.prices }));
  }
  for (const row of buffered) {
    const minute = minuteStart(row.at.getTime());
    if (covered.has(minute)) continue;
    const list = groups.get(minute) ?? [];
    list.push({ t: row.at.getTime(), price: row.price });
    groups.set(minute, list);
  }
  return [...groups.keys()].sort((a, b) => a - b).flatMap((minute) => groups.get(minute) ?? []);
}
