import { inferDirectionFromPrices, textHasDirectionWord } from "./direction";
import { lessonFromPrices, type LearnedPattern, type LearnedRole, type ParseLesson } from "./lessons";
import { geometryIsValid, oneDigitVariants, samePrice } from "./repair";
import type { ParsedSignalFields } from "./types";

import { GOLD_NUMBER_G } from "./gold-text";

function goldPricePattern() {
  return new RegExp(GOLD_NUMBER_G.source, "g");
}
const GOLD_MIN = 1000;
const GOLD_MAX = 20_000;

function isGoldPrice(price: number) {
  return price >= GOLD_MIN && price <= GOLD_MAX;
}

/** Lowercased text with each gold price replaced by `{p}`. Other words stay, so the shape can be matched later. */
export function messagePattern(text: string) {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(goldPricePattern(), (raw) => (isGoldPrice(Number(raw.replace(",", "."))) ? "{p}" : raw))
    .replace(/\s+/g, " ")
    .trim();
}

export function goldPricesInOrder(text: string) {
  const prices: number[] = [];
  for (const match of text.normalize("NFKC").matchAll(goldPricePattern())) {
    const value = Number(match[0].replace(",", "."));
    if (isGoldPrice(value)) prices.push(value);
  }
  return prices;
}

/** A decided price must be written in the post, or be a one-digit repair of a price that is. */
export function priceIsInMessage(text: string, price: number) {
  return goldPricesInOrder(text).some(
    (quoted) => samePrice(quoted, price) || oneDigitVariants(quoted).some((variant) => samePrice(variant, price)),
  );
}

export function pricesAreGrounded(text: string, prices: number[]) {
  return prices.every((price) => priceIsInMessage(text, price));
}

export interface PatternSignal {
  instrument: string;
  direction: "LONG" | "SHORT";
  entryType: "MARKET" | "LIMIT" | "ZONE";
  entryMin: number;
  entryMax: number;
  stopLoss: number | null;
  targets: number[];
  signalType: string | null;
  sourceConfidenceText: string | null;
}

export type PatternReplay = { action: "dismiss" } | { action: "signal"; fields: PatternSignal };

function priceMatches(quoted: number, decided: number) {
  return samePrice(quoted, decided) || oneDigitVariants(quoted).some((variant) => samePrice(variant, decided));
}

function slotsFor(input: PatternSignal) {
  const slots: { role: LearnedRole; price: number; used: boolean }[] = [];
  if (samePrice(input.entryMin, input.entryMax)) slots.push({ role: "entry", price: input.entryMin, used: false });
  else {
    slots.push({ role: "entryMin", price: input.entryMin, used: false });
    slots.push({ role: "entryMax", price: input.entryMax, used: false });
  }
  if (input.stopLoss !== null) slots.push({ role: "stop", price: input.stopLoss, used: false });
  for (const target of input.targets) slots.push({ role: "target", price: target, used: false });
  return slots;
}

/** Maps each gold price in the post onto the signal the model kept. Exact prices win over one-digit repairs. */
export function rolesFor(text: string, input: PatternSignal): LearnedRole[] {
  const quoted = goldPricesInOrder(text);
  const slots = slotsFor(input);
  const roles: Array<LearnedRole | null> = quoted.map(() => null);
  const claim = (index: number, predicate: (slot: { price: number; used: boolean }) => boolean) => {
    const slot = slots.find((item) => !item.used && predicate(item));
    if (!slot) return false;
    slot.used = true;
    roles[index] = slot.role;
    return true;
  };
  quoted.forEach((price, index) => {
    claim(index, (slot) => samePrice(slot.price, price));
  });
  for (let index = 0; index < quoted.length; index++) {
    if (roles[index]) continue;
    if (!claim(index, (slot) => priceMatches(quoted[index], slot.price))) return [];
  }
  if (roles.some((role) => role === null)) return [];
  return roles as LearnedRole[];
}

