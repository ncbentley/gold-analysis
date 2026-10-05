import { and, desc, eq, gte, inArray, isNull } from "drizzle-orm";
import { createOpenAiProvider } from "@/server/ai/providers/openai";
import { getDb } from "@/server/db";
import { boardPosts, consolidatedIdeas, feedRevisions, marketDirectionSnapshots, signalTargets, signals, sourceStats, sources, type BoardCardState, type BoardPick } from "@/server/db/schema";
import { replayConsolidatedIdeas } from "@/server/ideas/service";
import { replayIdea } from "@/server/ideas/replay";
import type { IdeaPhase } from "@/server/ideas/phase";
import { getEngineBars, getRecentBars } from "@/server/market-data";
import { decideBoard, type BoardSnapshot } from "./decide";
import { finishBoardPick, parseBoardOutput } from "./parse";
import { BOARD_EXAMPLE, BOARD_PROMPT_VERSION, BOARD_SYSTEM } from "./prompt";

const LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000;
const DEFAULT_MODEL = "deepseek-ai/DeepSeek-V4-Flash";

export interface BoardCard {
  postId: string;
  slot: "primary" | number;
  pick: BoardPick;
  phase: IdeaPhase;
  startedAt: number;
}

async function spotNow() {
  const [bar] = (await getRecentBars(1)).slice(-1);
  return bar?.close ?? null;
}

async function loadMarket(now: number, since: Date | null) {
  const db = await getDb();
  const spot = await spotNow();
  const ideaRows = since
    ? await db.select().from(consolidatedIdeas).where(gte(consolidatedIdeas.newestSignalAt, since))
    : await db.select().from(consolidatedIdeas);
  const ideaReplay = await replayConsolidatedIdeas(ideaRows, spot);
  const ideas = ideaRows.filter((row) => ideaReplay.get(row.id)?.phase === "available");

  const signalRows = await db
    .select({ signal: signals, qa: sources.isQa })
    .from(signals)
    .innerJoin(sources, eq(sources.id, signals.sourceId))
    .where(since ? and(gte(signals.signalTime, since), isNull(sources.removedAt)) : isNull(sources.removedAt));
  const usable = signalRows.filter((row) => !row.qa && row.signal.status !== "INVALID" && row.signal.status !== "CANCELLED" && row.signal.status !== "MANUAL_REVIEW");
  const ids = usable.map((row) => row.signal.id);
  const targetRows = ids.length ? await db.select().from(signalTargets).where(inArray(signalTargets.signalId, ids)) : [];
  const earliest = usable.reduce((min, row) => Math.min(min, row.signal.signalTime.getTime()), now);
  const bars = usable.length ? await getEngineBars(new Date(earliest), new Date(now + 60_000)) : [];
  const liveSignals = usable.filter((row) => {
    const targets = targetRows.filter((target) => target.signalId === row.signal.id).sort((a, b) => a.targetIndex - b.targetIndex).map((target) => target.price).filter((price): price is number => price !== null);
    const phase = replayIdea(
      {
        direction: row.signal.direction,
        entryMin: row.signal.entryMin,
        entryMax: row.signal.entryMax,
        stopLoss: row.signal.stopLoss,
        targets,
        startedAt: row.signal.signalTime.getTime(),
      },
      bars,
      spot,
      true,
    ).phase;
    return phase === "available";
  });

  const [direction] = await db.select().from(marketDirectionSnapshots).orderBy(desc(marketDirectionSnapshots.createdAt)).limit(1);
  const memberIds = [...new Set(ideas.flatMap((idea) => idea.signalIds))];
  const members = memberIds.length
    ? await db.select({ id: signals.id, sourceId: signals.sourceId }).from(signals).where(inArray(signals.id, memberIds))
    : [];
  const sourceIds = [...new Set(members.map((member) => member.sourceId))];
  const statsRows = sourceIds.length ? await db.select().from(sourceStats).where(inArray(sourceStats.sourceId, sourceIds)) : [];
  const stats = new Map(statsRows.map((row) => [row.sourceId, row.statsJson]));

  return {
    spot,
    ideas,
    signals: liveSignals.map((row) => row.signal),
    direction: direction ?? null,
    directionKey: direction?.id ?? null,
    sources: sourceIds.map((sourceId) => {
      const json = stats.get(sourceId) ?? {};
      return {
        sampleSize: typeof json.closedTrades === "number" ? json.closedTrades : 0,
      };
    }),
  };
}

