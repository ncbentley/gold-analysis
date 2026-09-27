import { describe, expect, it } from "vitest";
import { evaluateSignal, type EngineBar, type EngineSignal } from "./engine";

const T0 = Date.UTC(2026, 0, 5, 10, 0); // Monday 10:00 UTC
const min = (n: number) => T0 + n * 60_000;

/** Build bars from [o, h, l, c] tuples, one per minute starting at T0. */
function bars(...ohlc: [number, number, number, number][]): EngineBar[] {
  return ohlc.map(([o, h, l, c], i) => ({ t: min(i), o, h, l, c }));
}

const longZone: EngineSignal = {
  direction: "LONG",
  entryType: "ZONE",
  entryMin: 99,
  entryMax: 100,
  stopLoss: 95,
  targets: [105, 110],
  signalTime: T0,
  expiryTime: null,
};

describe("entry", () => {
  it("does not enter when price never reaches the zone", () => {
    const out = evaluateSignal(longZone, bars([103, 104, 101, 102], [102, 103, 101, 102]));
    expect(out.entered).toBe(false);
    expect(out.classification).toBe("PENDING");
    expect(out.status).toBe("PENDING");
  });

  it("fills a long zone at the top of the zone when price trades down into it", () => {
    const out = evaluateSignal(longZone, bars([102, 102, 99.5, 100.5]));
    expect(out.entered).toBe(true);
    expect(out.entryPrice).toBe(100);
    expect(out.entryTime).toBe(min(0));
  });

  it("fills at the open when the bar gaps through the zone", () => {
    const out = evaluateSignal(longZone, bars([98, 99, 97, 98]));
    expect(out.entryPrice).toBe(98);
  });

  it("fills a short limit when price trades up to it", () => {
    const out = evaluateSignal(
      { ...longZone, direction: "SHORT", entryType: "LIMIT", entryMin: 100, entryMax: 100, stopLoss: 105, targets: [95] },
      bars([98, 100.2, 97.9, 99]),
    );
    expect(out.entryPrice).toBe(100);
  });

  it("fills market orders at the open of the first bar at or after the signal time", () => {
    const out = evaluateSignal(
      { ...longZone, entryType: "MARKET", signalTime: T0 + 30_000 },
      bars([90, 91, 89, 90], [101, 102, 100.5, 101]),
    );
    expect(out.entryTime).toBe(min(1));
    expect(out.entryPrice).toBe(101);
  });

  it("expires when the signal is not filled before the expiry time", () => {
    const out = evaluateSignal(
      { ...longZone, expiryTime: min(2) },
      bars([103, 104, 101, 102], [102, 103, 101, 102], [101, 101, 99, 100]),
    );
    expect(out.classification).toBe("EXPIRED");
    expect(out.status).toBe("EXPIRED");
  });

  it("expires using dataThrough when bars stop before expiry is reached", () => {
    const out = evaluateSignal({ ...longZone, expiryTime: min(5) }, bars([103, 104, 101, 102]), [], min(10));
    expect(out.classification).toBe("EXPIRED");
  });

  it("stays pending when data does not yet cover the expiry time", () => {
    const out = evaluateSignal({ ...longZone, expiryTime: min(60) }, bars([103, 104, 101, 102]), [], min(1));
    expect(out.classification).toBe("PENDING");
  });
});

describe("targets and stops", () => {
  it("wins with equal-weight partials when all targets are reached", () => {
    const out = evaluateSignal(
      longZone,
      bars([101, 101, 100, 100.5], [100.5, 105.5, 100.2, 105], [105, 110.5, 104, 110]),
    );
    expect(out.classification).toBe("WON");
    expect(out.exitReason).toBe("TARGETS");
    // risk = 5; TP1 = +1R, TP2 = +2R; equal weights -> 1.5R
    expect(out.rResult).toBe(1.5);
    expect(out.targets.map((t) => t.minutesFromEntry)).toEqual([1, 2]);
    expect(out.durationMinutes).toBe(2);
  });

  it("loses -1R when the stop is hit before any target", () => {
    const out = evaluateSignal(longZone, bars([101, 101, 100, 100.5], [100.5, 101, 94, 94.5]));
    expect(out.classification).toBe("LOST");
    expect(out.exitReason).toBe("STOP");
    expect(out.rResult).toBe(-1);
    expect(out.stopHitAt).toBe(min(1));
  });

  it("exits at the open when a candle gaps through the stop (slippage is recorded)", () => {
    const out = evaluateSignal(longZone, bars([101, 101, 100, 100.5], [93, 94, 92, 93]));
    expect(out.averageExitPrice).toBe(93);
    expect(out.rResult).toBe(-1.4);
  });

  it("combines a partial target with a stop on the remainder", () => {
    const out = evaluateSignal(
      longZone,
      bars([101, 101, 100, 100.5], [100.5, 105.2, 100.2, 104], [104, 104, 94, 95]),
    );
    // TP1 +1R on half, stop -1R on half -> 0R -> breakeven
    expect(out.rResult).toBe(0);
    expect(out.classification).toBe("BREAKEVEN");
    expect(out.targets[0].hitAt).toBe(min(1));
    expect(out.targets[1].hitAt).toBeNull();
  });

  it("reports PARTIAL while open with at least one target reached", () => {
    const out = evaluateSignal(longZone, bars([101, 101, 100, 100.5], [100.5, 105.2, 100.2, 104]));
    expect(out.classification).toBe("OPEN");
    expect(out.status).toBe("PARTIAL");
  });

  it("marks the outcome ambiguous when stop and target share one candle", () => {
    const out = evaluateSignal(longZone, bars([101, 101, 100, 100.5], [100.5, 106, 94, 100]));
    expect(out.classification).toBe("AMBIGUOUS");
    expect(out.status).toBe("MANUAL_REVIEW");
    expect(out.ambiguous).toBe(true);
    expect(out.rResult).toBeNull();
    expect(out.targets[0].ambiguous).toBe(true);
  });

  it("counts a stop on the intra-bar fill candle because price must pass entry first", () => {
    const out = evaluateSignal(longZone, bars([102, 102, 94, 95]));
    expect(out.classification).toBe("LOST");
    expect(out.rResult).toBe(-1);
  });

  it("does not credit a target touched on an intra-bar fill candle unless it closes beyond it", () => {
    const touchedOnly = evaluateSignal(longZone, bars([102, 106, 100, 101]));
    expect(touchedOnly.targets[0].hitAt).toBeNull();
    const closedBeyond = evaluateSignal(longZone, bars([102, 106, 100, 105.5]));
    expect(closedBeyond.targets[0].hitAt).toBe(min(0));
  });
});

