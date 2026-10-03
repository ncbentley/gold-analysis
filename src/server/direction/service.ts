import { and, desc, eq, gte, isNull } from "drizzle-orm";
import { getAiProvider } from "@/server/ai/service";
import { getDb } from "@/server/db";
import { marketDirectionSnapshots, rawEvents, sources, type DirectionHeadlineRecord, type DirectionLean } from "@/server/db/schema";
import { getRecentBars } from "@/server/market-data";
import { MARKET_DIRECTION_EXAMPLE, MARKET_DIRECTION_SYSTEM, marketDirectionOutputSchema } from "./prompt";
import { LEAN_LABEL } from "./score";

const WINDOW_MS = 36 * 60 * 60 * 1000;
const HEADLINE_LIMIT = 24;
const TEXT_LIMIT = 400;

export interface DirectionView {
  lean: DirectionLean;
  label: string;
  summary: string;
  headlines: DirectionHeadlineRecord[];
  spot: number | null;
  change60m: number | null;
  createdAt: string | Date;
}

function clip(text: string) {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= TEXT_LIMIT) return flat;
  return `${flat.slice(0, TEXT_LIMIT - 1)}…`;
}

async function loadHeadlines(): Promise<DirectionHeadlineRecord[]> {
  const db = await getDb();
  const rows = await db
    .select({
      sourceId: rawEvents.sourceId,
      name: sources.name,
      nickname: sources.nickname,
      parseSignals: sources.parseSignals,
      text: rawEvents.rawText,
      publishedAt: rawEvents.publishedAt,
    })
    .from(rawEvents)
    .innerJoin(sources, eq(sources.id, rawEvents.sourceId))
    .where(and(eq(sources.starred, true), eq(sources.active, true), isNull(sources.removedAt), gte(rawEvents.publishedAt, new Date(Date.now() - WINDOW_MS))))
    .orderBy(desc(rawEvents.publishedAt))
    .limit(HEADLINE_LIMIT);
  return rows
    .map((row) => ({
      sourceId: row.sourceId,
      sourceName: row.parseSignals ? row.nickname : row.name,
      text: clip(row.text),
      publishedAt: row.publishedAt.toISOString(),
    }))
    .filter((row) => row.text.length > 0);
}

function priceContext(bars: { timestamp: Date; close: number }[]) {
  const last = bars.at(-1);
  if (!last) return { spot: null, change60m: null };
  const target = last.timestamp.getTime() - 60 * 60_000;
  let prior = bars[0];
  for (const bar of bars) {
    if (bar.timestamp.getTime() <= target) prior = bar;
  }
  return { spot: last.close, change60m: bars.length > 1 ? last.close - prior.close : null };
}

export async function refreshMarketDirection() {
  const headlines = await loadHeadlines();
  if (headlines.length === 0) return { skipped: "no-headlines" as const };
  const { spot, change60m } = priceContext(await getRecentBars(120));
  const facts = { spot, change60m, headlines: headlines.map((row) => ({ source: row.sourceName, text: row.text, publishedAt: row.publishedAt })) };
  const raw = await getAiProvider().generate({
    analysisType: "market_direction",
    promptVersion: "market-direction-v1",
    system: MARKET_DIRECTION_SYSTEM,
    facts,
    jsonSchema: {},
    example: MARKET_DIRECTION_EXAMPLE,
  });
  const output = marketDirectionOutputSchema.parse(raw);
  const db = await getDb();
  const [row] = await db
    .insert(marketDirectionSnapshots)
    .values({ lean: output.lean, summary: output.summary, headlines, spot, change60m })
    .returning({ id: marketDirectionSnapshots.id });
  return { skipped: false as const, id: row.id, lean: output.lean };
}

export async function latestMarketDirection(): Promise<DirectionView | null> {
  const db = await getDb();
  const [row] = await db.select().from(marketDirectionSnapshots).orderBy(desc(marketDirectionSnapshots.createdAt)).limit(1);
  if (!row) return null;
  return {
    lean: row.lean,
    label: LEAN_LABEL[row.lean],
    summary: row.summary,
    headlines: row.headlines,
    spot: row.spot,
    change60m: row.change60m,
    createdAt: row.createdAt,
  };
}
