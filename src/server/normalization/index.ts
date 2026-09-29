import { and, desc, eq, inArray, lte } from "drizzle-orm";
import { PIPELINE, recordAudit, type Actor } from "@/server/audit";
import { getDb } from "@/server/db";
import {
  parseResults,
  rawEvents,
  signalAdjustments,
  signals,
  signalTargets,
  sources,
  type RawEvent,
  type Signal,
} from "@/server/db/schema";
import { enqueueJob } from "@/server/jobs/queue";
import { getPriceNear } from "@/server/market-data";
import { parseEvent, REVIEW_THRESHOLD, type ParseOutput } from "@/server/parsing";
import { INFERRED_DIRECTION_ISSUE, textHasDirectionWord } from "@/server/parsing/direction";
import { loadParseLessons, recordParseLesson } from "@/server/parsing/learn";
import { applyLessonsToParse, lessonFromPrices, pricesFromParsedSignal } from "@/server/parsing/lessons";
import { matchLearnedLesson, replayLearnedLesson, type PatternSignal } from "@/server/parsing/pattern";
import { reviewFarQuote } from "@/server/parsing/price-review";
import { distanceToQuote, quoteIsPlausible } from "@/server/parsing/quote-sanity";
import {
  getQueueReviewClient,
  lessonForQueueReview,
  modelReason,
  QUEUE_REVIEW_MIN_CONFIDENCE,
  queueDecisionIsActionable,
  queueReviewInput,
  signalFromQueueReview,
} from "@/server/parsing/queue-review";
import type { ParsedSignalFields } from "@/server/parsing/types";

const OPEN_STATUSES = ["PENDING", "ACTIVE", "PARTIAL"] as const;

export interface SignalInput {
  instrument: string;
  direction: "LONG" | "SHORT";
  entryType: "MARKET" | "LIMIT" | "ZONE";
  entryMin: number;
  entryMax: number;
  stopLoss: number | null;
  targets: number[];
  signalType: string | null;
  sourceConfidenceText: string | null;
  signalTime: Date;
  expiryTime: Date | null;
}

async function markPreviousParsesSuperseded(rawEventId: string) {
  const db = await getDb();
  await db
    .update(parseResults)
    .set({ isCurrent: false })
    .where(and(eq(parseResults.rawEventId, rawEventId), eq(parseResults.isCurrent, true)));
}

async function storeParse(
  event: RawEvent,
  out: ParseOutput,
  status: "applied" | "needs_review" | "failed" | "ignored" | "resolved",
  signalId: string | null,
  extraIssues: string[] = [],
) {
  const db = await getDb();
  await markPreviousParsesSuperseded(event.id);
  const [row] = await db
    .insert(parseResults)
    .values({
      rawEventId: event.id,
      parserType: out.parserType,
      parserVersion: out.parserVersion,
      eventType: out.eventType,
      outputJson: JSON.parse(JSON.stringify(out)),
      confidence: out.confidence,
      status,
      issues: [...out.issues, ...extraIssues],
      signalId,
    })
    .returning();
  return row;
}

export async function createSignal(
  sourceId: string,
  originEventId: string,
  input: SignalInput,
  parserConfidence: number,
  actor: Actor,
  reason?: string,
) {
  const db = await getDb();
  const signal = await db.transaction(async (tx) => {
    const [s] = await tx
      .insert(signals)
      .values({
        sourceId,
        originEventId,
        instrument: input.instrument,
        direction: input.direction,
        entryType: input.entryType,
        signalType: input.signalType,
        entryMin: input.entryMin,
        entryMax: input.entryMax,
        stopLoss: input.stopLoss,
        signalTime: input.signalTime,
        expiryTime: input.expiryTime,
        sourceConfidenceText: input.sourceConfidenceText,
        parserConfidence,
        status: "PENDING",
      })
      .returning();
    if (input.targets.length) {
      await tx.insert(signalTargets).values(input.targets.map((price, i) => ({ signalId: s.id, targetIndex: i + 1, price })));
    }
    await recordAudit(
      { actor, entityType: "signal", entityId: s.id, action: "signal.created", after: { ...input }, reason },
      tx,
    );
    return s;
  });
  await enqueueJob("RECALC_OUTCOME", { signalId: signal.id }, { dedupeKey: `recalc:${signal.id}` });
  await enqueueJob("AI_ANALYZE_SIGNAL", { signalId: signal.id }, { dedupeKey: `ai:${signal.id}` });
  return signal;
}