function asFields(signal: PatternSignal): ParsedSignalFields {
  const field = <T,>(value: T | null) => ({ value, confidence: 1 });
  return {
    instrument: field(signal.instrument),
    direction: field(signal.direction),
    entryType: field(signal.entryType),
    entryMin: field(signal.entryMin),
    entryMax: field(signal.entryMax),
    stopLoss: field(signal.stopLoss),
    targets: field(signal.targets),
    signalType: field(signal.signalType),
    sourceConfidenceText: field(signal.sourceConfidenceText),
  };
}

function signalFromRoles(text: string, lesson: ParseLesson): PatternSignal | null {
  const learned = lesson.learned;
  if (!learned || learned.roles.length === 0) return null;
  const quoted = goldPricesInOrder(text);
  if (quoted.length !== learned.roles.length) return null;
  const prices = quoted.map((price) => {
    const edit = lesson.edits.find((item) => samePrice(item.from, price));
    return edit ? edit.to : price;
  });
  let entryMin: number | null = null;
  let entryMax: number | null = null;
  let stopLoss: number | null = null;
  const targets: number[] = [];
  prices.forEach((price, index) => {
    const role = learned.roles[index];
    if (role === "entry") {
      entryMin = price;
      entryMax = price;
    } else if (role === "entryMin") entryMin = price;
    else if (role === "entryMax") entryMax = price;
    else if (role === "stop") stopLoss = price;
    else targets.push(price);
  });
  if (entryMin === null || entryMax === null) return null;
  const lo = Math.min(entryMin, entryMax);
  const hi = Math.max(entryMin, entryMax);
  const direction =
    learned.direction ??
    inferDirectionFromPrices({ entryMin: lo, entryMax: hi, stopLoss, targets }).direction;
  if (!direction) return null;
  const entryType = learned.entryType ?? (lo === hi ? "LIMIT" : "ZONE");
  if (stopLoss === null && targets.length === 0) return null;
  const signal: PatternSignal = {
    instrument: "XAUUSD",
    direction,
    entryType,
    entryMin: lo,
    entryMax: hi,
    stopLoss,
    targets,
    signalType: null,
    sourceConfidenceText: null,
  };
  if (!geometryIsValid(asFields(signal))) return null;
  return signal;
}

/** Applies one saved pattern to a new post. Null means this lesson does not decide it. */
export function replayLearnedLesson(text: string, lesson: ParseLesson): PatternReplay | null {
  const learned = lesson.learned;
  if (!learned || learned.pattern !== messagePattern(text)) return null;
  if (lesson.decision === "dismiss") return { action: "dismiss" };
  const fields = signalFromRoles(text, lesson);
  return fields ? { action: "signal", fields } : null;
}

/** Newest matching lesson wins. `lessons` must already be newest first. */
export function matchLearnedLesson(text: string, lessons: ParseLesson[]) {
  const pattern = messagePattern(text);
  return lessons.find((lesson) => lesson.learned?.pattern === pattern) ?? null;
}

export function learnedPatternFor(text: string, decision: ParseLesson["decision"], input: PatternSignal | null): LearnedPattern | null {
  const pattern = messagePattern(text);
  if (!pattern) return null;
  if (decision === "dismiss" || !input) return { pattern, roles: [], direction: null, entryType: null };
  const roles = rolesFor(text, input);
  if (roles.length !== goldPricesInOrder(text).length) return null;
  return { pattern, roles, direction: input.direction, entryType: input.entryType };
}

/** A model decision, stored as the same parse.learned row manual review already writes. */
export function lessonFromModel(
  text: string,
  beforePrices: number[],
  fields: PatternSignal | null,
  decision: ParseLesson["decision"],
): ParseLesson {
  const after = fields
    ? [fields.entryMin, fields.entryMax, fields.stopLoss, ...fields.targets].filter((price): price is number => typeof price === "number")
    : beforePrices;
  const base = lessonFromPrices(beforePrices, decision === "dismiss" ? beforePrices : after, decision, !textHasDirectionWord(text));
  return { ...base, learned: learnedPatternFor(text, decision, fields) };
}
