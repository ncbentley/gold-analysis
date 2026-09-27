import { and, desc, eq } from "drizzle-orm";
import { getDb, type Db } from "@/server/db";
import { auditLogs } from "@/server/db/schema";

export interface Actor {
  userId: string | null;
  label: string;
}

export const SYSTEM: Actor = { userId: null, label: "system" };
export const PIPELINE: Actor = { userId: null, label: "pipeline" };

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export async function recordAudit(
  entry: {
    actor: Actor;
    entityType: string;
    entityId: string;
    action: string;
    before?: unknown;
    after?: unknown;
    reason?: string | null;
  },
  tx?: Tx | Db,
) {
  const db = tx ?? (await getDb());
  await db.insert(auditLogs).values({
    actorUserId: entry.actor.userId,
    actorLabel: entry.actor.label,
    entityType: entry.entityType,
    entityId: entry.entityId,
    action: entry.action,
    beforeJson: entry.before === undefined ? null : JSON.parse(JSON.stringify(entry.before)),
    afterJson: entry.after === undefined ? null : JSON.parse(JSON.stringify(entry.after)),
    reason: entry.reason ?? null,
  });
}

export async function listAudit(opts: { entityType?: string; entityId?: string; limit?: number } = {}) {
  const db = await getDb();
  const conds = [];
  if (opts.entityType) conds.push(eq(auditLogs.entityType, opts.entityType));
  if (opts.entityId) conds.push(eq(auditLogs.entityId, opts.entityId));
  return db
    .select()
    .from(auditLogs)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(auditLogs.createdAt))
    .limit(opts.limit ?? 100);
}

export type { Tx };
