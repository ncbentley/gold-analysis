/**
 * Deterministic trade replay engine.
 *
 * Pure function of (signal, adjustments, bars, rules). No I/O, no clock, no randomness.
 * Every rule here is documented in DECISIONS.md under "Outcome rules".
 * Bump OUTCOME_RULES.version whenever behaviour changes so stored outcomes can be recalculated.
 */

export type Direction = "LONG" | "SHORT";
export type EntryType = "MARKET" | "LIMIT" | "ZONE";

export interface EngineBar {
  t: number; // bar open time, epoch ms (UTC)
  o: number;
  h: number;
  l: number;
  c: number;
}

/** One stored price print. When a minute has prints, they replace the candle path. */
export interface EngineTick {
  t: number;
  price: number;
}

/** Up candle: open, low, high, close. Down candle: open, high, low, close. */
export function candlePath(bar: EngineBar): number[] {
  return bar.c >= bar.o ? [bar.o, bar.l, bar.h, bar.c] : [bar.o, bar.h, bar.l, bar.c];
}

/** Stored prints in the minute, in the order they were recorded. Otherwise the candle path. */
export function pathForBar(bar: EngineBar, ticks: EngineTick[], barMs: number): number[] {
  const end = bar.t + barMs;
  const prints = ticks.filter((tick) => tick.t >= bar.t && tick.t < end);
  if (prints.length) return prints.map((tick) => tick.price);
  return candlePath(bar);
}

export interface EngineSignal {
  direction: Direction;
  entryType: EntryType;
  entryMin: number;
  entryMax: number;
  stopLoss: number | null;
  targets: number[]; // ordered TP1..TPn
  signalTime: number;
  expiryTime: number | null;
}

export type EngineAdjustment =
  | { type: "MOVE_STOP"; effectiveAt: number; stop: number | "ENTRY" }
  | { type: "CLOSE"; effectiveAt: number }
  | { type: "CANCEL"; effectiveAt: number };

export interface OutcomeRules {
  version: string;
  barMs: number;
  defaultExpiryMinutes: number;
  maxHoldMinutes: number;
  breakevenBandR: number;
  breakevenBandPrice: number;
  /** A market quote farther than this from the bar is not a fill. */
  maxQuoteDistance: number;
}

export const OUTCOME_RULES: OutcomeRules = {
  version: "outcome-v6",
  barMs: 60_000,
  defaultExpiryMinutes: 6 * 60,
  /** A filled trade stays open until a stop, a target, or a source close. No clock exit. */
  maxHoldMinutes: Number.POSITIVE_INFINITY,
  breakevenBandR: 0.05,
  breakevenBandPrice: 0.1,
  maxQuoteDistance: 80,
};

export type Classification =
  | "PENDING"
  | "OPEN"
  | "WON"
  | "LOST"
  | "BREAKEVEN"
  | "CANCELLED"
  | "EXPIRED"
  | "AMBIGUOUS";

export type ExitReason = "TARGETS" | "STOP" | "CLOSE" | "CANCEL" | "TIMEOUT";

export type OutcomeStatus =
  | "PENDING"
  | "ACTIVE"
  | "PARTIAL"
  | "WON"
  | "LOST"
  | "BREAKEVEN"
  | "CANCELLED"
  | "EXPIRED"
  | "MANUAL_REVIEW";

export interface TimelineEvent {
  t: number;
  type: "ENTRY" | "TARGET" | "STOP" | "MOVE_STOP" | "CLOSE" | "CANCEL" | "EXPIRE" | "TIMEOUT" | "AMBIGUOUS";
  price?: number;
  note?: string;
}

export interface TargetResult {
  index: number;
  price: number;
  hitAt: number | null;
  minutesFromEntry: number | null;
  ambiguous: boolean;
}

