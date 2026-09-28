import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getAiProvider } from "@/server/ai/service";
import { getDb } from "@/server/db";
import { auditLogs, rawEvents, signals } from "@/server/db/schema";
import { distanceToQuote, quoteIsPlausible } from "./quote-sanity";

const reviewSchema = z.object({
  decision: z.enum(["accept", "revise", "reject"]),
  reason: z.string(),
  entryType: z.enum(["MARKET", "LIMIT", "ZONE"]).nullable(),
  direction: z.enum(["LONG", "SHORT"]).nullable(),
  entryMin: z.number().nullable(),
  entryMax: z.number().nullable(),
  stopLoss: z.number().nullable(),
  targets: z.array(z.number()),
});

export interface QuoteDraft {
  direction: "LONG" | "SHORT";
  entryType: "MARKET" | "LIMIT" | "ZONE";
  entryMin: number;
  entryMax: number;
  stopLoss: number | null;
  targets: number[];
}

export type PriceReview = z.infer<typeof reviewSchema>;

const SYSTEM = `You check a gold (XAU/USD) signal against the price at the time it was posted.
Rules:
- Use the message, the draft parse, the market price, and the human corrections. Do not invent a trade.
- A quoted entry more than $80 from the market price is not a live order. It is usually a typo or the wrong instrument.
- "4155-60" means the zone 4155 to 4160. A two-digit tail is the other side of a small zone, not a second instrument.
- Revise only when the message itself contains the corrected prices. If you cannot, reject.
- Never tell anyone to take the trade.
Respond with JSON matching the schema.`;

function stopIsValid(direction: "LONG" | "SHORT", lo: number, hi: number, stop: number | null) {
  if (stop === null) return true;
  return direction === "LONG" ? stop < lo : stop > hi;
}

/** Pure decision: a model may revise a draft, but it cannot force a far quote onto the live list. */
export function interpretPriceReview(draft: QuoteDraft, review: PriceReview, marketPrice: number): QuoteDraft | null {
  if (review.decision === "reject") return null;
  if (review.decision === "accept") return quoteIsPlausible(marketPrice, draft.entryMin, draft.entryMax) ? draft : null;

  const direction = review.direction ?? draft.direction;
  const entryType = review.entryType ?? draft.entryType;
  const entryMin = review.entryMin ?? draft.entryMin;
  const entryMax = review.entryMax ?? draft.entryMax;
  const stopLoss = review.stopLoss === null ? draft.stopLoss : review.stopLoss;
  const targets = review.targets.length ? review.targets : draft.targets;
  const lo = Math.min(entryMin, entryMax);
  const hi = Math.max(entryMin, entryMax);
  if (!quoteIsPlausible(marketPrice, lo, hi)) return null;
  if (!stopIsValid(direction, lo, hi, stopLoss)) return null;
  const wrongTarget = targets.some((t) => (direction === "LONG" ? t <= hi : t >= lo));
  if (wrongTarget) return null;
  return { direction, entryType, entryMin: lo, entryMax: hi, stopLoss, targets };
}

async function recentCorrections(limit = 8) {
  const db = await getDb();
  const rows = await db
    .select({
      rawText: rawEvents.rawText,
      beforeJson: auditLogs.beforeJson,
      afterJson: auditLogs.afterJson,
      reason: auditLogs.reason,
    })
    .from(auditLogs)
    .innerJoin(signals, eq(signals.id, auditLogs.entityId))
    .innerJoin(rawEvents, eq(rawEvents.id, signals.originEventId))
    .where(eq(auditLogs.action, "signal.corrected"))
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit);
  return rows.map((row) => ({
    message: row.rawText.slice(0, 500),
    before: row.beforeJson,
    after: row.afterJson,
    reason: row.reason,
  }));
}

/**
 * Asks the configured model to reconcile a far quote with the price at post time.
 * Returns null when no model is configured, the call fails, or the answer is still implausible.
 * Human corrections are included so the next call can follow decisions already made.
 */
export async function reviewFarQuote(rawText: string, draft: QuoteDraft, marketPrice: number): Promise<QuoteDraft | null> {
  if (process.env.AI_PROVIDER !== "openai" || !process.env.OPENAI_API_KEY) return null;
  try {
    const lessons = await recentCorrections();
    const provider = getAiProvider();
    const raw = await provider.generate({
      analysisType: "parse_review",
      promptVersion: "parse-review-v1",
      system: SYSTEM,
      facts: {
        message: rawText.slice(0, 2000),
        marketPrice,
        distance: Math.round(distanceToQuote(marketPrice, draft.entryMin, draft.entryMax) * 100) / 100,
        draft,
        humanCorrections: lessons,
      },
      jsonSchema: z.toJSONSchema(reviewSchema) as Record<string, unknown>,
    });
    return interpretPriceReview(draft, reviewSchema.parse(raw), marketPrice);
  } catch (err) {
    console.error(`[parse] price review failed: ${(err as Error).message}`);
    return null;
  }
}
