import { z } from "zod";
import { DEEPINFRA_DEFAULT_MODEL, DEEPINFRA_LARGE_REVIEW_MODEL, chatProvider, resolveChatBackend, type ChatBackend } from "@/server/ai/backend";
import type { ParseOutput } from "./types";
import { lessonFromModel, pricesAreGrounded, type PatternSignal } from "./pattern";
import { inferDirectionFromPrices } from "./direction";
import { geometryIsValid } from "./repair";
import type { ParsedSignalFields } from "./types";
import { pricesFromParsedSignal, type ParseLesson } from "./lessons";

/**
 * A model decision is acted on only when it names apply, dismiss, or correct
 * and its confidence is at least this value. `unknown`, or anything below it,
 * stays in the human review queue.
 */
export const QUEUE_REVIEW_MIN_CONFIDENCE = 0.8;

export const queueReviewSchema = z.object({
  decision: z.enum(["apply", "dismiss", "correct", "unknown"]),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
  entryType: z.enum(["MARKET", "LIMIT", "ZONE"]).nullable(),
  direction: z.enum(["LONG", "SHORT"]).nullable(),
  entryMin: z.number().nullable(),
  entryMax: z.number().nullable(),
  stopLoss: z.number().nullable(),
  targets: z.array(z.number()),
});

export type QueueReview = z.infer<typeof queueReviewSchema>;

export interface QueueReviewInput {
  rawText: string;
  eventType: string;
  parserConfidence: number;
  issues: string[];
  draft: {
    direction: "LONG" | "SHORT" | null;
    entryType: "MARKET" | "LIMIT" | "ZONE" | null;
    entryMin: number | null;
    entryMax: number | null;
    stopLoss: number | null;
    targets: number[];
  } | null;
  marketPrice: number | null;
  learnedPatterns: Array<{
    pattern: string;
    decision: string;
    roles: string[];
    direction: string | null;
    entryType: string | null;
  }>;
}

export interface QueueReviewClient {
  review(input: QueueReviewInput, opts?: { smallAlreadyAnswered?: boolean }): Promise<EscalatedQueueReview>;
}

export const QUEUE_REVIEW_SYSTEM = `You review one gold (XAU/USD) post. The deterministic parser did not accept it. Read the message yourself. Parser issues are hints, not the decision. Emoji and punctuation may sit against the numbers (🎯4058, SL⛔️4038). Those numbers still count.

Choose exactly one decision:
- apply: the message is a new trade. Copy every price that is in the message. A complete trade has an entry, a stop, and at least one target. A bare entry (direction and an entry price, with no stop and no targets stated) is still apply: leave stopLoss null and targets empty. Do not invent a stop or target the message never stated.
- dismiss: the message is not a new trade. A hit or profit update (TP hit, all targets, profit, pips, closed) with no new entry is dismiss. Chat, news, and ads are dismiss.
- correct: it is a trade, but one price is a one-digit typo. Put the repaired number in that field. Do not invent a stop that is not in the message.
- unknown: only when the message has no prices and no clear hit or profit wording, so you cannot tell. Do not pick unknown because the parser was unsure, and do not pick unknown for a hit update or a complete trade.

Confidence is a number from 0 to 1, not a percent. When you choose apply, dismiss, or correct, set confidence to 0.9 or higher. Use a value below 0.8 only together with unknown.

Rules:
- When a stop or targets make the side obvious, direction comes from those prices. Do not dismiss a post only because it never says buy or sell. BUY, or targets above the entry with a stop below, is LONG. SELL, or the reverse, is SHORT.
- A two-price entry is entryType ZONE. A single entry price is LIMIT.
- Do not invent a price that is not in the message. A one-digit typo may be repaired. Do not invent a missing stop.
- A quoted entry more than $80 from the market price is not a live order. If marketPrice is null, judge the message on its own.
- Never tell anyone to take the trade.
- Do not copy the example prices unless those exact numbers are in the message.

Return one JSON object and nothing else. Do not return a JSON Schema. Do not wrap the answer in type or properties. targets is an array of numbers. Use [] when there are none, never null.

Example of apply (numbers must come from the message you were given):
{"decision":"apply","confidence":0.95,"reason":"Buy zone with a stop and three targets.","entryType":"ZONE","direction":"LONG","entryMin":4043,"entryMax":4053,"stopLoss":4038,"targets":[4058,4063,4068]}

Example of dismiss:
{"decision":"dismiss","confidence":0.95,"reason":"Target-hit update, not a new trade.","entryType":null,"direction":null,"entryMin":null,"entryMax":null,"stopLoss":null,"targets":[]}`;

