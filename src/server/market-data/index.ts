import { and, asc, eq, gte, lt, sql } from "drizzle-orm";
import { getDb } from "@/server/db";
import { marketBars, marketDataSync } from "@/server/db/schema";
import type { EngineBar } from "@/server/outcomes/engine";
import { mockMarketDataProvider } from "./mock-provider";
import type { MarketDataProvider } from "./provider";
import { createTwelveDataProvider } from "./twelvedata-provider";

export const INSTRUMENT = "XAUUSD";
const MINUTE = 60_000;
const CHUNK_MINUTES = 60 * 24 * 3;

export function getMarketDataProvider(): MarketDataProvider {
  if (process.env.MARKET_DATA_PROVIDER === "twelvedata" && process.env.TWELVEDATA_API_KEY) {
    return createTwelveDataProvider(process.env.TWELVEDATA_API_KEY);
  }
  return mockMarketDataProvider;
}

export async function getSyncState(instrument = INSTRUMENT) {
  const db = await getDb();
  const [row] = await db.select().from(marketDataSync).where(eq(marketDataSync.instrument, instrument));
  return row ?? null;
}

/** Fetches bars from the provider and stores them. Idempotent: existing bars are kept. */
export async function syncMarketData(opts: { from?: Date; to?: Date; instrument?: string } = {}) {
  const db = await getDb();
  const instrument = opts.instrument ?? INSTRUMENT;
  const provider = getMarketDataProvider();
  const state = await getSyncState(instrument);
  const to = new Date(Math.floor((opts.to ?? new Date()).getTime() / MINUTE) * MINUTE);
  const from = opts.from ?? state?.syncedThrough ?? new Date(to.getTime() - 3 * 86_400_000);
  if (from >= to) return { inserted: 0, syncedThrough: to };

  let inserted = 0;
  for (let start = from.getTime(); start < to.getTime(); start += CHUNK_MINUTES * MINUTE) {
    const end = new Date(Math.min(start + CHUNK_MINUTES * MINUTE, to.getTime()));
    const bars = await provider.fetchMinuteBars(instrument, new Date(start), end);
    for (let i = 0; i < bars.length; i += 1000) {
      const batch = bars.slice(i, i + 1000).map((b) => ({
        instrument,
        resolution: "1m",
        timestamp: b.timestamp,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
        volume: b.volume,
        provider: provider.name,
      }));
      if (batch.length) {
        await db.insert(marketBars).values(batch).onConflictDoNothing();
        inserted += batch.length;
      }
    }
  }

  const firstBarAt = state?.firstBarAt && state.firstBarAt < from ? state.firstBarAt : from;
  await db
    .insert(marketDataSync)
    .values({ instrument, provider: provider.name, syncedThrough: to, firstBarAt })
    .onConflictDoUpdate({
      target: marketDataSync.instrument,
      set: {
        provider: provider.name,
        syncedThrough: sql`greatest(${marketDataSync.syncedThrough}, ${to.toISOString()}::timestamptz)`,
        firstBarAt: sql`least(${marketDataSync.firstBarAt}, ${firstBarAt.toISOString()}::timestamptz)`,
      },
    });
  return { inserted, syncedThrough: to };
}

export async function getEngineBars(from: Date, to: Date, instrument = INSTRUMENT): Promise<EngineBar[]> {
  const db = await getDb();
  const rows = await db
    .select({ t: marketBars.timestamp, o: marketBars.open, h: marketBars.high, l: marketBars.low, c: marketBars.close })
    .from(marketBars)
    .where(
      and(
        eq(marketBars.instrument, instrument),
        eq(marketBars.resolution, "1m"),
        gte(marketBars.timestamp, from),
        lt(marketBars.timestamp, to),
      ),
    )
    .orderBy(asc(marketBars.timestamp));
  return rows.map((r) => ({ ...r, t: r.t.getTime() }));
}

export async function getRecentBars(minutes: number, instrument = INSTRUMENT) {
  const db = await getDb();
  const rows = await db
    .select()
    .from(marketBars)
    .where(eq(marketBars.instrument, instrument))
    .orderBy(sql`${marketBars.timestamp} desc`)
    .limit(minutes);
  return rows.reverse();
}

export async function getMarketDataSummary(instrument = INSTRUMENT) {
  const db = await getDb();
  const [row] = await db
    .select({
      count: sql<number>`count(*)::int`,
      first: sql<Date | null>`min(${marketBars.timestamp})`,
      last: sql<Date | null>`max(${marketBars.timestamp})`,
    })
    .from(marketBars)
    .where(eq(marketBars.instrument, instrument));
  return row;
}
