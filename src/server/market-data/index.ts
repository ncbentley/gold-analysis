import { and, asc, desc, eq, gt, gte, lte, lt, ne, sql } from "drizzle-orm";
import { getDb } from "@/server/db";
import { marketBars, marketDataSync, marketMinutePaths, marketTicks, signals } from "@/server/db/schema";
import { maintainMinutePaths, readStoredTicks } from "./paths";
import { getSetting, SETTING_KEYS } from "@/server/settings";
import type { EngineBar, EngineTick } from "@/server/outcomes/engine";
import { mockMarketDataProvider } from "./mock-provider";
import { isGoldMarketOpen, type MarketDataProvider } from "./provider";
import { routineSyncStart, seriesRepair, syncedRecently } from "./sync-window";
import { createTwelveDataProvider } from "./twelvedata-provider";

export const INSTRUMENT = "XAUUSD";
const MINUTE = 60_000;
const CHUNK_MINUTES = 60 * 24 * 3;

export interface MarketDataSettings {
  provider: "mock" | "twelvedata";
  twelvedataApiKey?: string | null;
}

const REAL_PROVIDER = "twelvedata";

/** Admin settings take precedence over environment variables. Production never falls back to synthetic prices. */
export async function getMarketDataConfig(): Promise<MarketDataSettings & { configuredIn: "admin" | "env" | "default" }> {
  const saved = await getSetting<MarketDataSettings>(SETTING_KEYS.marketData);
  const envKey = process.env.MARKET_DATA_PROVIDER === REAL_PROVIDER ? process.env.TWELVEDATA_API_KEY : null;
  if (saved?.provider === REAL_PROVIDER) {
    const key = saved.twelvedataApiKey || envKey || null;
    return { provider: REAL_PROVIDER, twelvedataApiKey: key, configuredIn: saved.twelvedataApiKey ? "admin" : "env" };
  }
  if (envKey) return { provider: REAL_PROVIDER, twelvedataApiKey: envKey, configuredIn: "env" };
  if (process.env.NODE_ENV === "production") return { provider: REAL_PROVIDER, twelvedataApiKey: null, configuredIn: "default" };
  return { provider: "mock", configuredIn: saved ? "admin" : "default" };
}

export async function getMarketDataProvider(): Promise<MarketDataProvider> {
  const cfg = await getMarketDataConfig();
  if (cfg.provider === REAL_PROVIDER) {
    if (!cfg.twelvedataApiKey) throw new Error("Twelve Data is not configured.");
    return createTwelveDataProvider(cfg.twelvedataApiKey);
  }
  if (process.env.NODE_ENV === "production") throw new Error("Synthetic market data is disabled.");
  return mockMarketDataProvider;
}

export async function getSyncState(instrument = INSTRUMENT) {
  const db = await getDb();
  const [row] = await db.select().from(marketDataSync).where(eq(marketDataSync.instrument, instrument));
  if (!row) return null;
  return {
    ...row,
    syncedThrough: new Date(row.syncedThrough),
    firstBarAt: row.firstBarAt ? new Date(row.firstBarAt) : null,
    updatedAt: new Date(row.updatedAt),
  };
}

/** Bars can exist without a sync row after a crash. Record their span so the next sync continues. */
async function adoptStoredBars(instrument: string, providerName: string) {
  const existing = await getSyncState(instrument);
  if (existing) return existing;
  const summary = await getMarketDataSummary(instrument);
  if (!summary?.count || !summary.first || !summary.last) return null;
  const now = new Date();
  if (summary.first.getTime() > now.getTime()) return null;
  const db = await getDb();
  await db
    .insert(marketDataSync)
    .values({
      instrument,
      provider: providerName,
      syncedThrough: new Date(Math.min(summary.last.getTime(), now.getTime())),
      firstBarAt: summary.first,
    })
    .onConflictDoNothing();
  return getSyncState(instrument);
}