async function findTargetSignal(event: RawEvent, out: ParseOutput): Promise<{ signal: Signal | null; inferred: boolean }> {
  const db = await getDb();
  if (out.referencesExternalId) {
    const [origin] = await db
      .select({ id: rawEvents.id })
      .from(rawEvents)
      .where(and(eq(rawEvents.sourceId, event.sourceId), eq(rawEvents.externalMessageId, out.referencesExternalId)));
    if (origin) {
      const [s] = await db.select().from(signals).where(eq(signals.originEventId, origin.id));
      if (s) return { signal: s, inferred: false };
    }
  }
  const [latest] = await db
    .select()
    .from(signals)
    .where(
      and(
        eq(signals.sourceId, event.sourceId),
        inArray(signals.status, [...OPEN_STATUSES]),
        lte(signals.signalTime, event.publishedAt),
      ),
    )
    .orderBy(desc(signals.signalTime))
    .limit(1);
  return { signal: latest ?? null, inferred: true };
}

function numberPrices(values: Array<number | null | undefined>) {
  return values.filter((value): value is number => typeof value === "number");
}

function toSignalInput(out: ParseOutput, publishedAt: Date): SignalInput | null {
  const s = out.signal;
  if (!s || !s.direction.value || !s.entryType.value) return null;
  const entryMin = s.entryMin.value;
  const entryMax = s.entryMax.value;
  if (entryMin === null || entryMax === null) return null;
  return {
    instrument: s.instrument.value ?? "XAUUSD",
    direction: s.direction.value,
    entryType: s.entryType.value,
    entryMin,
    entryMax,
    stopLoss: s.stopLoss.value,
    targets: s.targets.value ?? [],
    signalType: s.signalType.value,
    sourceConfidenceText: s.sourceConfidenceText.value,
    signalTime: publishedAt,
    expiryTime: null,
  };
}

async function signalForEditedMessage(sourceId: string, editOf: string) {
  const db = await getDb();
  const [origin] = await db
    .select({ id: rawEvents.id })
    .from(rawEvents)
    .where(and(eq(rawEvents.sourceId, sourceId), eq(rawEvents.externalMessageId, editOf)));
  if (!origin) return null;
  const [signal] = await db.select().from(signals).where(eq(signals.originEventId, origin.id));
  return signal ?? null;
}

async function publishReviewedSignal(event: RawEvent, fields: PatternSignal, confidence: number, actor: Actor, reason: string) {
  const market = await getPriceNear(event.publishedAt, fields.instrument);
  if (market !== null && !quoteIsPlausible(market, fields.entryMin, fields.entryMax)) return null;
  const db = await getDb();
  const [existing] = await db.select({ id: signals.id }).from(signals).where(eq(signals.originEventId, event.id));
  if (existing) return null;
  return createSignal(
    event.sourceId,
    event.id,
    {
      instrument: fields.instrument,
      direction: fields.direction,
      entryType: fields.entryType,
      entryMin: fields.entryMin,
      entryMax: fields.entryMax,
      stopLoss: fields.stopLoss,
      targets: fields.targets,
      signalType: fields.signalType,
      sourceConfidenceText: fields.sourceConfidenceText,
      signalTime: event.publishedAt,
      expiryTime: null,
    },
    confidence,
    actor,
    reason,
  );
}

/**
 * Last step before the human queue. A learned pattern decides a repeat of a shape the model
 * already settled. Otherwise the configured chat model decides. Low confidence and unknown
 * stay in the queue. A confident decision is stored as parse.learned so the next similar post
 * does not call the model.
 */