export interface EngineOutcome {
  calcVersion: string;
  classification: Classification;
  status: OutcomeStatus;
  entered: boolean;
  entryTime: number | null;
  entryPrice: number | null;
  exitTime: number | null;
  exitReason: ExitReason | null;
  averageExitPrice: number | null;
  stopHitAt: number | null;
  finalStop: number | null;
  risk: number | null;
  rResult: number | null;
  pricePnl: number | null;
  mfe: number | null;
  mae: number | null;
  mfeR: number | null;
  maeR: number | null;
  bestPrice: number | null;
  worstPrice: number | null;
  durationMinutes: number | null;
  targets: TargetResult[];
  ambiguous: boolean;
  timeline: TimelineEvent[];
  notes: string[];
  dataThrough: number | null;
  checkpoint: ReplayCheckpoint | null;
}

export interface ReplayCheckpoint {
  barTime: number;
  phase: "seek" | "manage" | "done";
  adjCursor: number;
  skippedFarQuote: boolean;
  fillPrice: number | null;
  entryTime: number | null;
  currentStop: number | null;
  risk: number | null;
  nextTarget: number;
  remaining: number;
  exits: { price: number; weight: number }[];
  bestPrice: number | null;
  worstPrice: number | null;
  ambiguous: boolean;
  stopHitAt: number | null;
  exitTime: number | null;
  exitReason: ExitReason | null;
  targets: TargetResult[];
  timeline: TimelineEvent[];
  notes: string[];
  done: boolean;
  terminal: "EXPIRED" | "CANCELLED" | null;
}

const round = (n: number, dp = 4) => Math.round(n * 10 ** dp) / 10 ** dp;

function lowerBoundBar(bars: EngineBar[], t: number) {
  let lo = 0;
  let hi = bars.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].t < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

interface ReplayState {
  signal: EngineSignal;
  adj: EngineAdjustment[];
  dir: number;
  expiry: number;
  weight: number;
  /** Print prices keyed by the minute they belong to. Missing minutes use the candle path. */
  tickPaths: Map<number, number[]>;
  cp: ReplayCheckpoint;
}

function indexTicks(ticks: EngineTick[], barMs: number) {
  const buckets = new Map<number, number[]>();
  for (const tick of ticks) {
    const key = Math.floor(tick.t / barMs) * barMs;
    const list = buckets.get(key);
    if (list) list.push(tick.price);
    else buckets.set(key, [tick.price]);
  }
  return buckets;
}

function farQuoteNote(rules: OutcomeRules) {
  return `Quoted entry was more than ${rules.maxQuoteDistance} away from traded price, so it was not filled as a market order.`;
}

function blankCheckpoint(signal: EngineSignal): ReplayCheckpoint {
  return {
    barTime: -1,
    phase: "seek",
    adjCursor: 0,
    skippedFarQuote: false,
    fillPrice: null,
    entryTime: null,
    currentStop: signal.stopLoss,
    risk: null,
    nextTarget: 0,
    remaining: 0,
    exits: [],
    bestPrice: null,
    worstPrice: null,
    ambiguous: false,
    stopHitAt: null,
    exitTime: null,
    exitReason: null,
    targets: signal.targets.map((price, i) => ({ index: i + 1, price, hitAt: null, minutesFromEntry: null, ambiguous: false })),
    timeline: [],
    notes: [],
    done: false,
    terminal: null,
  };
}

function createReplay(signal: EngineSignal, adjustments: EngineAdjustment[], rules: OutcomeRules, ticks: EngineTick[] = []): ReplayState {
  return {
    signal,
    adj: [...adjustments].sort((a, b) => a.effectiveAt - b.effectiveAt),
    dir: signal.direction === "LONG" ? 1 : -1,
    expiry: signal.expiryTime ?? signal.signalTime + rules.defaultExpiryMinutes * 60_000,
    weight: 1 / Math.max(signal.targets.length, 1),
    tickPaths: indexTicks(ticks, rules.barMs),
    cp: blankCheckpoint(signal),
  };
}

function restoreReplay(checkpoint: ReplayCheckpoint, signal: EngineSignal, adjustments: EngineAdjustment[], rules: OutcomeRules, ticks: EngineTick[] = []): ReplayState {
  const state = createReplay(signal, adjustments, rules, ticks);
  state.cp = structuredClone(checkpoint);
  return state;
}

