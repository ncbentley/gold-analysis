import { sql } from "drizzle-orm";
import { getDb } from "@/server/db";
import { marketBars, marketTicks } from "@/server/db/schema";
import { getMarketDataConfig, INSTRUMENT } from "./index";
import { applyPrint, type MinuteBar } from "./minute-bar";
import { routePrint, splitSeal } from "./minute-path";
import { maintainMinutePaths, mergeSealedPrint, sealMinute } from "./paths";

const SYMBOL = "XAU/USD";
const HEARTBEAT_MS = 10_000;
const FLUSH_MS = 1_000;
const RETRY_MAX_MS = 30_000;

interface StreamSocket {
  readyState: number;
  send(data: string): void;
  close(): void;
  addEventListener(type: string, listener: (event: { data?: unknown }) => void): void;
}

const g = globalThis as unknown as { __gsiTwelveStream?: boolean };

/** A Twelve Data price event. Timestamp may be seconds or milliseconds. */
export function readPricePrint(message: unknown): { t: number; price: number } | null {
  if (!message || typeof message !== "object") return null;
  const row = message as { event?: unknown; symbol?: unknown; price?: unknown; timestamp?: unknown };
  if (row.event !== "price" || row.symbol !== SYMBOL) return null;
  const price = Number(row.price);
  const stamp = Number(row.timestamp);
  if (!Number.isFinite(price) || !Number.isFinite(stamp)) return null;
  const t = stamp < 1e12 ? stamp * 1000 : stamp;
  return { t, price };
}

export function subscribeStatus(message: unknown): { ok: string[]; failed: string[] } | null {
  if (!message || typeof message !== "object") return null;
  const row = message as { event?: unknown; success?: unknown; fails?: unknown };
  if (row.event !== "subscribe-status") return null;
  const names = (value: unknown) => {
    if (!Array.isArray(value)) return [];
    return value.map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object" && "symbol" in item) return String((item as { symbol: unknown }).symbol);
      return JSON.stringify(item);
    });
  };
  return { ok: names(row.success), failed: names(row.fails) };
}

interface PendingTick {
  t: number;
  price: number;
  seq: number;
}

async function saveBar(bar: MinuteBar) {
  const db = await getDb();
  await db
    .insert(marketBars)
    .values({
      instrument: INSTRUMENT,
      resolution: "1m",
      timestamp: new Date(bar.t),
      open: bar.o,
      high: bar.h,
      low: bar.l,
      close: bar.c,
      volume: null,
      provider: "twelvedata",
    })
    .onConflictDoUpdate({
      target: [marketBars.instrument, marketBars.resolution, marketBars.timestamp],
      set: {
        open: sql`excluded.open`,
        high: sql`excluded.high`,
        low: sql`excluded.low`,
        close: sql`excluded.close`,
        provider: "twelvedata",
      },
    });
}

/**
 * Keeps one Twelve Data price socket open and writes each XAU/USD print plus the minute bar built from it.
 * Routine REST sync stays idle while this socket's latest bar is current. REST still fills history and a gap after a disconnect.
 */
export function startTwelveDataStream(openSocket: (url: string) => StreamSocket = (url) => new WebSocket(url) as unknown as StreamSocket) {
  if (g.__gsiTwelveStream) return;
  g.__gsiTwelveStream = true;
  void run(openSocket);
}