async function holdForReview(
  event: RawEvent,
  out: ParseOutput,
  signalId: string | null,
  extraIssues: string[],
  actor: Actor,
  learnPattern: boolean,
) {
  if (learnPattern) {
    const matched = matchLearnedLesson(event.rawText, await loadParseLessons());
    const replay = matched ? replayLearnedLesson(event.rawText, matched) : null;
    if (replay?.action === "dismiss") {
      return storeParse(event, { ...out, confidence: 1 }, "ignored", signalId, [...extraIssues, "Dismissed by a learned pattern."]);
    }
    if (replay?.action === "signal") {
      const signal = await publishReviewedSignal(event, replay.fields, QUEUE_REVIEW_MIN_CONFIDENCE, actor, "Applied from a learned pattern.");
      if (signal) {
        return storeParse(event, { ...out, confidence: QUEUE_REVIEW_MIN_CONFIDENCE }, "applied", signal.id, [
          ...extraIssues,
          "Applied from a learned pattern.",
        ]);
      }
    }
  }

  const market = await getPriceNear(event.publishedAt, out.signal?.instrument.value ?? "XAUUSD");
  const lessons = await loadParseLessons();
  const review = await getQueueReviewClient().review(queueReviewInput(out, event.rawText, [...out.issues, ...extraIssues], market, lessons));
  if (!queueDecisionIsActionable(review)) {
    return storeParse(event, out, "needs_review", signalId, extraIssues);
  }

  if (review.decision === "dismiss") {
    if (learnPattern) {
      await recordParseLesson(actor, "raw_event", event.id, lessonForQueueReview(event.rawText, out, review, null), modelReason(review.reason));
    }
    return storeParse(event, { ...out, confidence: review.confidence }, "ignored", signalId, [...extraIssues, "Dismissed by the model."]);
  }

  const fields = signalFromQueueReview(out, review, event.rawText);
  if (!fields || (market !== null && !quoteIsPlausible(market, fields.entryMin, fields.entryMax))) {
    return storeParse(event, out, "needs_review", signalId, extraIssues);
  }

  const editOf = (event.rawPayloadJson as { edit_of?: unknown } | null)?.edit_of;
  if (editOf != null) {
    const original = await signalForEditedMessage(event.sourceId, String(editOf));
    if (!original) return storeParse(event, out, "needs_review", null, extraIssues);
    await correctSignal(original.id, fields, actor, modelReason(review.reason));
    return storeParse(event, { ...out, confidence: review.confidence }, "resolved", original.id, [
      ...extraIssues,
      "Model corrected the original signal.",
    ]);
  }

  if (signalId) {
    await correctSignal(signalId, fields, actor, modelReason(review.reason));
    if (learnPattern) {
      await recordParseLesson(actor, "raw_event", event.id, lessonForQueueReview(event.rawText, out, review, fields), modelReason(review.reason));
    }
    return storeParse(event, { ...out, confidence: review.confidence }, "resolved", signalId, [...extraIssues, "Model corrected the signal."]);
  }

  const reason = review.decision === "correct" ? "Model corrected this signal." : "Model applied this signal.";
  const signal = await publishReviewedSignal(event, fields, review.confidence, actor, modelReason(review.reason));
  if (!signal) return storeParse(event, out, "needs_review", null, extraIssues);
  if (learnPattern) {
    await recordParseLesson(actor, "raw_event", event.id, lessonForQueueReview(event.rawText, out, review, fields), modelReason(review.reason));
  }
  return storeParse(event, { ...out, confidence: review.confidence }, "applied", signal.id, [...extraIssues, reason]);
}