function crossed(from: number, to: number, level: number) {
  if (from === to) return false;
  return to > from ? from < level && level <= to : from > level && level >= to;
}

function favor(state: ReplayState, price: number) {
  const best = state.cp.bestPrice ?? price;
  if (state.cp.bestPrice === null || (price - best) * state.dir > 0) state.cp.bestPrice = price;
}

function adverse(state: ReplayState, price: number) {
  const worst = state.cp.worstPrice ?? price;
  if (state.cp.worstPrice === null || (price - worst) * state.dir < 0) state.cp.worstPrice = price;
}

function closeRemaining(state: ReplayState, price: number, t: number, reason: ExitReason) {
  if (state.cp.remaining > 0) state.cp.exits.push({ price, weight: state.weight * state.cp.remaining });
  state.cp.remaining = 0;
  state.cp.exitTime = t;
  state.cp.exitReason = reason;
  state.cp.done = true;
}

function beginFill(state: ReplayState, bar: EngineBar, fillPrice: number) {
  const { cp, signal } = state;
  cp.fillPrice = fillPrice;
  cp.entryTime = bar.t;
  cp.timeline.push({ t: bar.t, type: "ENTRY", price: round(fillPrice) });
  cp.risk = signal.stopLoss !== null && Math.abs(fillPrice - signal.stopLoss) > 0 ? Math.abs(fillPrice - signal.stopLoss) : null;
  if (signal.stopLoss === null) cp.notes.push("No stop loss: R metrics are not computed for this signal.");
  if (signal.targets.length === 0) cp.notes.push("No targets: the trade stays open until a stop or a source close.");
  cp.remaining = Math.max(signal.targets.length, 1);
  cp.nextTarget = 0;
  cp.bestPrice = fillPrice;
  cp.worstPrice = fillPrice;
  cp.phase = "manage";
}

function bookTarget(state: ReplayState, index: number, bar: EngineBar) {
  const { cp } = state;
  const target = cp.targets[index];
  target.hitAt = bar.t;
  target.minutesFromEntry = Math.round((bar.t - (cp.entryTime ?? bar.t)) / 60_000);
  cp.exits.push({ price: target.price, weight: state.weight });
  cp.remaining -= 1;
  cp.nextTarget = index + 1;
  favor(state, target.price);
  cp.timeline.push({ t: bar.t, type: "TARGET", price: target.price, note: `TP${index + 1}` });
  if (cp.targets.length > 0 && cp.remaining === 0) {
    cp.exitTime = bar.t;
    cp.exitReason = "TARGETS";
    cp.done = true;
  }
}

function bookStop(state: ReplayState, price: number, bar: EngineBar) {
  const { cp } = state;
  cp.stopHitAt = bar.t;
  adverse(state, price);
  cp.timeline.push({ t: bar.t, type: "STOP", price: round(price) });
  closeRemaining(state, price, bar.t, "STOP");
}

/** A print already through a level is a gap. A later print crosses the level at the level. */
function takeLevels(state: ReplayState, from: number, to: number, bar: EngineBar) {
  let cursor = from;
  while (!state.cp.done) {
    const stop = state.cp.currentStop;
    const target = state.cp.targets[state.cp.nextTarget];
    const hits: { kind: "stop" | "target"; price: number; index: number }[] = [];
    if (stop !== null && crossed(cursor, to, stop)) hits.push({ kind: "stop", price: stop, index: -1 });
    if (target && crossed(cursor, to, target.price)) hits.push({ kind: "target", price: target.price, index: state.cp.nextTarget });
    if (!hits.length) break;
    hits.sort((a, b) => (to > cursor ? a.price - b.price : b.price - a.price));
    const hit = hits[0];
    if (hit.kind === "stop") {
      bookStop(state, hit.price, bar);
      return;
    }
    bookTarget(state, hit.index, bar);
    cursor = hit.price;
  }
  if (!state.cp.done) {
    favor(state, to);
    adverse(state, to);
  }
}

