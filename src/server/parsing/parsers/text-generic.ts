import type { EventType } from "@/server/db/schema";
import { withInferredDirection } from "../direction";
import { expandShortTail } from "../quote-sanity";
import type { FieldValue, ParseInput, ParseOutput, ParsedSignalFields, SignalParser } from "../types";
import { finalizeSignal } from "../validate";

const NUM = String.raw`(\d{3,5}(?:[.,]\d{1,3})?)`;
/** Emoji, punctuation, and the word "limit" may sit between a label and its price. */
const GAP = String.raw`(?:\s|[^A-Za-z0-9\n])*(?:limit)?(?:\s|[^A-Za-z0-9\n])*`;
const TARGET_LABEL = String.raw`\b(?:tp|t\/p|target)\s*(?:\d(?!\d))?${GAP}(?:${NUM}(?:\s*[/|,]\s*${NUM})*|\bopen\b)`;
const STOP_LABEL = String.raw`\b(?:sl|s\/l|stop\s*loss|stop)\b${GAP}${NUM}`;
const num = (s: string) => Number(s.replace(",", "."));
const f = <T,>(value: T | null, confidence: number): FieldValue<T> => ({ value, confidence });

function isGoldLevel(n: number) {
  return n >= 1000 && n <= 20_000;
}

/** Text from the direction word up to the first stop or target label. */
function entryWindow(text: string) {
  const dir = text.match(/\b(?:buy(?:ing)?|sell(?:ing)?|long|short|bullish|bearish)\b/i);
  const slice = text.slice(dir?.index ?? 0, (dir?.index ?? 0) + 140);
  return slice.split(/\b(?:tp\d?|t\/p|targets?|take\s*profits?|sl|s\/l|stop(?:\s*loss)?)\b/i)[0] ?? slice;
}

function pairZone(text: string): [number, number] | null {
  const slash = text.match(/\b(\d{3,5}(?:\.\d{1,2})?)\s*\/\s*(\d{3,5}(?:\.\d{1,2})?)\b/);
  if (slash) {
    const a = num(slash[1]);
    const b = num(slash[2]);
    if (isGoldLevel(a) && isGoldLevel(b)) return [a, b];
  }
  const dotted = text.match(/\b(\d{4})\.(\d{4})\b/);
  if (dotted) {
    const a = Number(dotted[1]);
    const b = Number(dotted[2]);
    if (isGoldLevel(a) && isGoldLevel(b)) return [a, b];
  }
  const dash = text.match(new RegExp(String.raw`${NUM}\s*(?:-|–|to)\s*${NUM}`, "i"));
  if (dash) {
    const a = num(dash[1]);
    const b = num(dash[2]);
    if (isGoldLevel(a) && isGoldLevel(b)) return [a, b];
  }
  const short = text.match(/\b(\d{4}(?:\.\d{1,2})?)\s*[-–]\s*(\d{1,2})(?!\d)/);
  if (short) {
    const anchor = Number(short[1]);
    const other = expandShortTail(anchor, Number(short[2]));
    if (other !== null) return [anchor, other];
  }
  return null;
}

function hasGoldPrice(text: string) {
  return [...text.matchAll(new RegExp(NUM, "g"))].some((m) => isGoldLevel(num(m[1])));
}

function isResultPost(text: string) {
  return /\b(tp\s*\d\s*(?:hit|reached|done|smashed)|full\s+targets?(?:\s+hit)?|pips?\s*(?:profit|done)|running\s+\d+\+?\s*pips?|profit\s+done)\b/i.test(text);
}

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
  const buy = /\b(buy(?:ing)?|long|bullish)\b/i.test(text);
  const sell = /\b(sell(?:ing)?|short|bearish)\b/i.test(text);
  if (buy && !sell) return f("LONG", 1);
  if (sell && !buy) return f("SHORT", 1);
  if (buy && sell) return f<"LONG" | "SHORT">(null, 0.2);
  return f<"LONG" | "SHORT">(null, 0);
}