/** Fetches bars from the provider and stores them. Idempotent: existing bars are kept. */
export async function syncMarketData(opts: { from?: Date; to?: Date; instrument?: string } = {}) {
  const db = await getDb();
  const instrument = opts.instrument ?? INSTRUMENT;
  await maintainMinutePaths(instrument);
  const provider = await getMarketDataProvider();
  const state = await adoptStoredBars(instrument, provider.name);
  const now = new Date();
  const cursorAhead = Boolean(state && state.syncedThrough.getTime() > now.getTime());
  if (!opts.from && state && !cursorAhead && provider.minSyncIntervalMs) {
    const interval = isGoldMarketOpen(now) ? provider.minSyncIntervalMs : 60 * MINUTE;
    if (syncedRecently(state.updatedAt.getTime(), now.getTime(), interval)) return { inserted: 0, syncedThrough: state.syncedThrough, skipped: true };
  }
  const to = new Date(Math.floor(Math.min((opts.to ?? now).getTime(), now.getTime()) / MINUTE) * MINUTE);
  const from = opts.from ?? new Date(routineSyncStart(state?.syncedThrough.getTime() ?? null, to.getTime(), now.getTime()));
  if (from >= to) return { inserted: 0, syncedThrough: to };

  let inserted = 0;
  for (let start = from.getTime(); start < to.getTime(); start += CHUNK_MINUTES * MINUTE) {
    if (start > from.getTime() && provider.requestSpacingMs) await new Promise((r) => setTimeout(r, provider.requestSpacingMs));
    const end = new Date(Math.min(start + CHUNK_MINUTES * MINUTE, to.getTime()));
    const bars = (await provider.fetchMinuteBars(instrument, new Date(start), end)).filter(
      (b) => b.timestamp.getTime() <= now.getTime() + MINUTE,
    );
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
    // Persist each chunk so a killed backfill resumes instead of forgetting where it got to.
    const firstBarAt = state?.firstBarAt && state.firstBarAt < from ? state.firstBarAt : from;
    await db
      .insert(marketDataSync)
      .values({ instrument, provider: provider.name, syncedThrough: end, firstBarAt })
      .onConflictDoUpdate({
        target: marketDataSync.instrument,
        set: {
          provider: provider.name,
          syncedThrough: sql`least(greatest(${marketDataSync.syncedThrough}, ${end.toISOString()}::timestamptz), ${now.toISOString()}::timestamptz)`,
          firstBarAt: sql`least(${marketDataSync.firstBarAt}, ${firstBarAt.toISOString()}::timestamptz)`,
          updatedAt: new Date(),
        },
      });
  }

  return { inserted, syncedThrough: to };
}

/** Close of the nearest 1-minute bar to `at`, or null when nothing is within a few hours. */
export async function getPriceNear(at: Date, instrument = INSTRUMENT): Promise<number | null> {
  const db = await getDb();
  const when = at.getTime();
  const [before] = await db
    .select({ close: marketBars.close, timestamp: marketBars.timestamp })
    .from(marketBars)
    .where(and(eq(marketBars.instrument, instrument), eq(marketBars.resolution, "1m"), lte(marketBars.timestamp, at)))
    .orderBy(desc(marketBars.timestamp))
    .limit(1);
  if (before) {
    const ts = new Date(before.timestamp).getTime();
    if (when - ts <= 6 * 60 * 60_000) return before.close;
  }
  const [after] = await db
    .select({ close: marketBars.close, timestamp: marketBars.timestamp })
    .from(marketBars)
    .where(and(eq(marketBars.instrument, instrument), eq(marketBars.resolution, "1m"), gte(marketBars.timestamp, at)))
    .orderBy(asc(marketBars.timestamp))
    .limit(1);
  if (after && new Date(after.timestamp).getTime() - when <= 15 * 60_000) return after.close;
  return null;
}

export async function getEngineBars(from: Date, to: Date, instrument = INSTRUMENT): Promise<EngineBar[]> {
  const end = new Date(Math.min(to.getTime(), Date.now() + MINUTE));
  if (from.getTime() >= end.getTime()) return [];
  const db = await getDb();
  const rows = await db
    .select({ t: marketBars.timestamp, o: marketBars.open, h: marketBars.high, l: marketBars.low, c: marketBars.close })
    .from(marketBars)
    .where(
      and(
        eq(marketBars.instrument, instrument),
        eq(marketBars.resolution, "1m"),
        gte(marketBars.timestamp, from),
        lt(marketBars.timestamp, end),
      ),
    )
    .orderBy(asc(marketBars.timestamp));
  return rows.map((r) => ({ ...r, t: r.t.getTime() }));
}