function gapAt(state: ReplayState, price: number, bar: EngineBar) {
  const stop = state.cp.currentStop;
  if (stop !== null && (state.dir === 1 ? price <= stop : price >= stop)) {
    bookStop(state, price, bar);
    return;
  }
  while (!state.cp.done) {
    const target = state.cp.targets[state.cp.nextTarget];
    if (!target) return;
    const through = state.dir === 1 ? price >= target.price : price <= target.price;
    if (!through) return;
    bookTarget(state, state.cp.nextTarget, bar);
  }
}

function managePath(state: ReplayState, prices: number[], bar: EngineBar, rules: OutcomeRules, fromFill: boolean) {
  if (!prices.length || state.cp.done || state.cp.remaining <= 0) return;
  const { cp } = state;
  const entry = cp.fillPrice ?? prices[0];
  const entryTime = cp.entryTime ?? bar.t;
  if (!fromFill) {
    while (cp.adjCursor < state.adj.length && state.adj[cp.adjCursor].effectiveAt <= bar.t) {
      const adjustment = state.adj[cp.adjCursor++];
      if (adjustment.type === "MOVE_STOP") {
        cp.currentStop = adjustment.stop === "ENTRY" ? entry : adjustment.stop;
        cp.timeline.push({ t: adjustment.effectiveAt, type: "MOVE_STOP", price: round(cp.currentStop) });
      } else {
        const price = prices[0];
        cp.timeline.push({ t: bar.t, type: adjustment.type === "CLOSE" ? "CLOSE" : "CANCEL", price: round(price) });
        favor(state, price);
        adverse(state, price);
        closeRemaining(state, price, bar.t, adjustment.type === "CLOSE" ? "CLOSE" : "CANCEL");
      }
    }
    if (cp.remaining === 0) return;
    if (Number.isFinite(rules.maxHoldMinutes) && bar.t >= entryTime + rules.maxHoldMinutes * 60_000) {
      cp.timeline.push({ t: bar.t, type: "TIMEOUT", price: round(prices[0]) });
      closeRemaining(state, prices[0], bar.t, "TIMEOUT");
      return;
    }
  }
  gapAt(state, prices[0], bar);
  for (let i = 1; i < prices.length && !cp.done; i++) takeLevels(state, prices[i - 1], prices[i], bar);
}

function zoneTouch(from: number, to: number, lo: number, hi: number): number | null {
  if (to === from) return null;
  if (to > from) return from < lo && to >= lo ? lo : null;
  return from > hi && to <= hi ? hi : null;
}

function seekPath(state: ReplayState, prices: number[], bar: EngineBar, rules: OutcomeRules) {
  const { signal } = state;
  const lo = signal.entryMin;
  const hi = signal.entryMax;
  for (let i = 0; i < prices.length && state.cp.phase === "seek"; i++) {
    const price = prices[i];
    if (price >= lo && price <= hi) {
      beginFill(state, bar, price);
      managePath(state, prices.slice(i), bar, rules, true);
      return;
    }
    if (i + 1 < prices.length) {
      const touch = zoneTouch(price, prices[i + 1], lo, hi);
      if (touch !== null) {
        beginFill(state, bar, touch);
        managePath(state, [touch, ...prices.slice(i + 1)], bar, rules, true);
        return;
      }
    }
  }
}

