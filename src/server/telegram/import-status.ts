import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/server/db";
import { jobs, sources } from "@/server/db/schema";

export type ImportStatus = "queued" | "importing" | "caught_up" | "failed";

/** Label shown on the source row. Null means this source has no import state yet. */
export function describeSourceImport(status: string | null | undefined) {
  if (status === "queued") return "queued";
  if (status === "importing") return "importing";
  if (status === "failed") return "failed";
  if (status === "caught_up") return "caught up";
  return null;
}

/** A stored message with no parse yet is waiting on the review queue. */
export function messageQueueState(parseStatus: string | null | undefined) {
  return parseStatus ?? "queued";
}

export async function markTelegramImportQueued(sourceId: string) {
  const db = await getDb();
  await db.update(sources).set({ importStatus: "queued", syncError: null }).where(eq(sources.id, sourceId));
}

export async function markTelegramImporting(sourceId: string) {
  const db = await getDb();
  await db
    .update(sources)
    .set({ importStatus: "importing", syncError: null })
    .where(and(eq(sources.id, sourceId), eq(sources.importStatus, "queued")));
}

export async function markTelegramImportFailed(sourceId: string, message: string) {
  const db = await getDb();
  await db
    .update(sources)
    .set({ importStatus: "failed", syncError: message })
    .where(and(eq(sources.id, sourceId), inArray(sources.importStatus, ["queued", "importing"])));
}

export async function countPendingSourceEvents(sourceId: string) {
  const db = await getDb();
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(jobs)
    .where(and(eq(jobs.type, "PROCESS_EVENT"), inArray(jobs.status, ["queued", "running"]), sql`${jobs.payloadJson}->>'sourceId' = ${sourceId}`));
  return row?.n ?? 0;
}

/** Moves an in-progress import to caught up once none of its messages are still queued. */
export async function finishImportIfIdle(sourceId: string) {
  if ((await countPendingSourceEvents(sourceId)) > 0) return;
  const db = await getDb();
  await db
    .update(sources)
    .set({ importStatus: "caught_up", syncError: null, lastSyncedAt: new Date() })
    .where(and(eq(sources.id, sourceId), eq(sources.importStatus, "importing")));
}