/** Parses a stored raw event and applies the result. Safe to call repeatedly. */
export async function processRawEvent(rawEventId: string, actor: Actor = PIPELINE) {
  const db = await getDb();
  const [event] = await db.select().from(rawEvents).where(eq(rawEvents.id, rawEventId));
  if (!event) throw new Error("Raw event not found");
  const [source] = await db.select().from(sources).where(eq(sources.id, event.sourceId));

  let out: ParseOutput;
  try {
    out = parseEvent(source.parserType, { rawText: event.rawText, payload: event.rawPayloadJson ?? null, publishedAt: event.publishedAt });
  } catch (err) {
    const failed: ParseOutput = {
      parserType: source.parserType,
      parserVersion: "unknown",
      eventType: "COMMENT",
      referencesExternalId: null,
      signal: null,
      instruction: null,
      issues: [`Parser error: ${(err as Error).message}`],
      confidence: 0,
    };
    return storeParse(event, failed, "failed", null);
  }

  if (out.eventType === "NEW_SIGNAL" && out.signal) {
    const needsLessons =
      out.signal.direction.value === null ||
      out.issues.includes(INFERRED_DIRECTION_ISSUE) ||
      out.issues.some((issue) => /wrong side/i.test(issue));
    if (needsLessons) out = applyLessonsToParse(out, await loadParseLessons());
  }

  const editOf = (event.rawPayloadJson as { edit_of?: unknown } | null)?.edit_of;
  if (editOf != null) {
    // Silent edits can rewrite a track record. The model may correct or dismiss one it is sure about.
    // Anything it does not know stays in the human queue, and the edit is not learned as a text pattern.
    if (out.eventType === "COMMENT") return storeParse(event, out, "ignored", null, [`Edit of message ${editOf}; comment ignored.`]);
    return holdForReview(
      event,
      out,
      null,
      [`Source edited message ${editOf} after posting. Compare with the original before correcting the signal.`],
      actor,
      false,
    );
  }

  if (out.eventType === "NEW_SIGNAL") {
    const [existing] = await db.select({ id: signals.id }).from(signals).where(eq(signals.originEventId, event.id));
    if (existing) {
      return storeParse(event, out, "ignored", existing.id, ["A signal already exists for this event; use Correct signal to change it."]);
    }
    let input = toSignalInput(out, event.publishedAt);
    if (!input || out.confidence < REVIEW_THRESHOLD) {
      return holdForReview(event, out, null, [], actor, true);
    }
    const market = await getPriceNear(event.publishedAt, input.instrument);
    const extra: string[] = [];
    if (market !== null && !quoteIsPlausible(market, input.entryMin, input.entryMax)) {
      const revised = await reviewFarQuote(event.rawText, input, market);
      if (revised && quoteIsPlausible(market, revised.entryMin, revised.entryMax)) {
        input = { ...input, ...revised };
        extra.push(
          `Price check revised the entry to ${input.entryMin}–${input.entryMax} using the market price ${market.toFixed(2)}.`,
        );
      } else {
        const away = distanceToQuote(market, input.entryMin, input.entryMax);
        return holdForReview(event, out, null, [
          `Quoted entry ${input.entryMin}–${input.entryMax} is ${away.toFixed(0)} away from the market price ${market.toFixed(2)}. Not placed on the live list.`,
        ], actor, true);
      }
    }
    const signal = await createSignal(event.sourceId, event.id, input, out.confidence, actor);
    return storeParse(event, out, "applied", signal.id, extra);
  }

  if (out.eventType === "COMMENT") {
    if (out.confidence < 0.7) return holdForReview(event, out, null, [], actor, true);
    return storeParse(event, out, "ignored", null);
  }

  const { signal, inferred } = await findTargetSignal(event, out);
  if (!signal) return holdForReview(event, out, null, ["No matching open signal found for this instruction."], actor, false);

  if (out.eventType === "TARGET_HIT" || out.eventType === "STOP_HIT") {
    // Source claims are recorded as evidence only; outcomes are computed from market data.
    return storeParse(event, out, "applied", signal.id);
  }

  const already = await db.select({ id: signalAdjustments.id }).from(signalAdjustments).where(eq(signalAdjustments.rawEventId, event.id));
  if (already.length) return storeParse(event, out, "ignored", signal.id, ["Adjustment already recorded for this event."]);

  let adjustment: typeof signalAdjustments.$inferInsert | null = null;
  if (out.eventType === "CANCEL") {
    adjustment = { signalId: signal.id, rawEventId: event.id, type: "CANCEL", effectiveAt: event.publishedAt, payloadJson: {} };
  } else if (out.eventType === "CLOSE") {
    adjustment = { signalId: signal.id, rawEventId: event.id, type: "CLOSE", effectiveAt: event.publishedAt, payloadJson: {} };
  } else if (out.eventType === "UPDATE" && out.instruction?.moveStop?.value != null) {
    adjustment = {
      signalId: signal.id,
      rawEventId: event.id,
      type: "MOVE_STOP",
      effectiveAt: event.publishedAt,
      payloadJson: { stop: out.instruction.moveStop.value },
    };
  }
  if (!adjustment) return holdForReview(event, out, signal.id, ["Update could not be mapped to an instruction."], actor, false);

  await db.insert(signalAdjustments).values(adjustment);
  await recordAudit({
    actor,
    entityType: "signal",
    entityId: signal.id,
    action: `signal.adjustment.${adjustment.type.toLowerCase()}`,
    after: adjustment.payloadJson,
    reason: inferred ? "Linked to latest open signal (no explicit reference)" : `Source event ${event.id}`,
  });
  await enqueueJob("RECALC_OUTCOME", { signalId: signal.id }, { dedupeKey: `recalc:${signal.id}` });
  return storeParse(event, out, "applied", signal.id, inferred ? ["Linked to latest open signal."] : []);
}