function stepBar(state: ReplayState, bar: EngineBar, rules: OutcomeRules): ReplayState {
  const { cp, signal } = state;
  cp.barTime = bar.t;
  if (cp.done) return state;
  const path = state.tickPaths.get(bar.t) ?? candlePath(bar);
  if (cp.phase === "manage") {
    if (cp.remaining > 0) managePath(state, path, bar, rules, false);
    return state;
  }

  if (bar.t >= state.expiry) {
    if (cp.skippedFarQuote) cp.notes.push(farQuoteNote(rules));
    cp.timeline.push({ t: state.expiry, type: "EXPIRE" });
    cp.done = true;
    cp.terminal = "EXPIRED";
    return state;
  }
  while (cp.adjCursor < state.adj.length && state.adj[cp.adjCursor].effectiveAt <= bar.t) {
    const a = state.adj[cp.adjCursor++];
    if (a.type === "CANCEL" || a.type === "CLOSE") {
      cp.timeline.push({ t: a.effectiveAt, type: "CANCEL", note: "Cancelled by source before entry" });
      cp.done = true;
      cp.terminal = "CANCELLED";
      return state;
    }
    if (a.type === "MOVE_STOP" && a.stop !== "ENTRY") cp.currentStop = a.stop;
  }
  if (signal.entryType === "MARKET") {
    const near = bar.h >= signal.entryMin - rules.maxQuoteDistance && bar.l <= signal.entryMax + rules.maxQuoteDistance;
    if (!near) {
      cp.skippedFarQuote = true;
      return state;
    }
    const open = path[0] ?? bar.o;
    beginFill(state, bar, open);
    managePath(state, path.length ? path : [open], bar, rules, true);
    return state;
  }
  if (path.length) seekPath(state, path, bar, rules);
  return state;
}

function snapshot(cp: ReplayCheckpoint): ReplayCheckpoint {
  return structuredClone(cp);
}

function finishReplay(state: ReplayState, dataThrough: number | null, rules: OutcomeRules): EngineOutcome {
  const { cp, signal } = state;
  const base: EngineOutcome = {
    calcVersion: rules.version,
    classification: "PENDING",
    status: "PENDING",
    entered: false,
    entryTime: null,
    entryPrice: null,
    exitTime: null,
    exitReason: null,
    averageExitPrice: null,
    stopHitAt: null,
    finalStop: cp.currentStop,
    risk: null,
    rResult: null,
    pricePnl: null,
    mfe: null,
    mae: null,
    mfeR: null,
    maeR: null,
    bestPrice: null,
    worstPrice: null,
    durationMinutes: null,
    targets: cp.targets,
    ambiguous: false,
    timeline: cp.timeline,
    notes: cp.notes,
    dataThrough,
    checkpoint: snapshot(cp),
  };
  if (cp.terminal === "EXPIRED") return { ...base, classification: "EXPIRED", status: "EXPIRED" };
  if (cp.terminal === "CANCELLED") return { ...base, classification: "CANCELLED", status: "CANCELLED" };
  if (cp.phase === "seek") {
    if (cp.skippedFarQuote && !cp.notes.includes(farQuoteNote(rules))) cp.notes.push(farQuoteNote(rules));
    const pendingCancel = state.adj.slice(cp.adjCursor).find((a) => a.type === "CANCEL" || a.type === "CLOSE");
    if (pendingCancel && (dataThrough === null || pendingCancel.effectiveAt <= dataThrough)) {
      cp.timeline.push({ t: pendingCancel.effectiveAt, type: "CANCEL", note: "Cancelled by source before entry" });
      cp.terminal = "CANCELLED";
      base.checkpoint = snapshot(cp);
      return { ...base, classification: "CANCELLED", status: "CANCELLED" };
    }
    if (dataThrough !== null && dataThrough >= state.expiry) {
      cp.timeline.push({ t: state.expiry, type: "EXPIRE" });
      cp.terminal = "EXPIRED";
      base.checkpoint = snapshot(cp);
      return { ...base, classification: "EXPIRED", status: "EXPIRED" };
    }
    base.checkpoint = snapshot(cp);
    return base;
  }

  const entry = cp.fillPrice ?? 0;
  const entryTime = cp.entryTime ?? 0;
  const best = cp.bestPrice ?? entry;
  const worst = cp.worstPrice ?? entry;
  const mfe = round((best - entry) * state.dir);
  const mae = round((entry - worst) * state.dir);
  const risk = cp.risk;
  const result: EngineOutcome = {
    ...base,
    entered: true,
    entryTime,
    entryPrice: round(entry),
    risk: risk === null ? null : round(risk),
    finalStop: cp.currentStop,
    stopHitAt: cp.stopHitAt,
    bestPrice: round(best),
    worstPrice: round(worst),
    mfe,
    mae,
    mfeR: risk ? round(mfe / risk) : null,
    maeR: risk ? round(mae / risk) : null,
    targets: cp.targets,
    ambiguous: cp.ambiguous,
  };
  if (cp.ambiguous) {
    return {
      ...result,
      classification: "AMBIGUOUS",
      status: "MANUAL_REVIEW",
      exitTime: cp.exitTime,
      durationMinutes: cp.exitTime !== null ? Math.round((cp.exitTime - entryTime) / 60_000) : null,
    };
  }
  if (cp.remaining > 0) {
    const anyHit = cp.targets.some((t) => t.hitAt !== null);
    return { ...result, classification: "OPEN", status: anyHit ? "PARTIAL" : "ACTIVE" };
  }
  const totalWeight = cp.exits.reduce((s, e) => s + e.weight, 0);
  const avgExit = cp.exits.reduce((s, e) => s + e.price * e.weight, 0) / totalWeight;
  const pricePnl = cp.exits.reduce((s, e) => s + (e.price - entry) * state.dir * e.weight, 0);
  const rResult = risk ? pricePnl / risk : null;
  let classification: Classification;
  if (rResult !== null) {
    classification = rResult > rules.breakevenBandR ? "WON" : rResult < -rules.breakevenBandR ? "LOST" : "BREAKEVEN";
  } else {
    classification = pricePnl > rules.breakevenBandPrice ? "WON" : pricePnl < -rules.breakevenBandPrice ? "LOST" : "BREAKEVEN";
  }
  return {
    ...result,
    classification,
    status: classification as OutcomeStatus,
    exitTime: cp.exitTime,
    exitReason: cp.exitReason,
    averageExitPrice: round(avgExit),
    pricePnl: round(pricePnl),
    rResult: rResult === null ? null : round(rResult),
    durationMinutes: cp.exitTime !== null ? Math.round((cp.exitTime - entryTime) / 60_000) : null,
  };
}

