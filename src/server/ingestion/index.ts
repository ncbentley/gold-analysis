import { and, eq } from "drizzle-orm";
import { getDb } from "@/server/db";
import { rawEvents, sources, type RawEvent } from "@/server/db/schema";
import { sanitizeText, sha256, stableStringify } from "@/server/lib/hash";
import { processRawEvent } from "@/server/normalization";
import { parseEvent } from "@/server/parsing";

export interface IncomingEvent {
  externalMessageId?: string | null;
  rawText: string;
  payload?: Record<string, unknown> | null;
  publishedAt?: Date;
}

export type IngestResult =
  | { status: "duplicate"; rawEventId: string; reason: "external_id" | "content_hash" }
  | { status: "stored"; rawEventId: string; parse: Awaited<ReturnType<typeof processRawEvent>> };

export function contentHashFor(sourceId: string, e: { rawText: string; payload: unknown; publishedAt: Date }) {
  return sha256(`${sourceId}\n${e.rawText.trim()}\n${stableStringify(e.payload ?? null)}\n${e.publishedAt.toISOString()}`);
}

/**
 * Stores a raw source event exactly as received (after stripping control characters),
 * rejects duplicates by external id or content hash, then parses and normalizes it.
 */
export async function ingestRawEvent(sourceId: string, incoming: IncomingEvent): Promise<IngestResult> {
  const db = await getDb();
  const [source] = await db.select().from(sources).where(eq(sources.id, sourceId));
  if (!source) throw new Error("Unknown source");
  if (!source.active) throw new Error("Source is disabled");

  const rawText = sanitizeText(incoming.rawText ?? "");
  const publishedAt = incoming.publishedAt ?? new Date();
  const payload = incoming.payload ?? null;
  const contentHash = contentHashFor(sourceId, { rawText, payload, publishedAt });

  if (incoming.externalMessageId) {
    const [dup] = await db
      .select({ id: rawEvents.id })
      .from(rawEvents)
      .where(and(eq(rawEvents.sourceId, sourceId), eq(rawEvents.externalMessageId, incoming.externalMessageId)));
    if (dup) return { status: "duplicate", rawEventId: dup.id, reason: "external_id" };
  }
  const [dupHash] = await db
    .select({ id: rawEvents.id })
    .from(rawEvents)
    .where(and(eq(rawEvents.sourceId, sourceId), eq(rawEvents.contentHash, contentHash)));
  if (dupHash) return { status: "duplicate", rawEventId: dupHash.id, reason: "content_hash" };

  let eventType: RawEvent["eventType"] = null;
  try {
    eventType = parseEvent(source.parserType, { rawText, payload, publishedAt }).eventType;
  } catch {
    eventType = null;
  }

  let event: RawEvent;
  try {
    [event] = await db
      .insert(rawEvents)
      .values({
        sourceId,
        externalMessageId: incoming.externalMessageId ?? null,
        rawText,
        rawPayloadJson: payload,
        publishedAt,
        eventType,
        contentHash,
      })
      .returning();
  } catch (err) {
    // A concurrent insert of the same event lost the race on the unique index.
    const [existing] = await db
      .select({ id: rawEvents.id })
      .from(rawEvents)
      .where(and(eq(rawEvents.sourceId, sourceId), eq(rawEvents.contentHash, contentHash)));
    if (existing) return { status: "duplicate", rawEventId: existing.id, reason: "content_hash" };
    throw err;
  }

  const parse = await processRawEvent(event.id);
  return { status: "stored", rawEventId: event.id, parse };
}
