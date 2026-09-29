import { z } from "zod";
import { chatProvider, resolveChatBackend } from "@/server/ai/backend";
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
  review(input: QueueReviewInput): Promise<QueueReview>;
}

export const QUEUE_REVIEW_SYSTEM = `You review a gold (XAU/USD) post the deterministic parser could not accept on its own.
Choose one decision:
- apply: the draft is a real signal. Keep its prices unless a field is wrong.
- dismiss: the post is not a tradable signal.
- correct: the post is a signal, but a price or the direction in the message needs a fix.
- unknown: you cannot tell.
Set confidence from 0 to 1. Unknown, or confidence below 0.8, is left for a human.
Rules:
- When a stop or targets make the side obvious, direction comes from those prices. Do not dismiss a post only because it never says buy or sell.
- Do not invent a price that is not in the message. A one-digit typo may be repaired. Do not invent a missing stop.
- A quoted entry more than $80 from the market price is not a live order.
- Never tell anyone to take the trade.
Respond with JSON matching the schema.`;

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

function draftFacts(out: ParseOutput): QueueReviewInput["draft"] {
  const signal = out.signal;
  if (!signal) return null;
  return {
    direction: signal.direction.value,
    entryType: signal.entryType.value,
    entryMin: signal.entryMin.value,
    entryMax: signal.entryMax.value,
    stopLoss: signal.stopLoss.value,
    targets: signal.targets.value ?? [],
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
  const targets = review.targets.length ? review.targets : (draft?.targets.value ?? []);
  if (entryMin === null || entryMax === null || !entryType) return null;
  if (entryMin > entryMax) [entryMin, entryMax] = [entryMax, entryMin];
  const direction =
    review.direction ??
    draft?.direction.value ??
    inferDirectionFromPrices({ entryMin, entryMax, stopLoss, targets }).direction;
  if (!direction) return null;
  if (stopLoss === null && targets.length === 0) return null;
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

/**
 * Calls DeepInfra, Cloudflare Workers AI, or OpenAI. The model is `AI_MODEL`, otherwise
 * Llama 3.1 8B on DeepInfra, Llama 3.1 8B on Workers AI, or `gpt-4o-mini`.
 * With no key the answer is unknown and the post stays in the human queue.
 * The prompt is not written to the log.
 */
export const defaultQueueReviewClient: QueueReviewClient = {
  async review(input) {
    const backend = resolveChatBackend();
    if (!backend) return unknownQueueReview("No model is configured.");
    try {
      const provider = chatProvider(backend);
      const raw = await provider.generate({
        analysisType: "queue_review",
        promptVersion: "queue-review-v1",
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
      const parsed = queueReviewSchema.safeParse(raw);
      if (!parsed.success) return unknownQueueReview("Model response did not match the schema.");
      return parsed.data;
    } catch {
      console.error("[parse] queue review failed");
      return unknownQueueReview("Model response could not be read.");
    }
  },
};

export function getQueueReviewClient() {
  return override ?? defaultQueueReviewClient;
}