/**
 * @param dataThrough epoch ms up to which market data is known to be complete.
 *   Bars after this moment are ignored. Also decides whether an unfilled signal is expired or still pending.
 */
export function evaluateSignal(
  signal: EngineSignal,
  bars: EngineBar[],
  adjustments: EngineAdjustment[] = [],
  dataThrough: number | null = null,
  rules: OutcomeRules = OUTCOME_RULES,
  presorted = false,
  ticks: EngineTick[] = [],
): EngineOutcome {
  const firstBarStart = Math.ceil(signal.signalTime / rules.barMs) * rules.barMs;
  const series = presorted ? bars : bars.filter((b) => b.t >= firstBarStart).sort((a, b) => a.t - b.t);
  const origin = presorted ? lowerBoundBar(bars, firstBarStart) : 0;
  const lastBar = origin < series.length ? series[series.length - 1] : undefined;
  const lastKnown = dataThrough ?? (lastBar ? lastBar.t + rules.barMs : null);
  let state = createReplay(signal, adjustments, rules, ticks);
  for (let i = origin; i < series.length; i++) {
    // dataThrough is the last moment that counts. A later bar is not a fill.
    if (dataThrough !== null && series[i].t > dataThrough) continue;
    if (state.cp.done) break;
    state = stepBar(state, series[i], rules);
  }
  return finishReplay(state, lastKnown, rules);
}

export function advanceFromCheckpoint(
  signal: EngineSignal,
  checkpoint: ReplayCheckpoint,
  bars: EngineBar[],
  adjustments: EngineAdjustment[],
  dataThrough: number | null,
  rules: OutcomeRules = OUTCOME_RULES,
  ticks: EngineTick[] = [],
): EngineOutcome {
  let state = restoreReplay(checkpoint, signal, adjustments, rules, ticks);
  for (const bar of bars) {
    if (dataThrough !== null && bar.t > dataThrough) continue;
    if (bar.t <= checkpoint.barTime || state.cp.done) continue;
    state = stepBar(state, bar, rules);
  }
  return finishReplay(state, dataThrough, rules);
}