function snapshotOf(signalIds: string[], ideaIds: string[], directionKey: string | null): BoardSnapshot {
  return { signalIds: [...signalIds].sort(), ideaIds: [...ideaIds].sort(), directionKey };
}

async function activePost() {
  const db = await getDb();
  const [row] = await db.select().from(boardPosts).where(eq(boardPosts.active, true)).orderBy(desc(boardPosts.createdAt)).limit(1);
  return row ?? null;
}

async function deactivate() {
  const db = await getDb();
  await db.update(boardPosts).set({ active: false }).where(eq(boardPosts.active, true));
}

async function callModel(facts: Record<string, unknown>) {
  const apiKey = process.env.DEEPINFRA_API_KEY;
  if (!apiKey) throw new Error("DEEPINFRA_API_KEY is not set");
  const model = process.env.AI_BOARD_MODEL || DEFAULT_MODEL;
  const provider = createOpenAiProvider(apiKey, model, process.env.DEEPINFRA_BASE_URL || "https://api.deepinfra.com/v1/openai", "json_object");
  return {
    model,
    raw: await provider.generate({
      analysisType: "market_direction",
      promptVersion: BOARD_PROMPT_VERSION,
      system: BOARD_SYSTEM,
      facts,
      jsonSchema: {},
      example: BOARD_EXAMPLE,
    }),
  };
}

async function pickPhase(pick: BoardPick, startedAt: number, spot: number | null) {
  return replayIdea({ ...pick, startedAt }, await getEngineBars(new Date(startedAt), new Date(Date.now() + 60_000)), spot, true);
}

async function anyPickLive(picks: BoardPick[], startedAt: number, spot: number | null) {
  for (const pick of picks) {
    if ((await pickPhase(pick, startedAt, spot)).phase !== "history") return true;
  }
  return false;
}

export async function refreshBoard(deps: { now?: number; fullHistory?: boolean; generate?: (facts: Record<string, unknown>) => Promise<unknown> } = {}) {
  const now = deps.now ?? Date.now();
  const market = await loadMarket(now, deps.fullHistory ? null : new Date(now - LOOKBACK_MS));
  if (deps.fullHistory) console.log(`[board] historical live set: ${market.ideas.length} ideas, ${market.signals.length} signals`);
  const previous = await activePost();
  const live = snapshotOf(
    market.signals.map((signal) => signal.id),
    market.ideas.map((idea) => idea.id),
    market.directionKey,
  );
  let action = decideBoard(live, previous ? snapshotOf(previous.signalIds, previous.ideaIds, previous.directionKey) : null);
  if (action === "keep" && previous && previous.promptVersion !== BOARD_PROMPT_VERSION) action = "call";
  if (action === "clear") {
    await deactivate();
    return { action };
  }
  if (action === "keep") return { action };
  try {
    const facts = {
      news: market.direction
        ? { lean: market.direction.lean, summary: market.direction.summary, spot: market.direction.spot, change60m: market.direction.change60m, headlines: market.direction.headlines.slice(0, 8).map((headline) => headline.text) }
        : null,
      ideas: market.ideas.map((idea) => ({
        id: idea.id,
        direction: idea.direction,
        entryMin: idea.entryMin,
        entryMax: idea.entryMax,
        stopLoss: idea.stopLoss,
        targets: idea.targets,
        sourceCount: idea.sourceCount,
      })),
      signals: market.signals.map((signal) => ({
        id: signal.id,
        direction: signal.direction,
        entryMin: signal.entryMin,
        entryMax: signal.entryMax,
        stopLoss: signal.stopLoss,
        signalTime: signal.signalTime.toISOString(),
      })),
      sourceRecord: {
        sources: market.sources.length,
        largestSample: market.sources.reduce((max, source) => Math.max(max, source.sampleSize), 0),
        smallSamples: market.sources.filter((source) => source.sampleSize < 10).length,
      },
    };
    const generated = deps.generate ? { model: "test", raw: await deps.generate(facts) } : await callModel(facts);
    const parsed = parseBoardOutput(generated.raw, new Set(live.ideaIds));
    const ideaLevels = market.ideas.map((idea) => ({ id: idea.id, stopLoss: idea.stopLoss, targets: idea.targets }));
    const primary = finishBoardPick(parsed.primary, ideaLevels);
    if (!primary) throw new Error("Board primary has no stop or targets");
    const alternates = parsed.alternates.flatMap((pick) => {
      const done = finishBoardPick(pick, ideaLevels);
      return done ? [done] : [];
    });
    const cardState = await labelPicks([primary, ...alternates], market.spot, now);
    const db = await getDb();
    await db.transaction(async (tx) => {
      await tx.update(boardPosts).set({ active: false }).where(eq(boardPosts.active, true));
      await tx.insert(boardPosts).values({
        active: true,
        model: generated.model,
        promptVersion: BOARD_PROMPT_VERSION,
        directionKey: live.directionKey,
        signalIds: live.signalIds,
        ideaIds: live.ideaIds,
        primary,
        alternates,
        cardState,
        labeledAt: new Date(now),
      });
    });
    return { action: "call" as const };
  } catch (err) {
    if (previous && !(await anyPickLive([previous.primary, ...previous.alternates], previous.createdAt.getTime(), market.spot))) await deactivate();
    return { action: "failed" as const, error: (err as Error).message };
  }
}

