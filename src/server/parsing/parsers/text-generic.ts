import type { EventType } from "@/server/db/schema";
import type { FieldValue, ParseInput, ParseOutput, ParsedSignalFields, SignalParser } from "../types";
import { finalizeSignal } from "../validate";

const NUM = String.raw`(\d{3,5}(?:[.,]\d{1,3})?)`;
const num = (s: string) => Number(s.replace(",", "."));
const f = <T,>(value: T | null, confidence: number): FieldValue<T> => ({ value, confidence });

const GOLD_ALIASES: [RegExp, string][] = [
  [/\bXAU\s*\/?\s*USD\b/i, "XAUUSD"],
  [/\bGOLD\b/i, "XAUUSD"],
  [/\bXAU\s*\/?\s*EUR\b/i, "XAUEUR"],
  [/\bXAU\b/i, "XAUUSD"],
];
const OTHER_INSTRUMENT = /\b(EUR\/?USD|GBP\/?USD|USD\/?JPY|BTC(?:USD)?|NAS100|US30|XAG\/?USD|SILVER)\b/i;

function detectInstrument(text: string): FieldValue<string> {
  for (const [re, symbol] of GOLD_ALIASES) if (re.test(text)) return f(symbol, 1);
  return f("XAUUSD", 0.85);
}

function detectDirection(text: string): FieldValue<"LONG" | "SHORT"> {
  const buy = /\b(buy|long|bullish)\b/i.test(text);
  const sell = /\b(sell|short|bearish)\b/i.test(text);
  if (buy && !sell) return f("LONG", 1);
  if (sell && !buy) return f("SHORT", 1);
  if (buy && sell) return f<"LONG" | "SHORT">(null, 0.2);
  return f<"LONG" | "SHORT">(null, 0);
}

function detectEntry(text: string) {
  const zone = new RegExp(String.raw`(?:zone|area|between|entry)?\s*[:@]?\s*${NUM}\s*(?:-|–|to)\s*${NUM}`, "i");
  const firstLine = text.split("\n").find((l) => /\b(buy|sell|long|short)\b/i.test(l)) ?? text;
  const zm = firstLine.match(zone) ?? text.match(new RegExp(String.raw`entry\s*(?:zone)?\s*[:@]?\s*${NUM}\s*(?:-|–|to)\s*${NUM}`, "i"));
  if (zm) {
    const a = num(zm[1]);
    const b = num(zm[2]);
    return {
      entryType: f<"MARKET" | "LIMIT" | "ZONE">("ZONE", 1),
      entryMin: f(Math.min(a, b), 1),
      entryMax: f(Math.max(a, b), 1),
    };
  }
  const market = text.match(new RegExp(String.raw`\b(?:now|market|cmp)\b\s*(?:@|at|price)?\s*:?\s*${NUM}?`, "i"));
  const at = text.match(new RegExp(String.raw`@\s*${NUM}`));
  if (market) {
    const p = market[1] ? num(market[1]) : at ? num(at[1]) : null;
    return {
      entryType: f<"MARKET" | "LIMIT" | "ZONE">("MARKET", 0.95),
      entryMin: f(p, p === null ? 0.5 : 0.95),
      entryMax: f(p, p === null ? 0.5 : 0.95),
    };
  }
  const limit = text.match(new RegExp(String.raw`\b(?:limit|entry|enter)\b[^\d\n]{0,12}${NUM}`, "i"));
  if (limit) {
    const p = num(limit[1]);
    return { entryType: f<"MARKET" | "LIMIT" | "ZONE">("LIMIT", 0.95), entryMin: f(p, 0.95), entryMax: f(p, 0.95) };
  }
  const bare = firstLine.match(new RegExp(String.raw`\b(?:buy|sell|long|short)\b[^\d\n]{0,20}${NUM}`, "i")) ?? at;
  if (bare) {
    const p = num(bare[1]);
    // "BUY 3350" could mean a market order or a resting limit; flag for review.
    return { entryType: f<"MARKET" | "LIMIT" | "ZONE">("LIMIT", 0.6), entryMin: f(p, 0.7), entryMax: f(p, 0.7) };
  }
  return { entryType: f<"MARKET" | "LIMIT" | "ZONE">(null, 0), entryMin: f<number>(null, 0), entryMax: f<number>(null, 0) };
}

function detectStop(text: string): FieldValue<number> {
  const m = text.match(new RegExp(String.raw`\b(?:sl|s\/l|stop\s*loss|stop)\b\s*[:@=\-]?\s*${NUM}`, "i"));
  return m ? f(num(m[1]), 1) : f<number>(null, 0);
}

function detectTargets(text: string): FieldValue<number[]> {
  const labelled = [...text.matchAll(new RegExp(String.raw`\b(?:tp|t\/p|target)\s*(?:\d(?!\d))?\s*[:@=\-]?\s*${NUM}`, "gi"))].map((m) =>
    num(m[1]),
  );
  if (labelled.length) return f(labelled, 1);
  const list = text.match(new RegExp(String.raw`\b(?:take\s*profits?|targets?|tps?)\b\s*[:@=\-]?\s*((?:${NUM}\s*[,/|&]?\s*)+)`, "i"));
  if (list) {
    const values = [...list[1].matchAll(new RegExp(NUM, "g"))].map((m) => num(m[1]));
    if (values.length) return f(values, 0.95);
  }
  return f<number[]>([], 0.9);
}