function detectEntry(text: string) {
  const zoned = pairZone(entryWindow(text));
  if (zoned) {
    const [a, b] = zoned;
    return {
      entryType: f<"MARKET" | "LIMIT" | "ZONE">("ZONE", 1),
      entryMin: f(Math.min(a, b), 1),
      entryMax: f(Math.max(a, b), 1),
    };
  }
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
  const market = text.match(new RegExp(String.raw`\b(?:now|market|cmp)\b[^\d\n]{0,24}${NUM}`, "i"));
  const at = text.match(new RegExp(String.raw`@\s*${NUM}`));
  if (market && isGoldLevel(num(market[1]))) {
    const p = num(market[1]);
    return {
      entryType: f<"MARKET" | "LIMIT" | "ZONE">("MARKET", 0.95),
      entryMin: f(p, 0.95),
      entryMax: f(p, 0.95),
    };
  }
  if (/\b(?:now|market|cmp)\b/i.test(text)) {
    const p = at && isGoldLevel(num(at[1])) ? num(at[1]) : null;
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
    return { entryType: f<"MARKET" | "LIMIT" | "ZONE">("LIMIT", 0.9), entryMin: f(p, 0.9), entryMax: f(p, 0.9) };
  }
  return leadingEntry(text);
}

/** First gold price before a stop or target label, for posts that never say buy or sell. */
function leadingEntry(text: string) {
  const head = text.split(/\b(?:tp\d?|t\/p|targets?|take\s*profits?|sl|s\/l|stop(?:\s*loss)?)\b/i)[0] ?? text;
  const zoned = pairZone(head);
  if (zoned) {
    const [a, b] = zoned;
    return {
      entryType: f<"MARKET" | "LIMIT" | "ZONE">("ZONE", 0.95),
      entryMin: f(Math.min(a, b), 0.95),
      entryMax: f(Math.max(a, b), 0.95),
    };
  }
  const bare = head.match(new RegExp(NUM));
  if (bare) {
    const price = num(bare[1]);
    if (isGoldLevel(price)) {
      return { entryType: f<"MARKET" | "LIMIT" | "ZONE">("LIMIT", 0.9), entryMin: f(price, 0.9), entryMax: f(price, 0.9) };
    }
  }
  return { entryType: f<"MARKET" | "LIMIT" | "ZONE">(null, 0), entryMin: f<number>(null, 0), entryMax: f<number>(null, 0) };
}

function detectStop(text: string): FieldValue<number> {
  const m = text.match(new RegExp(STOP_LABEL, "i"));
  return m ? f(num(m[1]), 1) : f<number>(null, 1);
}

/** These channels quote gold pips as 0.10 (100 pips = $10). */
const GOLD_PIP = 0.1;

function detectPipDistances(text: string): number[] | null {
  const m = text.match(/\b(?:tp\d?|t\/p|targets?|take\s*profits?)\b\s*[:@=\-]?\s*(\d{2,4})\s*\/\s*(\d{2,4})\s*pips?\b/i);
  if (!m) return null;
  return [Number(m[1]), Number(m[2])];
}

function detectTargets(text: string): FieldValue<Array<number | null>> {
  const labelled = [...text.matchAll(new RegExp(TARGET_LABEL, "gi"))].flatMap((m) => {
    const prices = [...m[0].matchAll(new RegExp(NUM, "g"))].map((hit) => num(hit[1])).filter(isGoldLevel);
    if (prices.length) return prices;
    return /\bopen\b/i.test(m[0]) ? [null] : [];
  });
  if (labelled.length) return f(labelled, 1);
  const list = text.match(new RegExp(String.raw`\b(?:take\s*profits?|targets?|tps?)\b\s*[:@=\-]?\s*((?:${NUM}\s*[,/|&]?\s*)+)`, "i"));
  if (list) {
    const values = [...list[1].matchAll(new RegExp(NUM, "g"))].map((m) => num(m[1])).filter(isGoldLevel);
    if (values.length) return f(values, 0.95);
  }
  return f<Array<number | null>>([], 1);
}