describe("source adjustments", () => {
  it("applies a move-stop-to-entry instruction from its effective time", () => {
    const out = evaluateSignal(
      longZone,
      bars([101, 101, 100, 100.5], [100.5, 105.2, 100.2, 104], [104, 104, 99.5, 99.8]),
      [{ type: "MOVE_STOP", effectiveAt: min(2), stop: "ENTRY" }],
    );
    // TP1 +1R on half; remainder stopped at entry (0R) -> +0.5R
    expect(out.rResult).toBe(0.5);
    expect(out.classification).toBe("WON");
    expect(out.finalStop).toBe(100);
  });

  it("cancels before entry", () => {
    const out = evaluateSignal(longZone, bars([103, 104, 101, 102], [102, 103, 99, 100]), [
      { type: "CANCEL", effectiveAt: min(1) },
    ]);
    expect(out.classification).toBe("CANCELLED");
    expect(out.entered).toBe(false);
  });

  it("closes an open trade at the next bar open after a close instruction", () => {
    const out = evaluateSignal(longZone, bars([101, 101, 100, 100.5], [100.5, 103, 100.2, 102.5], [102.5, 103, 102, 102]), [
      { type: "CLOSE", effectiveAt: min(2) },
    ]);
    expect(out.exitReason).toBe("CLOSE");
    expect(out.averageExitPrice).toBe(102.5);
    expect(out.rResult).toBe(0.5);
  });
});

describe("missing fields", () => {
  it("evaluates signals without a stop but leaves R metrics empty", () => {
    const out = evaluateSignal(
      { ...longZone, stopLoss: null, targets: [105] },
      bars([101, 101, 100, 100.5], [100.5, 105.5, 100.2, 105]),
    );
    expect(out.classification).toBe("WON");
    expect(out.rResult).toBeNull();
    expect(out.pricePnl).toBe(5);
    expect(out.notes.join(" ")).toMatch(/No stop loss/);
  });

  it("times out signals without targets after the maximum hold", () => {
    const out = evaluateSignal(
      { ...longZone, targets: [] },
      bars([101, 101, 100, 100.5], [100.5, 102, 100.2, 101.5], [101.5, 103, 101, 102]),
      [],
      null,
      { version: "test", barMs: 60_000, defaultExpiryMinutes: 60, maxHoldMinutes: 2, breakevenBandR: 0.05, breakevenBandPrice: 0.1 },
    );
    expect(out.exitReason).toBe("TIMEOUT");
    expect(out.averageExitPrice).toBe(101.5);
    expect(out.rResult).toBe(0.3);
  });
});

describe("excursions", () => {
  it("measures MFE and MAE from entry to exit in price and R", () => {
    const out = evaluateSignal(
      longZone,
      bars([101, 101, 100, 100.5], [100.5, 103, 97.5, 102], [102, 105.1, 101, 105], [105, 110.2, 104, 110]),
    );
    expect(out.mae).toBe(2.5);
    expect(out.maeR).toBe(0.5);
    expect(out.mfe).toBe(10);
    expect(out.mfeR).toBe(2);
    expect(out.worstPrice).toBe(97.5);
    expect(out.bestPrice).toBe(110);
  });

  it("is deterministic for identical input", () => {
    const b = bars([101, 101, 100, 100.5], [100.5, 105.5, 100.2, 105]);
    expect(evaluateSignal(longZone, b)).toEqual(evaluateSignal(longZone, b));
  });
});