function detectSignalType(text: string): FieldValue<string> {
  const tag = text.match(/#(scalp|swing|breakout|reversal|intraday|pullback|range)\b/i);
  if (tag) return f(tag[1].toLowerCase(), 1);
  const word = text.match(/\b(scalp|swing|breakout|reversal|intraday|pullback)\b/i);
  return word ? f(word[1].toLowerCase(), 0.8) : f<string>(null, 1);
}

function detectConfidenceText(text: string): FieldValue<string> {
  const m = text.match(/\b(?:confidence|risk|conviction)\s*[:\-]?\s*([a-z]+(?:\s*\/\s*\d+)?|\d+\s*\/\s*\d+)/i);
  return m ? f(m[1].trim(), 1) : f<string>(null, 1);
}

function detectInstructionEvent(text: string): ParseOutput["instruction"] & { eventType: EventType | null } {
  const t = text.toLowerCase();
  if (/\b(cancel(?:led)?|delete|void|ignore (?:the|this) (?:signal|trade))\b/.test(t)) return { eventType: "CANCEL", cancel: true };
  const be = /\b(?:move|set|put)?\s*(?:sl|stop(?:\s*loss)?)\s*(?:to|at)\s*(?:be|breakeven|break\s*even|entry)\b/.test(t) ||
    /\bsl\s*(?:=|->|→)\s*(?:be|entry)\b/.test(t);
  if (be) return { eventType: "UPDATE", moveStop: f<number | "ENTRY">("ENTRY", 1) };
  const moveTo = text.match(new RegExp(String.raw`\b(?:move|set|trail)\s*(?:sl|stop(?:\s*loss)?)\s*(?:to|at)\s*${NUM}`, "i"));
  if (moveTo) return { eventType: "UPDATE", moveStop: f<number | "ENTRY">(num(moveTo[1]), 1) };
  if (/\b(close (?:all|now|it|the trade|gold|xau\w*|positions?)|exit (?:now|all)|take (?:it|profits?) now)\b/.test(t))
    return { eventType: "CLOSE", closeAll: true };
  const tpHit = t.match(/\btp\s*(\d)\s*(?:hit|reached|done|smashed)|target\s*(\d)\s*(?:hit|reached)/);
  if (tpHit) return { eventType: "TARGET_HIT", targetHitIndex: Number(tpHit[1] ?? tpHit[2]) };
  if (/\b(sl hit|stop(?:ped)? (?:out|hit)|stop loss hit)\b/.test(t)) return { eventType: "STOP_HIT" };
  return { eventType: null };
}

export const textGenericParser: SignalParser = {
  type: "text-generic",
  version: "text-generic-v1",
  parse(input: ParseInput): ParseOutput {
    const text = input.rawText.normalize("NFKC");
    const referencesExternalId =
      typeof input.payload?.reply_to_message_id === "string" ? (input.payload.reply_to_message_id as string) : null;
    const base = { parserType: this.type, parserVersion: this.version, referencesExternalId };

    if (OTHER_INSTRUMENT.test(text) && !GOLD_ALIASES.some(([re]) => re.test(text))) {
      return { ...base, eventType: "COMMENT", signal: null, instruction: null, issues: ["Non-gold instrument; ignored."], confidence: 1 };
    }

    const direction = detectDirection(text);
    const instruction = detectInstructionEvent(text);
    const hasPrices = /\d{3,5}/.test(text);

    // A message without a trade direction is an instruction or commentary.
    if (direction.value === null && direction.confidence === 0) {
      if (instruction.eventType) {
        const { eventType, ...rest } = instruction;
        const needsRef = eventType === "UPDATE" || eventType === "CLOSE" || eventType === "CANCEL";
        const confidence = needsRef && !referencesExternalId ? 0.85 : 1;
        const issues = needsRef && !referencesExternalId ? ["Instruction does not reference a message; linked to latest open signal."] : [];
        return { ...base, eventType, signal: null, instruction: rest, issues, confidence };
      }
      return {
        ...base,
        eventType: "COMMENT",
        signal: null,
        instruction: null,
        issues: hasPrices ? ["Contains prices but no direction; treated as commentary."] : [],
        confidence: hasPrices ? 0.6 : 1,
      };
    }

    if (instruction.eventType && instruction.eventType !== "TARGET_HIT" && !detectStop(text).value) {
      const { eventType, ...rest } = instruction;
      return { ...base, eventType: eventType!, signal: null, instruction: rest, issues: [], confidence: 0.9 };
    }

    const entry = detectEntry(text);
    const fields: ParsedSignalFields = {
      instrument: detectInstrument(text),
      direction,
      entryType: entry.entryType,
      entryMin: entry.entryMin,
      entryMax: entry.entryMax,
      stopLoss: detectStop(text),
      targets: detectTargets(text),
      signalType: detectSignalType(text),
      sourceConfidenceText: detectConfidenceText(text),
    };
    const { signal, issues, confidence } = finalizeSignal(fields);
    return { ...base, eventType: "NEW_SIGNAL", signal, instruction: null, issues, confidence };
  },
};
