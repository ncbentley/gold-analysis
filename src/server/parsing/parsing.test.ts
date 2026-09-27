import { describe, expect, it } from "vitest";
import { parseEvent, REVIEW_THRESHOLD } from "./index";

const at = new Date("2026-01-05T10:00:00Z");
const text = (rawText: string, payload: Record<string, unknown> | null = null) =>
  parseEvent("text-generic", { rawText, payload, publishedAt: at });

describe("text-generic parser", () => {
  it("parses a market signal with labelled stop and targets", () => {
    const out = text("XAUUSD BUY NOW @ 3352.40\nSL: 3346.00\nTP1: 3358.00\nTP2: 3364.00\nTP3: 3372\nConfidence: High");
    expect(out.eventType).toBe("NEW_SIGNAL");
    expect(out.signal?.direction.value).toBe("LONG");
    expect(out.signal?.entryType.value).toBe("MARKET");
    expect(out.signal?.entryMin.value).toBe(3352.4);
    expect(out.signal?.stopLoss.value).toBe(3346);
    expect(out.signal?.targets.value).toEqual([3358, 3364, 3372]);
    expect(out.signal?.sourceConfidenceText.value).toBe("High");
    expect(out.confidence).toBeGreaterThanOrEqual(REVIEW_THRESHOLD);
  });

  it("parses a sell zone with slash-separated take profits", () => {
    const out = text("GOLD SELL ZONE 3371 - 3374\nStop Loss 3380\nTake Profit 3365 / 3358\n#scalp");
    expect(out.signal?.direction.value).toBe("SHORT");
    expect(out.signal?.entryType.value).toBe("ZONE");
    expect(out.signal?.entryMin.value).toBe(3371);
    expect(out.signal?.entryMax.value).toBe(3374);
    expect(out.signal?.targets.value).toEqual([3365, 3358]);
    expect(out.signal?.signalType.value).toBe("scalp");
    expect(out.confidence).toBeGreaterThanOrEqual(REVIEW_THRESHOLD);
  });

  it("sends a signal without a stop to manual review and does not invent one", () => {
    const out = text("XAU/USD buy limit 3340\nTP 3350");
    expect(out.signal?.stopLoss.value).toBeNull();
    expect(out.confidence).toBeLessThan(REVIEW_THRESHOLD);
    expect(out.issues).toContain("Stop loss is missing.");
  });

  it("does not mistake the first price digit for a target index", () => {
    const out = text("Gold buy 3459.34 tp 3467.14");
    expect(out.signal?.targets.value).toEqual([3467.14]);
    expect(out.issues.join(" ")).not.toMatch(/plausible|wrong side/);
  });

  it("flags a stop on the wrong side of entry", () => {
    const out = text("XAUUSD BUY LIMIT 3340\nSL 3345\nTP 3350");
    expect(out.confidence).toBeLessThan(REVIEW_THRESHOLD);
    expect(out.issues.join(" ")).toMatch(/wrong side/);
  });

  it("flags a bare price as an unclear entry type", () => {
    const out = text("Gold buy 3340 sl 3334 tp 3350");
    expect(out.signal?.entryType.value).toBe("LIMIT");
    expect(out.confidence).toBeLessThan(REVIEW_THRESHOLD);
  });

  it("recognises move-stop, close, cancel and target-hit instructions", () => {
    expect(text("Move SL to entry", { reply_to_message_id: "m1" }).instruction?.moveStop?.value).toBe("ENTRY");
    expect(text("Move stop to 3355", { reply_to_message_id: "m1" }).instruction?.moveStop?.value).toBe(3355);
    expect(text("Close all now, we are done").eventType).toBe("CLOSE");
    expect(text("Cancel this one, price ran away").eventType).toBe("CANCEL");
    expect(text("TP1 hit ✅").eventType).toBe("TARGET_HIT");
    expect(text("Good morning traders").eventType).toBe("COMMENT");
  });

  it("ignores non-gold instruments", () => {
    const out = text("EURUSD BUY 1.0850 SL 1.0800");
    expect(out.eventType).toBe("COMMENT");
    expect(out.signal).toBeNull();
  });
});

describe("json-webhook parser", () => {
  it("parses a structured zone signal", () => {
    const out = parseEvent("json-webhook", {
      rawText: "",
      payload: { action: "open", symbol: "XAU/USD", side: "sell", entry: [3372, 3370], sl: 3380, tp: [3360, 3365], ref: "x1" },
      publishedAt: at,
    });
    expect(out.signal?.entryType.value).toBe("ZONE");
    expect(out.signal?.entryMin.value).toBe(3370);
    expect(out.signal?.targets.value).toEqual([3365, 3360]);
    expect(out.confidence).toBe(1);
  });

  it("parses a stop move update", () => {
    const out = parseEvent("json-webhook", { rawText: "", payload: { action: "move_sl", sl: "entry", ref: "x1" }, publishedAt: at });
    expect(out.eventType).toBe("UPDATE");
    expect(out.instruction?.moveStop?.value).toBe("ENTRY");
    expect(out.referencesExternalId).toBe("x1");
  });
});