/** Price from before the board published the call is not a fill. */
function callStartedAt(stored: number | undefined, publishedAt: number) {
  if (stored == null || stored < publishedAt) return publishedAt;
  return stored;
}

/** Labels the handful of picks on one board. This runs in the queue, not on a page request. */
export async function labelPicks(picks: BoardPick[], spot: number | null, fallback: number): Promise<BoardCardState[]> {
  const slots: { slot: "primary" | number; pick: BoardPick }[] = picks.map((pick, index) => ({ slot: index === 0 ? "primary" : index - 1, pick }));
  const bars = await getEngineBars(new Date(fallback), new Date(Date.now() + 60_000));
  return slots.map((row) => {
    const played = replayIdea({ ...row.pick, startedAt: fallback }, bars, spot, true);
    return { slot: row.slot, phase: played.phase, startedAt: fallback };
  });
}

export async function publishBoardCards(spot: number | null) {
  const post = (await activePost()) ?? (await latestPost());
  if (!post) return false;
  const next = await labelPicks([post.primary, ...post.alternates], spot, post.createdAt.getTime());
  if (JSON.stringify(next) === JSON.stringify(post.cardState)) return false;
  const db = await getDb();
  await db.update(boardPosts).set({ cardState: next, labeledAt: new Date() }).where(eq(boardPosts.id, post.id));
  return true;
}

async function latestPost() {
  const db = await getDb();
  const [row] = await db.select().from(boardPosts).orderBy(desc(boardPosts.createdAt)).limit(1);
  return row ?? null;
}

export async function feedRevision() {
  const db = await getDb();
  const [row] = await db.select({ updatedAt: feedRevisions.updatedAt }).from(feedRevisions).where(eq(feedRevisions.id, "dashboard"));
  return row?.updatedAt.toISOString() ?? "";
}

export async function currentBoard(_spot: number | null = null) {
  const post = (await activePost()) ?? (await latestPost());
  if (!post) return { post: null as null, cards: [] as BoardCard[] };
  const picks: { slot: "primary" | number; pick: BoardPick }[] = [
    { slot: "primary", pick: post.primary },
    ...post.alternates.map((pick, index) => ({ slot: index, pick })),
  ];
  const states = new Map(post.cardState.map((state) => [String(state.slot), state]));
  const cards = picks.map(({ slot, pick }) => {
    const state = states.get(String(slot));
    const card: BoardCard = {
      postId: post.id,
      slot,
      pick,
      phase: state?.phase ?? "available",
      startedAt: callStartedAt(state?.startedAt, post.createdAt.getTime()),
    };
    return card;
  });
  return { post, cards };
}

export async function boardPick(postId: string, slot: string, spot: number | null) {
  const db = await getDb();
  const [post] = await db.select().from(boardPosts).where(eq(boardPosts.id, postId));
  if (!post) return null;
  const pick = slot === "primary" ? post.primary : post.alternates[Number(slot)];
  if (!pick || (slot !== "primary" && !Number.isInteger(Number(slot)))) return null;
  const price = spot ?? (await spotNow());
  const stored = post.cardState.find((state) => String(state.slot) === (slot === "primary" ? "primary" : String(Number(slot))));
  const startedAt = callStartedAt(stored?.startedAt, post.createdAt.getTime());
  const played = replayIdea({ ...pick, startedAt }, await getEngineBars(new Date(startedAt), new Date(Date.now() + 60_000)), price, true);
  const ideaRows = pick.ideaIds.length ? await db.select().from(consolidatedIdeas).where(inArray(consolidatedIdeas.id, pick.ideaIds)) : [];
  return { post, pick, slot: slot === "primary" ? ("primary" as const) : Number(slot), startedAt, phase: played.phase, outcome: played.outcome, ideas: ideaRows };
}
