import { and, asc, desc, eq, gt, inArray, or } from "drizzle-orm";
import { PIPELINE, recordAudit, type Actor } from "@/server/audit";
import { getDb } from "@/server/db";
import {
  signalAdjustments,
  signalOutcomes,
  signals,
  signalTargets,
  type Signal,
  type SignalOutcome,
} from "@/server/db/schema";
import { enqueueJob } from "@/server/jobs/queue";
import { getEngineBars, getSyncState } from "@/server/market-data";
import { evaluateSignal, advanceFromCheckpoint, OUTCOME_RULES, type EngineAdjustment, type EngineOutcome, type ReplayCheckpoint } from "./engine";
import { barAffectsSignal } from "./affected";
import { knownMarketThrough, outcomeUsesFutureBar } from "./replay-window";

const CLOSED = new Set(["WON", "LOST", "BREAKEVEN", "CANCELLED", "EXPIRED", "AMBIGUOUS"]);

export async function getCurrentOutcome(signalId: string) {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(signalOutcomes)
    .where(and(eq(signalOutcomes.signalId, signalId), eq(signalOutcomes.isCurrent, true)))
    .orderBy(desc(signalOutcomes.computedAt))
    .limit(1);
  return row ?? null;
}

/** An unfilled order past its lifetime leaves the board with no win or loss. */
async function closeUnfilledOrder(signal: Signal, closedAtMs: number) {
  const db = await getDb();
  await db.transaction(async (tx) => {
    await tx
      .update(signalOutcomes)
      .set({ isCurrent: false })
      .where(and(eq(signalOutcomes.signalId, signal.id), eq(signalOutcomes.isCurrent, true)));
    await tx.insert(signalOutcomes).values({
      signalId: signal.id,
      calcVersion: OUTCOME_RULES.version,
      signalVersion: signal.version,
      kind: "computed",
      isCurrent: true,
      classification: "EXPIRED",
      entered: false,
      ambiguous: false,
      exitTime: new Date(closedAtMs),
      detailJson: {
        notes: ["Unfilled order closed after 6 hours. No stored bars, so no win or loss was assigned."],
        rules: { version: OUTCOME_RULES.version, defaultExpiryMinutes: OUTCOME_RULES.defaultExpiryMinutes },
      },
      createdBy: "engine",
    });
    await tx.update(signals).set({ status: "EXPIRED", closedAt: new Date(closedAtMs) }).where(eq(signals.id, signal.id));
  });
}

function toRow(signal: Signal, out: EngineOutcome) {
  const d = (ms: number | null) => (ms === null ? null : new Date(ms));
  return {
    signalId: signal.id,
    calcVersion: out.calcVersion,
    signalVersion: signal.version,
    kind: "computed" as const,
    isCurrent: true,
    classification: out.classification,
    entered: out.entered,
    entryTime: d(out.entryTime),
    entryPrice: out.entryPrice,
    exitTime: d(out.exitTime),
    exitReason: out.exitReason,
    stopHitAt: d(out.stopHitAt),
    rResult: out.rResult,
    mfe: out.mfe,
    mae: out.mae,
    mfeR: out.mfeR,
    maeR: out.maeR,
    bestPrice: out.bestPrice,
    worstPrice: out.worstPrice,
    durationMinutes: out.durationMinutes,
    ambiguous: out.ambiguous,
    detailJson: JSON.parse(
      JSON.stringify({
        timeline: out.timeline,
        targets: out.targets,
        notes: out.notes,
        risk: out.risk,
        finalStop: out.finalStop,
        averageExitPrice: out.averageExitPrice,
        pricePnl: out.pricePnl,
        dataThrough: out.dataThrough,
        rules: OUTCOME_RULES,
        checkpoint: out.checkpoint,
      }),
    ),
    createdBy: "engine",
  };
}

/**
 * Replays a signal against stored bars and persists the result.
 * A new outcome row is written whenever the classification, rules version or signal version changes,
 * so every calculation version is kept. Progress on an open trade updates the current row in place.
 * A current manual override is never replaced unless `force` is set.
 */