/**
 * Llama sometimes wraps a real answer in a schema shell, sends confidence as a
 * string or a percent, or sets targets to null. This only repairs that shape.
 * A copied schema, with decision still an object, is left unchanged and fails
 * validation. Confidence is never raised except when a 1–100 percent is scaled
 * into 0–1.
 */
export function coerceQueueReview(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  let obj = raw as Record<string, unknown>;
  const props = obj.properties;
  if (props && typeof props === "object" && !Array.isArray(props)) {
    const decision = (props as Record<string, unknown>).decision;
    if (typeof decision === "string") obj = { ...(props as Record<string, unknown>) };
  }
  const out: Record<string, unknown> = { ...obj };
  if (typeof out.decision === "string") out.decision = out.decision.trim().toLowerCase();
  if (typeof out.confidence === "string") {
    const parsed = Number(out.confidence);
    if (Number.isFinite(parsed)) out.confidence = parsed;
  }
  if (typeof out.confidence === "number" && out.confidence > 1 && out.confidence <= 100) {
    out.confidence = out.confidence / 100;
  }
  if (out.targets == null) out.targets = [];
  for (const key of ["entryType", "direction", "entryMin", "entryMax", "stopLoss"] as const) {
    if (out[key] === undefined) out[key] = null;
  }
  return out;
}

export function unknownQueueReview(reason: string): QueueReview {
  return {
    decision: "unknown",
    confidence: 0,
    reason,
    entryType: null,
    direction: null,
    entryMin: null,
    entryMax: null,
    stopLoss: null,
    targets: [],
  };
}

export function queueDecisionIsActionable(review: QueueReview) {
  return review.decision !== "unknown" && review.confidence >= QUEUE_REVIEW_MIN_CONFIDENCE;
}

/** Stored on a review row when Llama 3.1 8B did not choose apply, dismiss, or correct. */
export const SMALL_MODEL_DECLINED = "Small model did not decide.";

export function smallModelAlreadyAnswered(issues: string[]) {
  return issues.some((issue) => issue === SMALL_MODEL_DECLINED || issue.startsWith("Small model did not decide"));
}

export interface EscalatedQueueReview {
  review: QueueReview;
  sentToLarger: boolean;
  smallDeclined: boolean;
}

/**
 * The 8B model answers first. Unknown, low confidence, or an unreadable answer
 * goes to the 70B model. A post the 8B model already declined skips straight there.
 */
export async function reviewWithEscalation(
  _input: QueueReviewInput,
  ask: (model: string) => Promise<QueueReview>,
  opts: { smallAlreadyAnswered: boolean; smallModel?: string; largeModel?: string | null },
): Promise<EscalatedQueueReview> {
  const smallModel = opts.smallModel ?? DEEPINFRA_DEFAULT_MODEL;
  const largeModel = opts.largeModel === undefined ? DEEPINFRA_LARGE_REVIEW_MODEL : opts.largeModel;
  if (!opts.smallAlreadyAnswered) {
    const small = await ask(smallModel);
    if (queueDecisionIsActionable(small) || !largeModel || largeModel === smallModel) {
      return { review: small, sentToLarger: false, smallDeclined: !queueDecisionIsActionable(small) };
    }
    return { review: await ask(largeModel), sentToLarger: true, smallDeclined: true };
  }
  const model = largeModel || smallModel;
  return { review: await ask(model), sentToLarger: Boolean(largeModel) && largeModel !== smallModel, smallDeclined: true };
}

function draftFacts(out: ParseOutput): QueueReviewInput["draft"] {
  const signal = out.signal;
  if (!signal) return null;
  return {
    direction: signal.direction.value,
    entryType: signal.entryType.value,
    entryMin: signal.entryMin.value,
    entryMax: signal.entryMax.value,
    stopLoss: signal.stopLoss.value,
    targets: (signal.targets.value ?? []).filter((target): target is number => target !== null),
  };
}

