import { describe, expect, it } from "vitest";
import { parseEvent, REVIEW_THRESHOLD } from "./index";
import { lessonFromModel, messagePattern, replayLearnedLesson } from "./pattern";
import { chatUserContent } from "@/server/ai/providers/openai";
import { DEEPINFRA_DEFAULT_MODEL, DEEPINFRA_LARGE_REVIEW_MODEL } from "@/server/ai/backend";
import {
  QUEUE_REVIEW_MIN_CONFIDENCE,
  QUEUE_REVIEW_SYSTEM,
  SMALL_MODEL_DECLINED,
  coerceQueueReview,
  queueDecisionIsActionable,
  queueReviewSchema,
  reviewWithEscalation,
  signalFromQueueReview,
  smallModelAlreadyAnswered,
  unknownQueueReview,
  type QueueReview,
  type QueueReviewInput,
} from "./queue-review";

const at = new Date("2026-03-02T12:00:00Z");
const bare = "XAUUSD BUY 3350\nSL 3340\nTP 3360";

function review(patch: Partial<QueueReview> = {}): QueueReview {
  return {
    decision: "apply",
    confidence: 0.93,
    reason: "Limit entry with a stop and a target.",
    direction: "LONG",
    entryType: "LIMIT",
    entryMin: null,
    entryMax: null,
    stopLoss: null,
    targets: [],
    ...patch,
  };
}

describe("queue review confidence", () => {
  it("acts only on apply, dismiss, or correct at or above 0.8", () => {
    expect(QUEUE_REVIEW_MIN_CONFIDENCE).toBe(0.8);
    expect(queueDecisionIsActionable(review())).toBe(true);
    expect(queueDecisionIsActionable(review({ decision: "dismiss", confidence: 0.8 }))).toBe(true);
    expect(queueDecisionIsActionable(review({ decision: "correct", confidence: 0.91 }))).toBe(true);
    expect(queueDecisionIsActionable(review({ confidence: 0.79 }))).toBe(false);
    expect(queueDecisionIsActionable(review({ decision: "unknown", confidence: 0.99 }))).toBe(false);
    expect(queueDecisionIsActionable(unknownQueueReview("No model is configured."))).toBe(false);
  });

  it("does not tell the model to drop priced posts that lack a direction word", () => {
    expect(QUEUE_REVIEW_SYSTEM).not.toMatch(/treated as commentary/i);
    expect(QUEUE_REVIEW_SYSTEM).toMatch(/direction comes from those prices/i);
  });

  it("asks for a filled decision instead of a copied schema or a low default confidence", () => {
    expect(QUEUE_REVIEW_SYSTEM).toMatch(/do not return a json schema/i);
    expect(QUEUE_REVIEW_SYSTEM).toMatch(/hit or profit update/i);
    expect(QUEUE_REVIEW_SYSTEM).toMatch(/set confidence to 0\.9 or higher/i);
    expect(QUEUE_REVIEW_SYSTEM).not.toMatch(/below 0\.8, is left for a human/i);
    const user = chatUserContent({
      analysisType: "queue_review",
      promptVersion: "queue-review-v2",
      system: QUEUE_REVIEW_SYSTEM,
      facts: { message: "TP1 hit" },
      jsonSchema: { type: "object" },
    });
    expect(user).not.toMatch(/matching this schema/i);
    expect(user).toMatch(/do not return a json schema/i);
    const other = chatUserContent({
      analysisType: "parse_review",
      promptVersion: "parse-review-v1",
      system: "review",
      facts: { message: "x" },
      jsonSchema: { type: "object", properties: { decision: { type: "string" } } },
    });
    expect(other).toMatch(/matching this schema/i);
  });

  it("repairs a wrapped answer and still rejects a copied schema", () => {
    const wrapped = coerceQueueReview({
      type: "object",
      properties: {
        decision: "dismiss",
        confidence: "95",
        reason: "Target-hit update.",
        targets: null,
      },
    });
    const parsed = queueReviewSchema.parse(wrapped);
    expect(parsed).toMatchObject({ decision: "dismiss", confidence: 0.95, targets: [] });
    expect(queueDecisionIsActionable(parsed)).toBe(true);

    const echoed = coerceQueueReview({
      type: "object",
      properties: { decision: { type: "string", enum: ["apply", "dismiss", "correct", "unknown"] } },
    });
    expect(queueReviewSchema.safeParse(echoed).success).toBe(false);
  });
});

const escalationInput: QueueReviewInput = {
  rawText: "GOLD BUY 4370",
  eventType: "NEW_SIGNAL",
  parserConfidence: 0.9,
  issues: [],
  draft: null,
  marketPrice: 4370,
  learnedPatterns: [],
};