export async function recalculateOutcome(signalId: string, opts: { force?: boolean; actor?: Actor } = {}) {
  const db = await getDb();
  const [signal] = await db.select().from(signals).where(eq(signals.id, signalId));
  if (!signal) throw new Error("Signal not found");
  if (signal.status === "INVALID") return { skipped: "invalid" as const };

  const current = await getCurrentOutcome(signalId);
  if (current?.kind === "override" && !opts.force) return { skipped: "override" as const };

  const targets = await db.select().from(signalTargets).where(eq(signalTargets.signalId, signalId)).orderBy(asc(signalTargets.targetIndex));
  const adjustments = await db.select().from(signalAdjustments).where(eq(signalAdjustments.signalId, signalId));
  const sync = await getSyncState(signal.instrument);
  const clock = Date.now();
  const scoredAhead = outcomeUsesFutureBar(
    current
      ? {
          kind: current.kind,
          entryTime: current.entryTime,
          exitTime: current.exitTime,
          checkpointBarTime: checkpointOf(current)?.barTime ?? null,
        }
      : null,
    clock,
  );
  const unfilledLifetimeMs = OUTCOME_RULES.defaultExpiryMinutes * 60_000;
  const unfilledClosesAt = (signal.expiryTime?.getTime() ?? signal.signalTime.getTime()) + unfilledLifetimeMs;
  const covered = Boolean(sync?.firstBarAt && sync.firstBarAt.getTime() <= signal.signalTime.getTime());
  if (!covered && !scoredAhead) {
    if (signal.status === "PENDING" && clock >= unfilledClosesAt) {
      await closeUnfilledOrder(signal, unfilledClosesAt);
      return { classification: "EXPIRED" as const, changed: true };
    }
    await enqueueJob("MARKET_DATA_BACKFILL", {}, { dedupeKey: "market-backfill" });
    return { skipped: "no_market_data" as const };
  }
  if (!covered) await enqueueJob("MARKET_DATA_BACKFILL", {}, { dedupeKey: "market-backfill" });

  const knownThrough = knownMarketThrough(sync?.syncedThrough.getTime() ?? clock, clock);
  const horizonMs = Number.isFinite(OUTCOME_RULES.maxHoldMinutes)
    ? (OUTCOME_RULES.defaultExpiryMinutes + OUTCOME_RULES.maxHoldMinutes + 24 * 60) * 60_000
    : Math.max(0, knownThrough - signal.signalTime.getTime());
  const from = new Date(signal.signalTime.getTime() - 60_000);
  const until = new Date(Math.min((signal.expiryTime?.getTime() ?? signal.signalTime.getTime()) + horizonMs, knownThrough));
  const engineAdjustments: EngineAdjustment[] = adjustments.map((a) =>
    a.type === "MOVE_STOP"
      ? { type: "MOVE_STOP", effectiveAt: a.effectiveAt.getTime(), stop: a.payloadJson.stop as number | "ENTRY" }
      : { type: a.type === "CLOSE" ? "CLOSE" : "CANCEL", effectiveAt: a.effectiveAt.getTime() },
  );
  const engineSignal = {
    direction: signal.direction,
    entryType: signal.entryType,
    entryMin: signal.entryMin,
    entryMax: signal.entryMax,
    stopLoss: signal.stopLoss,
    targets: targets.flatMap((t) => (t.price === null ? [] : [t.price])),
    signalTime: signal.signalTime.getTime(),
    expiryTime: signal.expiryTime?.getTime() ?? null,
  };

  const stored = scoredAhead ? null : checkpointOf(current);
  const adjustmentBeforeCheckpoint = stored ? engineAdjustments.some((adjustment) => adjustment.effectiveAt < stored.barTime) : true;
  const shortUntil = new Date(Math.min(until.getTime(), from.getTime() + 2 * 86_400_000));
  let out: EngineOutcome;
  if (stored && !opts.force && !adjustmentBeforeCheckpoint) {
    const newer = await getEngineBars(new Date(stored.barTime + 1), until, signal.instrument);
    out = advanceFromCheckpoint(engineSignal, stored, newer, engineAdjustments, Math.min(until.getTime(), knownThrough));
  } else {
    let cursor = shortUntil;
    let bars = await getEngineBars(from, cursor, signal.instrument);
    out = evaluateSignal(engineSignal, bars, engineAdjustments, Math.min(cursor.getTime(), knownThrough));
    while (out.classification === "OPEN" && cursor.getTime() < knownThrough) {
      const next = new Date(Math.min(cursor.getTime() + 14 * 86_400_000, knownThrough));
      bars.push(...(await getEngineBars(cursor, next, signal.instrument)));
      cursor = next;
      out = evaluateSignal(engineSignal, bars, engineAdjustments, knownThrough);
    }
    if (out.classification === "PENDING" && cursor.getTime() < until.getTime()) {
      bars = await getEngineBars(from, until, signal.instrument);
      out = evaluateSignal(engineSignal, bars, engineAdjustments, Math.min(until.getTime(), knownThrough));
    }
  }
  if (out.classification === "PENDING" && !out.entered && Date.now() >= unfilledClosesAt) {
    out = {
      ...out,
      classification: "EXPIRED",
      status: "EXPIRED",
      notes: [...out.notes, "Unfilled order closed after 6 hours."],
    };
  }

  const row = toRow(signal, out);
  const sameVersion =
    current &&
    current.kind === "computed" &&
    current.calcVersion === row.calcVersion &&
    current.signalVersion === row.signalVersion &&
    current.classification === row.classification;

  await db.transaction(async (tx) => {
    if (sameVersion && current) {
      await tx.update(signalOutcomes).set({ ...row, computedAt: new Date() }).where(eq(signalOutcomes.id, current.id));
    } else {
      await tx
        .update(signalOutcomes)
        .set({ isCurrent: false })
        .where(and(eq(signalOutcomes.signalId, signalId), eq(signalOutcomes.isCurrent, true)));
      await tx.insert(signalOutcomes).values(row);
    }
    await applyOutcomeToSignal(tx, signal, out.status, out.exitTime, out);
  });

  const changed = !sameVersion;
  if (changed) {
    await enqueueJob("REFRESH_SOURCE_STATS", { sourceId: signal.sourceId }, { dedupeKey: `stats:${signal.sourceId}` });
    if (CLOSED.has(out.classification)) {
      await enqueueJob("AI_ANALYZE_SIGNAL", { signalId }, { dedupeKey: `ai:${signalId}` });
    }
  }
  return { classification: out.classification, changed };
}