/** Creates a signal from a raw event in manual review, using admin-supplied fields. */
export async function resolveReviewWithSignal(rawEventId: string, input: SignalInput, actor: Actor, reason: string) {
  const db = await getDb();
  const [event] = await db.select().from(rawEvents).where(eq(rawEvents.id, rawEventId));
  if (!event) throw new Error("Raw event not found");
  const [existing] = await db.select({ id: signals.id }).from(signals).where(eq(signals.originEventId, event.id));
  if (existing) throw new Error("A signal already exists for this event");
  const [currentParse] = await db
    .select()
    .from(parseResults)
    .where(and(eq(parseResults.rawEventId, rawEventId), eq(parseResults.isCurrent, true)));
  const signal = await createSignal(event.sourceId, event.id, input, 1, actor, reason);
  await db
    .update(parseResults)
    .set({ status: "resolved", signalId: signal.id })
    .where(and(eq(parseResults.rawEventId, rawEventId), eq(parseResults.isCurrent, true)));
  const stored = currentParse?.outputJson as { signal?: ParsedSignalFields | null } | undefined;
  await recordParseLesson(
    actor,
    "raw_event",
    rawEventId,
    lessonFromPrices(
      pricesFromParsedSignal(stored?.signal),
      numberPrices([input.entryMin, input.entryMax, input.stopLoss, ...input.targets]),
      "accept",
      !textHasDirectionWord(event.rawText),
    ),
    reason,
  );
  return signal;
}

export async function dismissReview(rawEventId: string, actor: Actor, reason: string) {
  const db = await getDb();
  const [current] = await db
    .select()
    .from(parseResults)
    .where(and(eq(parseResults.rawEventId, rawEventId), eq(parseResults.isCurrent, true)));
  if (!current) throw new Error("No parse result to dismiss");
  await db.update(parseResults).set({ status: "ignored" }).where(eq(parseResults.id, current.id));
  await recordAudit({ actor, entityType: "raw_event", entityId: rawEventId, action: "review.dismissed", before: { status: current.status }, reason });
  const [event] = await db.select({ rawText: rawEvents.rawText }).from(rawEvents).where(eq(rawEvents.id, rawEventId));
  await recordParseLesson(
    actor,
    "raw_event",
    rawEventId,
    { edits: [], decision: "dismiss", noDirectionWord: event ? !textHasDirectionWord(event.rawText) : false },
    reason,
  );
}

/** Admin correction. The previous values are preserved in the audit log; the signal version is bumped. */
export async function correctSignal(signalId: string, patch: Partial<SignalInput> & { status?: Signal["status"] }, actor: Actor, reason: string) {
  const db = await getDb();
  const [before] = await db.select().from(signals).where(eq(signals.id, signalId));
  if (!before) throw new Error("Signal not found");
  const beforeTargets = await db.select().from(signalTargets).where(eq(signalTargets.signalId, signalId));
  const [origin] = before.originEventId
    ? await db.select({ rawText: rawEvents.rawText }).from(rawEvents).where(eq(rawEvents.id, before.originEventId))
    : [];
  const beforePrices = numberPrices([
    before.entryMin,
    before.entryMax,
    before.stopLoss,
    ...beforeTargets.map((target) => target.price),
  ]);
  const afterTargets = patch.targets ?? beforeTargets.map((target) => target.price);
  const afterPrices = numberPrices([
    patch.entryMin ?? before.entryMin,
    patch.entryMax ?? before.entryMax,
    patch.stopLoss !== undefined ? patch.stopLoss : before.stopLoss,
    ...afterTargets,
  ]);
  const learned = lessonFromPrices(beforePrices, afterPrices, "correct", origin ? !textHasDirectionWord(origin.rawText) : false);

  await db.transaction(async (tx) => {
    const { targets, ...fields } = patch;
    await tx
      .update(signals)
      .set({ ...fields, version: before.version + 1 })
      .where(eq(signals.id, signalId));
    if (targets) {
      await tx.delete(signalTargets).where(eq(signalTargets.signalId, signalId));
      if (targets.length) {
        await tx.insert(signalTargets).values(targets.map((price, i) => ({ signalId, targetIndex: i + 1, price })));
      }
    }
    await recordAudit(
      {
        actor,
        entityType: "signal",
        entityId: signalId,
        action: "signal.corrected",
        before: { ...before, targets: beforeTargets.sort((a, b) => a.targetIndex - b.targetIndex).map((t) => t.price) },
        after: patch,
        reason,
      },
      tx,
    );
    await recordParseLesson(actor, "signal", signalId, learned, reason, tx);
  });
  await enqueueJob("RECALC_OUTCOME", { signalId }, { dedupeKey: `recalc:${signalId}` });
}
