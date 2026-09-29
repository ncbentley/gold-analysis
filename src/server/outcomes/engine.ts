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
  version: "outcome-v5",
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
}

const round = (n: number, dp = 4) => Math.round(n * 10 ** dp) / 10 ** dp;

/**
 * @param dataThrough epoch ms up to which market data is known to be complete.
 *   Used to decide whether an unfilled signal is expired or still pending.
 */
export function evaluateSignal(
  signal: EngineSignal,
  bars: EngineBar[],
  adjustments: EngineAdjustment[] = [],
  dataThrough: number | null = null,
  rules: OutcomeRules = OUTCOME_RULES,
): EngineOutcome {
  const dir = signal.direction === "LONG" ? 1 : -1;
  const notes: string[] = [];
  const timeline: TimelineEvent[] = [];
  const firstBarStart = Math.ceil(signal.signalTime / rules.barMs) * rules.barMs;
  const series = bars.filter((b) => b.t >= firstBarStart).sort((a, b) => a.t - b.t);
  const adj = [...adjustments].sort((a, b) => a.effectiveAt - b.effectiveAt);
  const expiry = signal.expiryTime ?? signal.signalTime + rules.defaultExpiryMinutes * 60_000;
  const lastKnown = dataThrough ?? (series.length ? series[series.length - 1].t + rules.barMs : null);

  const targets: TargetResult[] = signal.targets.map((price, i) => ({
    index: i + 1,
    price,
    hitAt: null,
    minutesFromEntry: null,
    ambiguous: false,
  }));

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
    finalStop: signal.stopLoss,
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
    targets,
    ambiguous: false,
    timeline,
    notes,
    dataThrough: lastKnown,
  };

  // ---- Phase 1: find the fill -------------------------------------------------
  let fillIdx = -1;
  let fillPrice = 0;
  let adjCursor = 0;
  let skippedFarQuote = false;
  for (let i = 0; i < series.length; i++) {
    const bar = series[i];
    if (bar.t >= expiry) {
      if (skippedFarQuote) {
        notes.push(
          `Quoted entry was more than ${rules.maxQuoteDistance} away from traded price, so it was not filled as a market order.`,
        );
      }
      timeline.push({ t: expiry, type: "EXPIRE" });
      return { ...base, classification: "EXPIRED", status: "EXPIRED" };
    }
    while (adjCursor < adj.length && adj[adjCursor].effectiveAt <= bar.t) {
      const a = adj[adjCursor++];
      if (a.type === "CANCEL" || a.type === "CLOSE") {
        timeline.push({ t: a.effectiveAt, type: "CANCEL", note: "Cancelled by source before entry" });
        return { ...base, classification: "CANCELLED", status: "CANCELLED" };
      }
      if (a.type === "MOVE_STOP" && a.stop !== "ENTRY") base.finalStop = a.stop;
    }
    if (signal.entryType === "MARKET") {
      const near = bar.h >= signal.entryMin - rules.maxQuoteDistance && bar.l <= signal.entryMax + rules.maxQuoteDistance;
      if (!near) {
        skippedFarQuote = true;
        continue;
      }
      fillIdx = i;
      fillPrice = bar.o;
      break;
    }
    // The bar has to trade the zone. A low far under a buy zone is not a fill.
    const overlaps = bar.h >= signal.entryMin && bar.l <= signal.entryMax;
    if (overlaps) {
      fillIdx = i;
      fillPrice = dir === 1 ? Math.min(bar.o, signal.entryMax) : Math.max(bar.o, signal.entryMin);
      break;
    }
  }

  if (fillIdx === -1) {
    if (skippedFarQuote) {
      notes.push(
        `Quoted entry was more than ${rules.maxQuoteDistance} away from traded price, so it was not filled as a market order.`,
      );
    }
    const pendingCancel = adj.slice(adjCursor).find((a) => a.type === "CANCEL" || a.type === "CLOSE");
    if (pendingCancel && (lastKnown === null || pendingCancel.effectiveAt <= lastKnown)) {
      timeline.push({ t: pendingCancel.effectiveAt, type: "CANCEL", note: "Cancelled by source before entry" });
      return { ...base, classification: "CANCELLED", status: "CANCELLED" };
    }
    if (lastKnown !== null && lastKnown >= expiry) {
      timeline.push({ t: expiry, type: "EXPIRE" });
      return { ...base, classification: "EXPIRED", status: "EXPIRED" };
    }
    return base;
  }

  // ---- Phase 2: manage the trade ---------------------------------------------
  const fillBar = series[fillIdx];
  const entry = fillPrice;
  const entryTime = fillBar.t;
  timeline.push({ t: entryTime, type: "ENTRY", price: round(entry) });

  let currentStop = base.finalStop;
  const risk = signal.stopLoss !== null && Math.abs(entry - signal.stopLoss) > 0 ? Math.abs(entry - signal.stopLoss) : null;
  if (signal.stopLoss === null) notes.push("No stop loss: R metrics are not computed for this signal.");
  if (signal.targets.length === 0) notes.push("No targets: the trade stays open until a stop or a source close.");

  const portionCount = Math.max(signal.targets.length, 1);
  const weight = 1 / portionCount;
  let nextTarget = 0;
  let remaining = portionCount; // portions still open
  const exits: { price: number; weight: number }[] = [];

  let best = entry;
  let worst = entry;
  const favor = (price: number) => {
    if ((price - best) * dir > 0) best = price;
  };
  const adverse = (price: number) => {
    if ((price - worst) * dir < 0) worst = price;
  };

  let exitTime: number | null = null;
  let exitReason: ExitReason | null = null;
  let ambiguous = false;
  let stopHitAt: number | null = null;

  const closeRemaining = (price: number, t: number, reason: ExitReason) => {
    if (remaining > 0) exits.push({ price, weight: weight * remaining });
    remaining = 0;
    exitTime = t;
    exitReason = reason;
  };

  const stopTouched = (bar: EngineBar) =>
    currentStop !== null && (dir === 1 ? bar.l <= currentStop : bar.h >= currentStop);
  const targetTouched = (bar: EngineBar, price: number) => (dir === 1 ? bar.h >= price : bar.l <= price);
  const targetClosedBeyond = (bar: EngineBar, price: number) => (dir === 1 ? bar.c >= price : bar.c <= price);
  const stopFillPrice = (bar: EngineBar) =>
    dir === 1 ? Math.min(bar.o, currentStop as number) : Math.max(bar.o, currentStop as number);

  const maxHoldUntil = entryTime + rules.maxHoldMinutes * 60_000;

  for (let i = fillIdx; i < series.length && remaining > 0; i++) {
    const bar = series[i];
    const isFillBar = i === fillIdx;
    // Fill at the open means the whole candle happened after entry.
    const intraBarFill = isFillBar && !(fillPrice === bar.o);

    if (!isFillBar) {
      while (adjCursor < adj.length && adj[adjCursor].effectiveAt <= bar.t) {
        const a = adj[adjCursor++];
        if (a.type === "MOVE_STOP") {
          currentStop = a.stop === "ENTRY" ? entry : a.stop;
          timeline.push({ t: a.effectiveAt, type: "MOVE_STOP", price: round(currentStop) });
        } else {
          timeline.push({ t: bar.t, type: a.type === "CLOSE" ? "CLOSE" : "CANCEL", price: round(bar.o) });
          favor(bar.o);
          adverse(bar.o);
          closeRemaining(bar.o, bar.t, a.type === "CLOSE" ? "CLOSE" : "CANCEL");
        }
      }
      if (remaining === 0) break;
      if (Number.isFinite(rules.maxHoldMinutes) && bar.t >= maxHoldUntil) {
        timeline.push({ t: bar.t, type: "TIMEOUT", price: round(bar.o) });
        closeRemaining(bar.o, bar.t, "TIMEOUT");
        break;
      }
    }

    const sHit = stopTouched(bar);
    const touched: number[] = [];
    for (let k = nextTarget; k < targets.length; k++) {
      const hit = intraBarFill ? targetClosedBeyond(bar, targets[k].price) : targetTouched(bar, targets[k].price);
      if (!hit) break;
      touched.push(k);
    }

    if (sHit && touched.length > 0) {
      ambiguous = true;
      for (const k of touched) targets[k].ambiguous = true;
      timeline.push({ t: bar.t, type: "AMBIGUOUS", note: "Stop and target both inside one 1-minute candle" });
      notes.push("Stop and target were both touched inside the same 1-minute candle; order cannot be determined.");
      exitTime = bar.t;
      break;
    }

    if (sHit) {
      const px = stopFillPrice(bar);
      stopHitAt = bar.t;
      if (intraBarFill) favor(bar.c);
      adverse(px);
      timeline.push({ t: bar.t, type: "STOP", price: round(px) });
      closeRemaining(px, bar.t, "STOP");
      break;
    }

    for (const k of touched) {
      targets[k].hitAt = bar.t;
      targets[k].minutesFromEntry = Math.round((bar.t - entryTime) / 60_000);
      exits.push({ price: targets[k].price, weight });
      remaining -= 1;
      nextTarget = k + 1;
      favor(targets[k].price);
      timeline.push({ t: bar.t, type: "TARGET", price: targets[k].price, note: `TP${k + 1}` });
    }
    if (targets.length > 0 && remaining === 0) {
      exitTime = bar.t;
      exitReason = "TARGETS";
      break;
    }

    if (intraBarFill) {
      adverse(dir === 1 ? bar.l : bar.h);
      favor(bar.c);
    } else {
      favor(dir === 1 ? bar.h : bar.l);
      adverse(dir === 1 ? bar.l : bar.h);
    }
  }

  const mfe = round((best - entry) * dir);
  const mae = round((entry - worst) * dir);

  const result: EngineOutcome = {
    ...base,
    entered: true,
    entryTime,
    entryPrice: round(entry),
    risk: risk === null ? null : round(risk),
    finalStop: currentStop,
    stopHitAt,
    bestPrice: round(best),
    worstPrice: round(worst),
    mfe,
    mae,
    mfeR: risk ? round(mfe / risk) : null,
    maeR: risk ? round(mae / risk) : null,
    targets,
    ambiguous,
  };

  if (ambiguous) {
    return {
      ...result,
      classification: "AMBIGUOUS",
      status: "MANUAL_REVIEW",
      exitTime,
      durationMinutes: exitTime !== null ? Math.round((exitTime - entryTime) / 60_000) : null,
    };
  }

  if (remaining > 0) {
    const anyHit = targets.some((t) => t.hitAt !== null);
    return { ...result, classification: "OPEN", status: anyHit ? "PARTIAL" : "ACTIVE" };
  }

  const totalWeight = exits.reduce((s, e) => s + e.weight, 0);
  const avgExit = exits.reduce((s, e) => s + e.price * e.weight, 0) / totalWeight;
  const pricePnl = exits.reduce((s, e) => s + (e.price - entry) * dir * e.weight, 0);
  const rResult = risk ? pricePnl / risk : null;

  let classification: Classification;
  if (rResult !== null) {
    classification =
      rResult > rules.breakevenBandR ? "WON" : rResult < -rules.breakevenBandR ? "LOST" : "BREAKEVEN";
  } else {
    classification =
      pricePnl > rules.breakevenBandPrice ? "WON" : pricePnl < -rules.breakevenBandPrice ? "LOST" : "BREAKEVEN";
  }

  return {
    ...result,
    classification,
    status: classification as OutcomeStatus,
    exitTime,
    exitReason,
    averageExitPrice: round(avgExit),
    pricePnl: round(pricePnl),
    rResult: rResult === null ? null : round(rResult),
    durationMinutes: exitTime !== null ? Math.round((exitTime - entryTime) / 60_000) : null,
  };
}
