import { desc, eq, gte, sql } from "drizzle-orm";
import { getDb } from "@/server/db";
import { attributionTouches, userAttributions, users } from "@/server/db/schema";
import { channelOf, type Channel, type Touch } from "./attribution";

export type AttributionBreakdown = Channel & { n: number };

const WINDOW_MS = 30 * 86_400_000;

export async function getAttributionReport() {
  const db = await getDb();
  const since = new Date(Date.now() - WINDOW_MS);
  const [touchGroups, accounts, recent] = await Promise.all([
    db
      .select({
        landing: attributionTouches.landing,
        referrer: attributionTouches.referrer,
        params: attributionTouches.params,
        n: sql<number>`count(*)::int`,
      })
      .from(attributionTouches)
      .where(gte(attributionTouches.touchedAt, since))
      .groupBy(attributionTouches.landing, attributionTouches.referrer, attributionTouches.params)
      .orderBy(desc(sql`count(*)`))
      .limit(200),
    db
      .select({ firstTouch: userAttributions.firstTouch, lastTouch: userAttributions.lastTouch })
      .from(userAttributions)
      .where(gte(userAttributions.createdAt, since)),
    db
      .select({
        id: attributionTouches.id,
        landing: attributionTouches.landing,
        referrer: attributionTouches.referrer,
        params: attributionTouches.params,
        touchedAt: attributionTouches.touchedAt,
        email: users.email,
      })
      .from(attributionTouches)
      .leftJoin(users, eq(users.id, attributionTouches.userId))
      .orderBy(desc(attributionTouches.touchedAt))
      .limit(40),
  ]);

  return {
    visits: fold(touchGroups.map((row) => ({ touch: { at: "", landing: row.landing, referrer: row.referrer, params: row.params }, n: row.n }))),
    firstTouchAccounts: fold(accounts.map((row) => ({ touch: row.firstTouch, n: 1 }))),
    lastTouchAccounts: fold(accounts.map((row) => ({ touch: row.lastTouch, n: 1 }))),
    recent,
  };
}

function fold(rows: { touch: Touch; n: number }[]) {
  const map = new Map<string, AttributionBreakdown>();
  for (const row of rows) {
    const channel = channelOf(row.touch);
    const key = `${channel.source}\0${channel.medium}\0${channel.campaign}`;
    const current = map.get(key) ?? { ...channel, n: 0 };
    current.n += row.n;
    map.set(key, current);
  }
  return [...map.values()].sort((a, b) => b.n - a.n).slice(0, 20);
}
