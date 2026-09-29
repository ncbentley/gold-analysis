import { and, asc, desc, eq, inArray } from "drizzle-orm";
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
import { evaluateSignal, OUTCOME_RULES, type EngineAdjustment, type EngineOutcome } from "./engine";

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
  if (!sync?.firstBarAt || sync.firstBarAt.getTime() > signal.signalTime.getTime()) {
    await enqueueJob("MARKET_DATA_BACKFILL", {}, { dedupeKey: "market-backfill" });
    return { skipped: "no_market_data" as const };
  }

  const horizonMs = (OUTCOME_RULES.defaultExpiryMinutes + OUTCOME_RULES.maxHoldMinutes + 24 * 60) * 60_000;
  const from = new Date(signal.signalTime.getTime() - 60_000);
  const until = new Date(
    Math.min(
      (signal.expiryTime?.getTime() ?? signal.signalTime.getTime()) + horizonMs,
      sync?.syncedThrough.getTime() ?? Date.now(),
    ),
  );
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

  // Most trades resolve within hours, so try a short window before loading the full horizon.
  const shortUntil = new Date(Math.min(until.getTime(), from.getTime() + 2 * 86_400_000));
  let out = evaluateSignal(engineSignal, await getEngineBars(from, shortUntil, signal.instrument), engineAdjustments, shortUntil.getTime());
  if ((out.classification === "OPEN" || out.classification === "PENDING") && shortUntil < until) {
    out = evaluateSignal(engineSignal, await getEngineBars(from, until, signal.instrument), engineAdjustments, sync?.syncedThrough.getTime() ?? null);
  } else if (shortUntil.getTime() === until.getTime()) {
    out.dataThrough = sync?.syncedThrough.getTime() ?? null;
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

export async function openSignalIds() {
  const db = await getDb();
  const rows = await db
    .select({ id: signals.id })
    .from(signals)
    .where(inArray(signals.status, ["PENDING", "ACTIVE", "PARTIAL"]));
  return rows.map((r) => r.id);
}

export { PIPELINE };
