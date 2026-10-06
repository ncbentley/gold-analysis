import { eq } from "drizzle-orm";
import { getDb } from "@/server/db";
import { complimentaryGrants, type Tier } from "@/server/db/schema";

export async function getComplimentaryTier(userId: string): Promise<Tier | null> {
  const db = await getDb();
  const [row] = await db.select({ tier: complimentaryGrants.tier }).from(complimentaryGrants).where(eq(complimentaryGrants.userId, userId)).limit(1);
  return row?.tier ?? null;
}