type Tx = Parameters<Parameters<Awaited<ReturnType<typeof getDb>>["transaction"]>[0]>[0];

async function applyOutcomeToSignal(
  tx: Tx,
  signal: Signal,
  status: Signal["status"],
  exitTime: number | null,
  out: EngineOutcome | null,
) {
  const closed = !["PENDING", "ACTIVE", "PARTIAL"].includes(status);
  await tx
    .update(signals)
    .set({ status, closedAt: closed ? (exitTime ? new Date(exitTime) : new Date()) : null })
    .where(eq(signals.id, signal.id));
  if (out) {
    for (const t of out.targets) {
      await tx
        .update(signalTargets)
        .set({
          hitAt: t.hitAt ? new Date(t.hitAt) : null,
          status: t.ambiguous ? "AMBIGUOUS" : t.hitAt ? "HIT" : closed ? "MISSED" : "OPEN",
        })
        .where(and(eq(signalTargets.signalId, signal.id), eq(signalTargets.targetIndex, t.index)));
    }
  }
}

/** Manual outcome override for exceptional cases. The computed history is kept and audited. */
export async function overrideOutcome(
  signalId: string,
  input: { classification: "WON" | "LOST" | "BREAKEVEN" | "CANCELLED" | "EXPIRED"; rResult: number | null; exitTime: Date | null },
  actor: Actor,
  reason: string,
) {
  const db = await getDb();
  const [signal] = await db.select().from(signals).where(eq(signals.id, signalId));
  if (!signal) throw new Error("Signal not found");
  const current = await getCurrentOutcome(signalId);
  await db.transaction(async (tx) => {
    await tx.update(signalOutcomes).set({ isCurrent: false }).where(and(eq(signalOutcomes.signalId, signalId), eq(signalOutcomes.isCurrent, true)));
    await tx.insert(signalOutcomes).values({
      signalId,
      calcVersion: current?.calcVersion ?? OUTCOME_RULES.version,
      signalVersion: signal.version,
      kind: "override",
      isCurrent: true,
      classification: input.classification,
      entered: current?.entered ?? input.classification !== "CANCELLED",
      entryTime: current?.entryTime ?? null,
      entryPrice: current?.entryPrice ?? null,
      exitTime: input.exitTime,
      exitReason: "OVERRIDE",
      stopHitAt: current?.stopHitAt ?? null,
      rResult: input.rResult,
      mfe: current?.mfe ?? null,
      mae: current?.mae ?? null,
      mfeR: current?.mfeR ?? null,
      maeR: current?.maeR ?? null,
      bestPrice: current?.bestPrice ?? null,
      worstPrice: current?.worstPrice ?? null,
      durationMinutes: current?.durationMinutes ?? null,
      ambiguous: false,
      detailJson: { ...(current?.detailJson ?? {}), overriddenOutcomeId: current?.id ?? null },
      overrideReason: reason,
      createdBy: actor.label,
    });
    await applyOutcomeToSignal(tx, signal, input.classification, input.exitTime?.getTime() ?? null, null);
    await recordAudit(
      {
        actor,
        entityType: "signal_outcome",
        entityId: signalId,
        action: "outcome.override",
        before: current ? { id: current.id, classification: current.classification, rResult: current.rResult, kind: current.kind } : null,
        after: input,
        reason,
      },
      tx,
    );
  });
  await enqueueJob("REFRESH_SOURCE_STATS", { sourceId: signal.sourceId }, { dedupeKey: `stats:${signal.sourceId}` });
}

