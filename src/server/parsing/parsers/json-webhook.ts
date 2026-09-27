import type { EventType } from "@/server/db/schema";
import type { ParseInput, ParseOutput, SignalParser } from "../types";
import { finalizeSignal } from "../validate";

/**
 * Structured webhook payloads, e.g.
 * { "action": "open", "symbol": "XAUUSD", "side": "buy", "entry": [3340, 3342], "sl": 3334, "tp": [3350, 3360], "ref": "abc" }
 */
export const jsonWebhookParser: SignalParser = {
  type: "json-webhook",
  version: "json-webhook-v1",
  parse(input: ParseInput): ParseOutput {
    const p = input.payload ?? {};
    const base = {
      parserType: this.type,
      parserVersion: this.version,
      referencesExternalId: typeof p.ref === "string" ? p.ref : null,
    };
    const action = String(p.action ?? "open").toLowerCase();
    const actionMap: Record<string, EventType> = {
      open: "NEW_SIGNAL",
      new: "NEW_SIGNAL",
      update: "UPDATE",
      move_sl: "UPDATE",
      cancel: "CANCEL",
      close: "CLOSE",
      tp_hit: "TARGET_HIT",
      sl_hit: "STOP_HIT",
      comment: "COMMENT",
    };
    const eventType = actionMap[action];
    if (!eventType) {
      return { ...base, eventType: "COMMENT", signal: null, instruction: null, issues: [`Unknown action "${action}".`], confidence: 0.2 };
    }
    if (eventType !== "NEW_SIGNAL") {
      const sl = p.sl === "entry" || p.sl === "be" ? "ENTRY" : typeof p.sl === "number" ? p.sl : null;
      return {
        ...base,
        eventType,
        signal: null,
        instruction: {
          moveStop: eventType === "UPDATE" && sl !== null ? { value: sl, confidence: 1 } : undefined,
          closeAll: eventType === "CLOSE",
          cancel: eventType === "CANCEL",
          targetHitIndex: typeof p.tp_index === "number" ? p.tp_index : null,
        },
        issues: base.referencesExternalId ? [] : ["Missing ref; linked to latest open signal."],
        confidence: base.referencesExternalId ? 1 : 0.85,
      };
    }

    const side = String(p.side ?? "").toLowerCase();
    const direction = side === "buy" || side === "long" ? "LONG" : side === "sell" || side === "short" ? "SHORT" : null;
    const entry = Array.isArray(p.entry) ? p.entry.map(Number) : typeof p.entry === "number" ? [p.entry] : [];
    const entryType = p.order_type === "market" ? "MARKET" : entry.length === 2 ? "ZONE" : "LIMIT";
    const symbol = typeof p.symbol === "string" ? p.symbol.replace("/", "").toUpperCase() : null;
    const { signal, issues, confidence } = finalizeSignal({
      instrument: { value: symbol ?? "XAUUSD", confidence: symbol ? 1 : 0.85 },
      direction: { value: direction, confidence: direction ? 1 : 0 },
      entryType: { value: entryType, confidence: 1 },
      entryMin: { value: entry.length ? Math.min(...entry) : null, confidence: entry.length ? 1 : 0 },
      entryMax: { value: entry.length ? Math.max(...entry) : null, confidence: entry.length ? 1 : 0 },
      stopLoss: { value: typeof p.sl === "number" ? p.sl : null, confidence: typeof p.sl === "number" ? 1 : 0 },
      targets: { value: Array.isArray(p.tp) ? p.tp.map(Number) : [], confidence: 1 },
      signalType: { value: typeof p.type === "string" ? p.type : null, confidence: 1 },
      sourceConfidenceText: { value: typeof p.confidence === "string" ? p.confidence : null, confidence: 1 },
    });
    return { ...base, eventType, signal, instruction: null, issues, confidence };
  },
};
