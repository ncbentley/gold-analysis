import { and, eq, inArray } from "drizzle-orm";
import { tradeGlance, type IdeaGlance } from "@/lib/trade-glance";
import { getDb } from "@/server/db";
import { signalOutcomes } from "@/server/db/schema";
import type { IdeaPhase } from "@/server/ideas/phase";
import type { SignalListItem } from "@/server/presenters";

export type GlancedSignal = SignalListItem & { glance: IdeaGlance };

function phaseOf(status: string): IdeaPhase {
  if (status === "PENDING") return "available";
  if (status === "ACTIVE" || status === "PARTIAL") return "playing-out";
  return "history";
}

function checkpointOf(detail: Record<string, unknown>) {
  const checkpoint = detail.checkpoint;
  if (!checkpoint || typeof checkpoint !== "object") return null;
  const row = checkpoint as { exits?: { price: number; weight: number }[]; remaining?: number };
  return {
    exits: Array.isArray(row.exits) ? row.exits : [],
    remaining: typeof row.remaining === "number" ? row.remaining : 0,
  };
}

/** Same book mark the Silver and Gold rows show: distance while pending, live or final R after a fill. */
export async function annotateSignalGlance(items: SignalListItem[], spot: number | null): Promise<GlancedSignal[]> {
  const ids = items.map((item) => item.id);
  const db = await getDb();
  const outcomes = ids.length
    ? await db
        .select()
        .from(signalOutcomes)
        .where(and(inArray(signalOutcomes.signalId, ids), eq(signalOutcomes.isCurrent, true)))
    : [];
  const byId = new Map(outcomes.map((row) => [row.signalId, row]));
  return items.map((item) => {
    const outcome = byId.get(item.id);
    const detail = (outcome?.detailJson ?? {}) as Record<string, unknown>;
    const phase = phaseOf(item.status);
    return {
      ...item,
      glance: tradeGlance({
        phase,
        direction: item.direction,
        entryMin: item.entryMin,
        entryMax: item.entryMax,
        spot,
        outcome: outcome
          ? {
              entered: outcome.entered,
              entryPrice: outcome.entryPrice,
              risk: typeof detail.risk === "number" ? detail.risk : null,
              rResult: outcome.rResult,
              exitTime: outcome.exitTime ? outcome.exitTime.getTime() : null,
              targets: item.targets.map((target) => ({ hitAt: target.hitAt ? Date.parse(target.hitAt) : null })),
              checkpoint: checkpointOf(detail),
            }
          : null,
      }),
    };
  });
}