/** A follow-up that only labels a stop or targets, with no entry price of its own. */
function isLevelsOnly(text: string) {
  if (/\b(?:buy(?:ing)?|sell(?:ing)?|long|short|bullish|bearish)\b/i.test(text)) return false;
  const stop = detectStop(text).value;
  const targets = detectTargets(text).value ?? [];
  if (stop === null && targets.length === 0) return false;
  const rest = text
    .replace(new RegExp(TARGET_LABEL, "gi"), " ")
    .replace(new RegExp(STOP_LABEL, "gi"), " ")
    .replace(new RegExp(String.raw`\b(?:take\s*profits?|targets?|tps?)\b\s*[:@=\-]?\s*(?:${NUM}\s*[,/|&]?\s*)+`, "gi"), " ");
  return !hasGoldPrice(rest);
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
  version: "text-generic-v5",
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
    const stop = detectStop(text).value;
    const skeleton = stop !== null && isGoldLevel(stop) && hasGoldPrice(entryWindow(text));

    // Result posts ("BUY TP2 HIT", "RUNNING 200 PIPS") are not new trades.
    // A bare "TP1 hit" still goes through as a target-hit instruction below.
    if (!skeleton && isResultPost(text) && direction.value) {
      return { ...base, eventType: "COMMENT", signal: null, instruction: null, issues: ["Result update, not a new signal."], confidence: 1 };
    }

    // A direction word with no gold price is promo or commentary ("about to buy", "buy running").
    if (direction.value && !hasGoldPrice(entryWindow(text)) && detectStop(text).value === null) {
      return { ...base, eventType: "COMMENT", signal: null, instruction: null, issues: ["No entry price; treated as commentary."], confidence: 1 };
    }

    // A message without a trade direction is an instruction, a price-implied signal, or commentary.
    if (direction.value === null && direction.confidence === 0) {
      if (instruction.eventType) {
        const { eventType, ...rest } = instruction;
        const needsRef = eventType === "UPDATE" || eventType === "CLOSE" || eventType === "CANCEL";
        const confidence = needsRef && !referencesExternalId ? 0.85 : 1;
        const issues = needsRef && !referencesExternalId ? ["Instruction does not reference a message; linked to latest open signal."] : [];
        return { ...base, eventType, signal: null, instruction: rest, issues, confidence };
      }
      if (isLevelsOnly(text)) {
        return {
          ...base,
          eventType: "UPDATE",
          signal: null,
          instruction: { fillLevels: { stopLoss: detectStop(text).value, targets: detectTargets(text).value ?? [] } },
          issues: [],
          confidence: 0.95,
        };
      }
      const tradeLabels = /\b(?:sl|s\/l|stop\s*loss|take\s*profit|tp\s*\d)\b/i.test(text) && hasGoldPrice(text);
      if (tradeLabels) {
        const inferred = withInferredDirection(signalFields(text, direction));
        const { signal, issues, confidence } = finalizeSignal(inferred.fields);
        return {
          ...base,
          eventType: "NEW_SIGNAL",
          signal,
          instruction: null,
          issues: [...inferred.notes, ...issues],
          confidence,
        };
      }
      return { ...base, eventType: "COMMENT", signal: null, instruction: null, issues: [], confidence: 1 };
    }

    if (instruction.eventType && instruction.eventType !== "TARGET_HIT" && !detectStop(text).value) {
      const { eventType, ...rest } = instruction;
      return { ...base, eventType: eventType!, signal: null, instruction: rest, issues: [], confidence: 0.9 };
    }

    const fields = signalFields(text, direction);
    const { signal, issues, confidence } = finalizeSignal(fields);
    return { ...base, eventType: "NEW_SIGNAL", signal, instruction: null, issues, confidence };
  },
};

function signalFields(text: string, direction: FieldValue<"LONG" | "SHORT">): ParsedSignalFields {
  const entry = detectEntry(text);
  let targets = detectTargets(text);
  const pips = detectPipDistances(text);
  const pricedTargets = (targets.value ?? []).filter((target): target is number => target !== null);
  if (pricedTargets.length === 0 && pips && entry.entryMin.value !== null && entry.entryMax.value !== null && direction.value) {
    const anchor = direction.value === "LONG" ? entry.entryMax.value : entry.entryMin.value;
    const sign = direction.value === "LONG" ? 1 : -1;
    targets = f(pips.map((pipsAway) => Math.round((anchor + sign * pipsAway * GOLD_PIP) * 100) / 100), 0.9);
  }
  return {
    instrument: detectInstrument(text),
    direction,
    entryType: entry.entryType,
    entryMin: entry.entryMin,
    entryMax: entry.entryMax,
    stopLoss: detectStop(text),
    targets,
    signalType: detectSignalType(text),
    sourceConfidenceText: detectConfidenceText(text),
  };
}