describe("larger model review", () => {
  it("asks the 70B model when the small model does not decide", async () => {
    const calls: string[] = [];
    const result = await reviewWithEscalation(
      escalationInput,
      async (model) => {
        calls.push(model);
        if (model === DEEPINFRA_DEFAULT_MODEL) return unknownQueueReview("unsure");
        return review({ decision: "dismiss", confidence: 0.95, reason: "Not a trade." });
      },
      { smallAlreadyAnswered: false },
    );
    expect(DEEPINFRA_LARGE_REVIEW_MODEL).toMatch(/70B/);
    expect(calls).toEqual([DEEPINFRA_DEFAULT_MODEL, DEEPINFRA_LARGE_REVIEW_MODEL]);
    expect(result.sentToLarger).toBe(true);
    expect(result.review.decision).toBe("dismiss");
  });

  it("goes straight to the larger model when the small model already answered", async () => {
    const calls: string[] = [];
    const result = await reviewWithEscalation(
      escalationInput,
      async (model) => {
        calls.push(model);
        return review({ decision: "apply", confidence: 0.2, reason: "Still unsure." });
      },
      { smallAlreadyAnswered: true },
    );
    expect(calls).toEqual([DEEPINFRA_LARGE_REVIEW_MODEL]);
    expect(result.sentToLarger).toBe(true);
    expect(result.smallDeclined).toBe(true);
    expect(queueDecisionIsActionable(result.review)).toBe(false);
  });

  it("keeps a decisive small-model answer and does not call the larger model", async () => {
    const calls: string[] = [];
    const result = await reviewWithEscalation(
      escalationInput,
      async (model) => {
        calls.push(model);
        return review({ decision: "dismiss", confidence: 0.91, reason: "Chat." });
      },
      { smallAlreadyAnswered: false },
    );
    expect(calls).toEqual([DEEPINFRA_DEFAULT_MODEL]);
    expect(result.sentToLarger).toBe(false);
  });

  it("remembers that the small model already declined", () => {
    expect(smallModelAlreadyAnswered([SMALL_MODEL_DECLINED])).toBe(true);
    expect(smallModelAlreadyAnswered(["Direction is missing or contradictory."])).toBe(false);
  });

  it("lets a bare entry stay a signal with an empty stop and no targets", () => {
    expect(QUEUE_REVIEW_SYSTEM).toMatch(/bare entry/i);
    expect(QUEUE_REVIEW_SYSTEM).toMatch(/do not invent a stop or target/i);
    const parsed = parseEvent("text-generic", { rawText: "GOLD BUY 4370", payload: null, publishedAt: at });
    const fields = signalFromQueueReview(
      parsed,
      review({
        reason: "Bare buy at 4370.",
        entryMin: 4370,
        entryMax: 4370,
        stopLoss: null,
        targets: [],
      }),
      "GOLD BUY 4370",
    );
    expect(fields).toMatchObject({ direction: "LONG", entryMin: 4370, entryMax: 4370, stopLoss: null, targets: [] });
  });
});

describe("learned pattern", () => {
  it("stores the price shape, the role of each price, and the direction", () => {
    const parsed = parseEvent("text-generic", { rawText: bare, payload: null, publishedAt: at });
    expect(parsed.confidence).toBeGreaterThanOrEqual(REVIEW_THRESHOLD);
    const fields = signalFromQueueReview(parsed, review(), bare);
    expect(fields).toMatchObject({ direction: "LONG", entryType: "LIMIT", entryMin: 3350, stopLoss: 3340, targets: [3360] });
    const lesson = lessonFromModel(bare, [3350, 3350, 3340, 3360], fields, "accept");
    expect(lesson).toMatchObject({
      decision: "accept",
      noDirectionWord: false,
      edits: [],
      learned: {
        pattern: "xauusd buy {p} sl {p} tp {p}",
        roles: ["entry", "stop", "target"],
        direction: "LONG",
        entryType: "LIMIT",
      },
    });
    expect(messagePattern("XAUUSD BUY 3360\nSL 3350\nTP 3370")).toBe(lesson.learned?.pattern);
  });

  it("replays that shape onto a later post, including a one-digit correction", () => {
    const parsed = parseEvent("text-generic", {
      rawText: "GOLD 4190 TP 4280 SL 4210",
      payload: null,
      publishedAt: at,
    });
    const corrected = signalFromQueueReview(
      parsed,
      review({
        decision: "correct",
        direction: "SHORT",
        entryType: "LIMIT",
        entryMin: 4190,
        entryMax: 4190,
        stopLoss: 4210,
        targets: [4180],
      }),
      "GOLD 4190 TP 4280 SL 4210",
    );
    expect(corrected?.targets).toEqual([4180]);
    const lesson = lessonFromModel("GOLD 4190 TP 4280 SL 4210", [4190, 4190, 4210, 4280], corrected, "correct");
    expect(lesson.edits).toEqual([{ from: 4280, to: 4180 }]);
    expect(lesson.learned).toMatchObject({
      pattern: "gold {p} tp {p} sl {p}",
      roles: ["entry", "target", "stop"],
      direction: "SHORT",
      entryType: "LIMIT",
    });
    const repaired = replayLearnedLesson("GOLD 4190 TP 4280 SL 4210", lesson);
    expect(repaired).toMatchObject({ action: "signal", fields: { direction: "SHORT", stopLoss: 4210, targets: [4180] } });
    const again = replayLearnedLesson("GOLD 4200 TP 4185 SL 4220", lesson);
    expect(again).toMatchObject({
      action: "signal",
      fields: { direction: "SHORT", entryType: "LIMIT", entryMin: 4200, stopLoss: 4220, targets: [4185] },
    });
  });

  it("dismisses a later post with the same shape and refuses a price that is not in the message", () => {
    const text = "Gold buy 3400 tp 3410";
    const lesson = lessonFromModel(text, [3400, 3400, 3410], null, "dismiss");
    expect(lesson.learned).toMatchObject({ pattern: "gold buy {p} tp {p}", roles: [], direction: null, entryType: null });
    expect(replayLearnedLesson("Gold buy 3500 tp 3510", lesson)).toEqual({ action: "dismiss" });

    const parsed = parseEvent("text-generic", { rawText: bare, payload: null, publishedAt: at });
    expect(signalFromQueueReview(parsed, review({ stopLoss: 2500 }), bare)).toBeNull();
  });
});