export function queueReviewInput(out: ParseOutput, rawText: string, issues: string[], marketPrice: number | null, lessons: ParseLesson[]): QueueReviewInput {
  return {
    rawText: rawText.slice(0, 2000),
    eventType: out.eventType,
    parserConfidence: out.confidence,
    issues,
    draft: draftFacts(out),
    marketPrice,
    learnedPatterns: lessons.flatMap((lesson) =>
      lesson.learned
        ? [
            {
              pattern: lesson.learned.pattern,
              decision: lesson.decision,
              roles: lesson.learned.roles,
              direction: lesson.learned.direction,
              entryType: lesson.learned.entryType,
            },
          ]
        : [],
    ),
  };
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

/**
 * Turns an actionable model decision into a signal. Null means the answer cannot be used
 * (missing prices, a price that is not in the post, or geometry that still does not work).
 * Null fields keep the parser draft. An empty target list keeps the draft targets.
 */
export function signalFromQueueReview(out: ParseOutput, review: QueueReview, rawText: string): PatternSignal | null {
  if (!queueDecisionIsActionable(review) || review.decision === "dismiss") return null;
  const draft = out.signal;
  const entryType = review.entryType ?? draft?.entryType.value ?? null;
  let entryMin = review.entryMin ?? draft?.entryMin.value ?? null;
  let entryMax = review.entryMax ?? draft?.entryMax.value ?? null;
  const stopLoss = review.stopLoss === null ? (draft?.stopLoss.value ?? null) : review.stopLoss;
  const targets = (review.targets.length ? review.targets : (draft?.targets.value ?? [])).filter(
    (target): target is number => typeof target === "number",
  );
  if (entryMin === null || entryMax === null || !entryType) return null;
  if (entryMin > entryMax) [entryMin, entryMax] = [entryMax, entryMin];
  const direction =
    review.direction ??
    draft?.direction.value ??
    inferDirectionFromPrices({ entryMin, entryMax, stopLoss, targets }).direction;
  if (!direction) return null;
  const prices = [entryMin, entryMax, ...(stopLoss === null ? [] : [stopLoss]), ...targets];
  if (!pricesAreGrounded(rawText, prices)) return null;
  const signal: PatternSignal = {
    instrument: draft?.instrument.value ?? "XAUUSD",
    direction,
    entryType,
    entryMin,
    entryMax,
    stopLoss,
    targets,
    signalType: draft?.signalType.value ?? null,
    sourceConfidenceText: draft?.sourceConfidenceText.value ?? null,
  };
  if (!geometryIsValid(asFields(signal))) return null;
  return signal;
}

export function lessonForQueueReview(rawText: string, out: ParseOutput, review: QueueReview, fields: PatternSignal | null) {
  const decision = review.decision === "dismiss" ? "dismiss" : review.decision === "correct" ? "correct" : "accept";
  return lessonFromModel(rawText, pricesFromParsedSignal(out.signal), fields, decision);
}

export function modelReason(reason: string) {
  const clean = reason.replace(/\s+/g, " ").trim().slice(0, 240);
  return clean ? `Model: ${clean}` : "Model decision";
}

let override: QueueReviewClient | null = null;

/** Tests pass a stand-in that returns a fixed decision. Production calls the live chat backend. */
export function useQueueReviewClient(client: QueueReviewClient | null) {
  override = client;
}

async function askQueueModel(backend: ChatBackend, model: string, input: QueueReviewInput): Promise<QueueReview> {
  try {
    const provider = chatProvider({ ...backend, model });
    const raw = await provider.generate({
      analysisType: "queue_review",
      promptVersion: "queue-review-v2",
      system: QUEUE_REVIEW_SYSTEM,
      facts: {
        message: input.rawText,
        eventType: input.eventType,
        parserConfidence: input.parserConfidence,
        issues: input.issues,
        draft: input.draft,
        marketPrice: input.marketPrice,
        learnedPatterns: input.learnedPatterns,
      },
      jsonSchema: z.toJSONSchema(queueReviewSchema) as Record<string, unknown>,
    });
    const parsed = queueReviewSchema.safeParse(coerceQueueReview(raw));
    if (!parsed.success) return unknownQueueReview("Model response did not match the schema.");
    return parsed.data;
  } catch {
    console.error("[parse] queue review failed");
    return unknownQueueReview("Model response could not be read.");
  }
}

/**
 * Calls DeepInfra, Cloudflare Workers AI, or OpenAI. The first model is `AI_MODEL`,
 * otherwise Llama 3.1 8B on DeepInfra. When that answer is unknown, low confidence,
 * or unreadable, DeepInfra tries Llama 3.1 70B on the same key.
 * With no key the answer is unknown and the post stays in the human queue.
 * The prompt is not written to the log.
 */
export const defaultQueueReviewClient: QueueReviewClient = {
  async review(input, opts) {
    const backend = resolveChatBackend();
    if (!backend) {
      return { review: unknownQueueReview("No model is configured."), sentToLarger: false, smallDeclined: false };
    }
    const largeModel = backend.name === "deepinfra" && backend.model !== DEEPINFRA_LARGE_REVIEW_MODEL ? DEEPINFRA_LARGE_REVIEW_MODEL : null;
    return reviewWithEscalation(input, (model) => askQueueModel(backend, model, input), {
      smallAlreadyAnswered: opts?.smallAlreadyAnswered ?? false,
      smallModel: backend.model,
      largeModel,
    });
  },
};

export function getQueueReviewClient() {
  return override ?? defaultQueueReviewClient;
}
