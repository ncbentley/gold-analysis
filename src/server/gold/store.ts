import { and, eq, isNull, or } from "drizzle-orm";
import { getDb } from "@/server/db";
import { goldBookEntries } from "@/server/db/schema";
import type { GoldLevel } from "./geometry";

export async function listGoldEntries() {
  const db = await getDb();
  return db.select().from(goldBookEntries);
}

export function liveGoldLevels(rows: Awaited<ReturnType<typeof listGoldEntries>>): GoldLevel[] {
  return rows
    .filter((row) => row.exitTime === null && !row.retired)
    .map((row) => ({
      id: row.ideaId ?? row.id,
      direction: row.direction,
      entryMin: row.entryMin,
      entryMax: row.entryMax,
      stopLoss: row.stopLoss,
    }));
}

export async function insertGoldEntry(level: GoldLevel & { targets: number[]; ideaId?: string | null }) {
  const db = await getDb();
  const [row] = await db
    .insert(goldBookEntries)
    .values({
      ideaId: level.ideaId ?? null,
      direction: level.direction,
      entryMin: level.entryMin,
      entryMax: level.entryMax,
      stopLoss: level.stopLoss,
      targets: level.targets,
    })
    .returning();
  return row;
}

export async function markGoldClose(ideaId: string, calledAt: Date, sectionAtCall: "available" | "active") {
  const db = await getDb();
  await db
    .update(goldBookEntries)
    .set({ closeCalledAt: calledAt, sectionAtCall })
    .where(and(or(eq(goldBookEntries.ideaId, ideaId), eq(goldBookEntries.id, ideaId)), isNull(goldBookEntries.closeCalledAt)));
}

export async function markGoldExit(id: string, exit: { exitTime: Date; exitPrice: number | null; retired: boolean }) {
  const db = await getDb();
  await db.update(goldBookEntries).set(exit).where(eq(goldBookEntries.id, id));
}
