import { eq } from "drizzle-orm";
import { PIPELINE } from "@/server/audit";
import { getDb } from "@/server/db";
import { rawEvents, signals, sources } from "@/server/db/schema";
import { correctSignal } from "@/server/normalization";
import { parseEvent } from "./index";

/**
 * Rewrites signals whose stored entry is a single price but the message was a
 * short zone such as "4155-60". Leaves every other field as it was logged.
 */
export async function repairShortZones() {
  const db = await getDb();
  const rows = await db
    .select({
      signal: signals,
      rawText: rawEvents.rawText,
      payload: rawEvents.rawPayloadJson,
      publishedAt: rawEvents.publishedAt,
      parserType: sources.parserType,
    })
    .from(signals)
    .innerJoin(rawEvents, eq(rawEvents.id, signals.originEventId))
    .innerJoin(sources, eq(sources.id, signals.sourceId));

  const updated: string[] = [];
  for (const row of rows) {
    if (row.signal.status === "INVALID") continue;
    let out;
    try {
      out = parseEvent(row.parserType, {
        rawText: row.rawText,
        payload: row.payload,
        publishedAt: row.publishedAt,
      });
    } catch {
      continue;
    }
    const parsed = out.signal;
    if (out.eventType !== "NEW_SIGNAL" || !parsed?.direction.value || !parsed.entryType.value) continue;
    if (parsed.entryMin.value === null || parsed.entryMax.value === null) continue;
    if (parsed.direction.value !== row.signal.direction) continue;
    const lo = Math.min(parsed.entryMin.value, parsed.entryMax.value);
    const hi = Math.max(parsed.entryMin.value, parsed.entryMax.value);
    const oldWidth = row.signal.entryMax - row.signal.entryMin;
    const newWidth = hi - lo;
    const contains = row.signal.entryMin >= lo - 0.02 && row.signal.entryMax <= hi + 0.02;
    const sameStop =
      parsed.stopLoss.value === row.signal.stopLoss ||
      (parsed.stopLoss.value !== null &&
        row.signal.stopLoss !== null &&
        Math.abs(parsed.stopLoss.value - row.signal.stopLoss) < 0.05);
    if (parsed.entryType.value !== "ZONE" || !contains || !sameStop || newWidth <= oldWidth + 0.01) continue;
    if (newWidth > 30) continue;
    await correctSignal(
      row.signal.id,
      { entryType: "ZONE", entryMin: lo, entryMax: hi },
      PIPELINE,
      "Expanded a two-digit price tail into the zone the message wrote.",
    );
    updated.push(row.signal.id);
  }
  return { updated: updated.length, ids: updated };
}
