import { isGoldMarketOpen, type MarketDataProvider, type ProviderBar } from "./provider";

/**
 * Deterministic synthetic XAU/USD minute bars. The same timestamp always yields the same bar,
 * so replays and tests are reproducible. Price is a mean-reverting random walk with
 * regime-based drift and session-dependent volatility, anchored at ANCHOR.
 */
const ANCHOR = Date.UTC(2026, 0, 4, 22, 0); // Sunday open
const ANCHOR_PRICE = 3400;
const MINUTE = 60_000;

function hash32(n: number, salt: number) {
  let x = (n ^ (salt * 0x9e3779b9)) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b) >>> 0;
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

function gaussian(n: number, salt: number) {
  const u = Math.max(hash32(n, salt), 1e-9);
  const v = hash32(n, salt + 101);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function sessionVol(t: Date) {
  const h = t.getUTCHours();
  if (h >= 12 && h < 17) return 0.62; // New York
  if (h >= 7 && h < 12) return 0.5; // London
  return 0.3;
}

const DAY = 86_400_000;
/** Price at each day boundary since ANCHOR, so walks can resume without replaying from the anchor. */
const checkpoints = new Map<number, number>([[ANCHOR, ANCHOR_PRICE]]);

function nearestCheckpoint(fromMs: number): [number, number] {
  let t = ANCHOR + Math.floor(Math.max(0, fromMs - ANCHOR) / DAY) * DAY;
  while (t > ANCHOR && !checkpoints.has(t)) t -= DAY;
  return [t, checkpoints.get(t)!];
}

function* walk(fromMs: number, untilMs: number): Generator<ProviderBar> {
  const [start, startPrice] = nearestCheckpoint(fromMs);
  let price = startPrice;
  for (let t = start; t < untilMs; t += MINUTE) {
    if ((t - ANCHOR) % DAY === 0 && !checkpoints.has(t)) checkpoints.set(t, price);
    const date = new Date(t);
    if (!isGoldMarketOpen(date)) continue;
    const i = (t - ANCHOR) / MINUTE;
    const regime = Math.floor(i / 360);
    const drift = (hash32(regime, 7) - 0.5) * 0.12;
    const vol = sessionVol(date) * (0.7 + hash32(Math.floor(i / 90), 13) * 0.8);
    const reversion = (ANCHOR_PRICE - price) * 0.00004;
    const open = price;
    const close = open + drift + reversion + gaussian(i, 1) * vol;
    const high = Math.max(open, close) + Math.abs(gaussian(i, 2)) * vol * 0.55;
    const low = Math.min(open, close) - Math.abs(gaussian(i, 3)) * vol * 0.55;
    price = close;
    const r = (x: number) => Math.round(x * 100) / 100;
    yield {
      timestamp: date,
      open: r(open),
      high: r(high),
      low: r(low),
      close: r(close),
      volume: Math.round(40 + hash32(i, 5) * 160 * (vol / 0.4)),
    };
  }
}

export const mockMarketDataProvider: MarketDataProvider = {
  name: "mock-xauusd",
  async fetchMinuteBars(instrument, from, to) {
    if (instrument !== "XAUUSD") return [];
    const out: ProviderBar[] = [];
    for (const bar of walk(from.getTime(), to.getTime())) {
      if (bar.timestamp.getTime() >= from.getTime()) out.push(bar);
    }
    return out;
  },
};