async function run(openSocket: (url: string) => StreamSocket) {
  const cfg = await getMarketDataConfig();
  if (cfg.provider !== "twelvedata" || !cfg.twelvedataApiKey) {
    console.log("[market] price stream idle: Twelve Data is not configured");
    g.__gsiTwelveStream = false;
    return;
  }
  const key = cfg.twelvedataApiKey;
  await maintainMinutePaths(INSTRUMENT);
  let attempt = 0;
  const connect = () => {
    const ws = openSocket(`wss://ws.twelvedata.com/v1/quotes/price?apikey=${encodeURIComponent(key)}`);
    let openBar: MinuteBar | null = null;
    let pending: PendingTick[] = [];
    let seq = 0;
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    let flush: ReturnType<typeof setInterval> | null = null;
    let writing = false;
    let dirty = false;
    let chain = Promise.resolve();
    const stopTimers = () => {
      if (heartbeat) clearInterval(heartbeat);
      if (flush) clearInterval(flush);
      heartbeat = null;
      flush = null;
    };
    const flushOpen = async () => {
      if (!openBar && !pending.length) return;
      if (writing) {
        dirty = true;
        return;
      }
      writing = true;
      const ticks = pending;
      const snapshot = openBar;
      pending = [];
      try {
        const db = await getDb();
        const receivedAt = new Date();
        await db.transaction(async (tx) => {
          if (ticks.length) {
            await tx.insert(marketTicks).values(
              ticks.map((row) => ({
                instrument: INSTRUMENT,
                at: new Date(row.t),
                seq: row.seq,
                price: row.price,
                receivedAt,
              })),
            );
          }
          if (snapshot) {
            await tx
              .insert(marketBars)
              .values({
                instrument: INSTRUMENT,
                resolution: "1m",
                timestamp: new Date(snapshot.t),
                open: snapshot.o,
                high: snapshot.h,
                low: snapshot.l,
                close: snapshot.c,
                volume: null,
                provider: "twelvedata",
              })
              .onConflictDoUpdate({
                target: [marketBars.instrument, marketBars.resolution, marketBars.timestamp],
                set: {
                  open: sql`excluded.open`,
                  high: sql`excluded.high`,
                  low: sql`excluded.low`,
                  close: sql`excluded.close`,
                  provider: "twelvedata",
                },
              });
          }
        });
      } catch (err) {
        pending = ticks.concat(pending);
        console.error("[market] price write failed:", (err as Error).message);
      } finally {
        writing = false;
        if (dirty) {
          dirty = false;
          chain = chain
            .then(() => flushOpen())
            .catch((err) => {
              console.error("[market] price write failed:", (err as Error).message);
            });
        }
      }
    };
    ws.addEventListener("open", () => {
      attempt = 0;
      ws.send(JSON.stringify({ action: "subscribe", params: { symbols: SYMBOL } }));
      heartbeat = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ action: "heartbeat" }));
      }, HEARTBEAT_MS);
      flush = setInterval(() => {
        chain = chain
          .then(() => flushOpen())
          .catch((err) => {
            console.error("[market] price write failed:", (err as Error).message);
          });
      }, FLUSH_MS);
      console.log("[market] price stream connected, subscribed to XAU/USD");
    });
    ws.addEventListener("message", (event) => {
      let message: unknown;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      const status = subscribeStatus(message);
      if (status) {
        console.log(`[market] price stream subscribe ok=${status.ok.join(",") || "none"} failed=${status.failed.join(",") || "none"}`);
        return;
      }
      const print = readPricePrint(message);
      if (!print) return;
      chain = chain
        .then(async () => {
          const action = routePrint(openBar?.t ?? null, print.t);
          if (action === "merge") {
            const merged = await mergeSealedPrint(INSTRUMENT, print.t, print.price);
            if (merged) return;
          }
          if (action === "seal" && openBar) {
            const split = splitSeal(pending, openBar.t);
            pending = split.open;
            await sealMinute(INSTRUMENT, new Date(openBar.t), split.sealed);
          }
          pending.push({ t: print.t, price: print.price, seq: seq++ });
          const next = applyPrint(openBar, print);
          openBar = next.open;
          if (next.sealed) {
            void saveBar(next.sealed).catch((err) => console.error("[market] sealed bar write failed:", (err as Error).message));
            await flushOpen();
          }
        })
        .catch((err) => {
          console.error("[market] price print failed:", (err as Error).message);
        });
    });
    const retry = () => {
      stopTimers();
      attempt += 1;
      const wait = Math.min(RETRY_MAX_MS, 1000 * 2 ** Math.min(attempt, 5));
      console.error(`[market] price stream closed, retrying in ${wait}ms`);
      setTimeout(connect, wait).unref?.();
    };
    ws.addEventListener("close", retry);
    ws.addEventListener("error", () => {
      try {
        ws.close();
      } catch {
        retry();
      }
    });
  };
  connect();
}