/** Prints in vendor time, then the order they were stored. Minutes with none fall back to the candle path. */
export async function getEngineTicks(from: Date, to: Date, instrument = INSTRUMENT): Promise<EngineTick[]> {
  const end = new Date(Math.min(to.getTime(), Date.now() + MINUTE));
  if (from.getTime() >= end.getTime()) return [];
  return readStoredTicks(instrument, from, end);
}

export async function getRecentBars(minutes: number, instrument = INSTRUMENT) {
  const db = await getDb();
  const rows = await db
    .select()
    .from(marketBars)
    .where(and(eq(marketBars.instrument, instrument), lte(marketBars.timestamp, new Date())))
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
  return {
    count: row?.count ?? 0,
    first: row?.first ? new Date(row.first) : null,
    last: row?.last ? new Date(row.last) : null,
  };
}

/**
 * Makes sure stored bars reach back to the oldest signal, so backfilled Telegram history is
 * evaluated against real data instead of an empty window. Returns true if data was fetched.
 */
export async function ensureMarketDataCoverage(instrument = INSTRUMENT) {
  const db = await getDb();
  const provider = await getMarketDataProvider();
  await adoptStoredBars(instrument, provider.name);
  const [{ oldest }] = await db.select({ oldest: sql<Date | null>`min(${signals.signalTime})` }).from(signals).where(eq(signals.instrument, instrument));
  const state = await getSyncState(instrument);
  if (!oldest) return false;
  const need = new Date(new Date(oldest).getTime() - 2 * 60 * MINUTE);
  if (state?.firstBarAt && state.firstBarAt <= need) return false;
  await syncMarketData({ from: need, to: state?.firstBarAt ?? new Date(), instrument });
  return true;
}

/**
 * Synthetic bars share timestamps with real ones, so a single leftover row blocks the real price.
 * When the live provider is Twelve Data, any other provider means the stored series is replaced.
 * A real bar dated after the clock is removed once; sync does not sweep for them.
 */
export async function discardUnrealBars(instrument = INSTRUMENT): Promise<"clean" | "reset" | "dropped-future"> {
  const cfg = await getMarketDataConfig();
  if (cfg.provider !== REAL_PROVIDER || !cfg.twelvedataApiKey) return "clean";
  const db = await getDb();
  const now = new Date();
  const [foreign] = await db
    .select({ provider: marketBars.provider })
    .from(marketBars)
    .where(and(eq(marketBars.instrument, instrument), ne(marketBars.provider, REAL_PROVIDER)))
    .limit(1);
  const summary = await getMarketDataSummary(instrument);
  const repair = seriesRepair({ foreignProvider: Boolean(foreign), newestMs: summary.last?.getTime() ?? null, nowMs: now.getTime() });
  if (repair === "clean") return "clean";
  if (repair === "reset") {
    await resetMarketData(instrument);
    return "reset";
  }
  await db.delete(marketBars).where(and(eq(marketBars.instrument, instrument), gt(marketBars.timestamp, now)));
  const remaining = await getMarketDataSummary(instrument);
  if (!remaining.last) {
    await db.delete(marketDataSync).where(eq(marketDataSync.instrument, instrument));
    return "dropped-future";
  }
  await db
    .update(marketDataSync)
    .set({ provider: REAL_PROVIDER, syncedThrough: remaining.last, firstBarAt: remaining.first })
    .where(eq(marketDataSync.instrument, instrument));
  return "dropped-future";
}

/** Removes all stored bars, e.g. after switching from synthetic to real prices. */
export async function resetMarketData(instrument = INSTRUMENT) {
  const db = await getDb();
  await db.delete(marketBars).where(eq(marketBars.instrument, instrument));
  await db.delete(marketDataSync).where(eq(marketDataSync.instrument, instrument));
  await db.delete(marketMinutePaths).where(eq(marketMinutePaths.instrument, instrument));
  await db.delete(marketTicks).where(eq(marketTicks.instrument, instrument));
}