export async function clearOverride(signalId: string, actor: Actor, reason: string) {
  const current = await getCurrentOutcome(signalId);
  if (current?.kind !== "override") return;
  await recordAudit({ actor, entityType: "signal_outcome", entityId: signalId, action: "outcome.override_cleared", before: { id: current.id }, reason });
  await recalculateOutcome(signalId, { force: true, actor });
}

export async function listOutcomeHistory(signalId: string): Promise<SignalOutcome[]> {
  const db = await getDb();
  return db.select().from(signalOutcomes).where(eq(signalOutcomes.signalId, signalId)).orderBy(desc(signalOutcomes.computedAt));
}

/** Computed outcomes whose fill or exit is dated after the clock. */
export async function signalIdsScoredAfter(instant: Date) {
  const db = await getDb();
  const rows = await db
    .select({ id: signalOutcomes.signalId })
    .from(signalOutcomes)
    .where(
      and(
        eq(signalOutcomes.isCurrent, true),
        eq(signalOutcomes.kind, "computed"),
        or(gt(signalOutcomes.entryTime, instant), gt(signalOutcomes.exitTime, instant)),
      ),
    );
  return rows.map((row) => row.id);
}

export async function openSignalIds() {
  const db = await getDb();
  const rows = await db
    .select({ id: signals.id })
    .from(signals)
    .where(inArray(signals.status, ["PENDING", "ACTIVE", "PARTIAL"]));
  return rows.map((r) => r.id);
}

export async function openSignalsForAdvance() {
  const db = await getDb();
  return db
    .select({
      id: signals.id,
      status: signals.status,
      entryMin: signals.entryMin,
      entryMax: signals.entryMax,
      entryType: signals.entryType,
    })
    .from(signals)
    .where(inArray(signals.status, ["PENDING", "ACTIVE", "PARTIAL"]));
}

export function signalsToAdvance<T extends { id: string; status: string; entryMin: number; entryMax: number; entryType: "MARKET" | "LIMIT" | "ZONE" }>(
  rows: T[],
  bar: { h: number; l: number },
): string[] {
  return rows.filter((row) => barAffectsSignal(row, bar)).map((row) => row.id);
}

function checkpointOf(current: SignalOutcome | null): ReplayCheckpoint | null {
  if (!current || current.kind !== "computed" || current.calcVersion !== OUTCOME_RULES.version) return null;
  const checkpoint = current.detailJson.checkpoint;
  if (!checkpoint || typeof checkpoint !== "object") return null;
  return checkpoint as ReplayCheckpoint;
}

export { PIPELINE };
