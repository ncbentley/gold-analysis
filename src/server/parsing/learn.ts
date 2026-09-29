import { desc, eq } from "drizzle-orm";
import { recordAudit, type Actor, type Tx } from "@/server/audit";
import { getDb, type Db } from "@/server/db";
import { auditLogs } from "@/server/db/schema";
import { parseLesson, type ParseLesson } from "./lessons";

export async function loadParseLessons(limit = 30): Promise<ParseLesson[]> {
  const db = await getDb();
  const rows = await db
    .select({ after: auditLogs.afterJson })
    .from(auditLogs)
    .where(eq(auditLogs.action, "parse.learned"))
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit);
  return rows.flatMap((row) => {
    const lesson = parseLesson(row.after);
    return lesson ? [lesson] : [];
  });
}

export async function recordParseLesson(
  actor: Actor,
  entityType: string,
  entityId: string,
  lesson: ParseLesson,
  reason?: string | null,
  tx?: Tx | Db,
) {
  await recordAudit(
    {
      actor,
      entityType,
      entityId,
      action: "parse.learned",
      after: lesson,
      reason,
    },
    tx,
  );
}
