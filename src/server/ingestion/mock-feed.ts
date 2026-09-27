import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/server/db";
import { rawEvents, sources, type Source } from "@/server/db/schema";
import { getRecentBars } from "@/server/market-data";
import { sha256 } from "@/server/lib/hash";
import { ingestRawEvent } from "./index";

/**
 * Source adapter for `mock_feed` sources: a stand-in for polling a Telegram channel or API.
 * It publishes a new message roughly every few hours, anchored to the latest stored price.
 */
const MIN_GAP_MINUTES = 150;

export function composeMockMessage(source: Pick<Source, "slug">, seed: string, price: number) {
  const h = parseInt(sha256(seed).slice(0, 8), 16);
  const long = h % 2 === 0;
  const risk = 4 + (h % 7);
  const f = (n: number) => n.toFixed(2);
  const dir = long ? 1 : -1;
  const offset = ((h >> 3) % 5) * 0.6;
  const entry = price - dir * offset;
  const stop = entry - dir * risk;
  const tps = [1.2, 2, 3].map((m) => entry + dir * risk * m);
  if (source.slug === "bullion-flow") {
    const lo = Math.min(entry, entry - dir * 1.5);
    const hi = Math.max(entry, entry - dir * 1.5);
    return `GOLD ${long ? "BUY" : "SELL"} ZONE ${f(lo)} - ${f(hi)}\nStop Loss ${f(stop)}\nTake Profit ${f(tps[0])} / ${f(tps[1])}\n#${["scalp", "intraday", "pullback"][h % 3]}`;
  }
  return `XAUUSD ${long ? "BUY" : "SELL"} NOW @ ${f(price)}\nSL: ${f(price - dir * risk)}\nTP1: ${f(price + dir * risk * 1.2)}\nTP2: ${f(price + dir * risk * 2)}\nTP3: ${f(price + dir * risk * 3)}\nConfidence: ${["High", "Medium", "Medium"][h % 3]}`;
}

export async function pollMockFeed(sourceId: string, now = new Date()) {
  const db = await getDb();
  const [source] = await db.select().from(sources).where(eq(sources.id, sourceId));
  if (!source || !source.active || source.sourceType !== "mock_feed") return { published: false, reason: "not a mock feed" };
  const [last] = await db
    .select({ publishedAt: rawEvents.publishedAt })
    .from(rawEvents)
    .where(and(eq(rawEvents.sourceId, sourceId), eq(rawEvents.eventType, "NEW_SIGNAL")))
    .orderBy(desc(rawEvents.publishedAt))
    .limit(1);
  if (last && now.getTime() - last.publishedAt.getTime() < MIN_GAP_MINUTES * 60_000) return { published: false, reason: "too soon" };
  const [bar] = (await getRecentBars(1)).slice(-1);
  if (!bar || now.getTime() - bar.timestamp.getTime() > 10 * 60_000) return { published: false, reason: "market closed or data stale" };

  const externalMessageId = `${source.slug}-${Math.floor(now.getTime() / 60_000)}`;
  const text = composeMockMessage(source, externalMessageId, bar.close);
  const res = await ingestRawEvent(source.id, { externalMessageId, rawText: text, payload: { channel: source.slug, message_id: externalMessageId }, publishedAt: now });
  return { published: res.status === "stored", rawEventId: res.rawEventId };
}
