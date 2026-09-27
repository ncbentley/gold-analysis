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
import { parseEvent, REVIEW_THRESHOLD, type ParseOutput } from "@/server/parsing";

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
  status: "applied" | "needs_review" | "failed" | "ignored",
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

  const editOf = (event.rawPayloadJson as { edit_of?: unknown } | null)?.edit_of;
  if (editOf != null) {
    // Silent edits after posting are how track records get rewritten, so they never apply automatically.
    if (out.eventType === "COMMENT") return storeParse(event, out, "ignored", null, [`Edit of message ${editOf}; comment ignored.`]);
    return storeParse(event, out, "needs_review", null, [
      `Source edited message ${editOf} after posting. Compare with the original before correcting the signal.`,
    ]);
  }

  if (out.eventType === "NEW_SIGNAL") {
    const [existing] = await db.select({ id: signals.id }).from(signals).where(eq(signals.originEventId, event.id));
    if (existing) {
      return storeParse(event, out, "ignored", existing.id, ["A signal already exists for this event; use Correct signal to change it."]);
    }
    const input = toSignalInput(out, event.publishedAt);
    if (!input || out.confidence < REVIEW_THRESHOLD) {
      return storeParse(event, out, "needs_review", null);
    }
    const signal = await createSignal(event.sourceId, event.id, input, out.confidence, actor);
    return storeParse(event, out, "applied", signal.id);
  }

  if (out.eventType === "COMMENT") {
    return storeParse(event, out, out.confidence < 0.7 ? "needs_review" : "ignored", null);
  }

  const { signal, inferred } = await findTargetSignal(event, out);
  if (!signal) return storeParse(event, out, "needs_review", null, ["No matching open signal found for this instruction."]);

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
  if (!adjustment) return storeParse(event, out, "needs_review", signal.id, ["Update could not be mapped to an instruction."]);

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
  const signal = await createSignal(event.sourceId, event.id, input, 1, actor, reason);
  await db
    .update(parseResults)
    .set({ status: "resolved", signalId: signal.id })
    .where(and(eq(parseResults.rawEventId, rawEventId), eq(parseResults.isCurrent, true)));
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
}

/** Admin correction. The previous values are preserved in the audit log; the signal version is bumped. */
export async function correctSignal(signalId: string, patch: Partial<SignalInput> & { status?: Signal["status"] }, actor: Actor, reason: string) {
  const db = await getDb();
  const [before] = await db.select().from(signals).where(eq(signals.id, signalId));
  if (!before) throw new Error("Signal not found");
  const beforeTargets = await db.select().from(signalTargets).where(eq(signalTargets.signalId, signalId));

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
  });
  await enqueueJob("RECALC_OUTCOME", { signalId }, { dedupeKey: `recalc:${signalId}` });
}
