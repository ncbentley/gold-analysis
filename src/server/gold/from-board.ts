import { gte, inArray } from "drizzle-orm";
import { currentBoard } from "@/server/board/service";
import { getDb } from "@/server/db";
import { consolidatedIdeas, signals, type BoardPick } from "@/server/db/schema";
import { callCovered } from "@/server/ideas/phase";
import { replayIdea } from "@/server/ideas/replay";
import { MIN_CONSOLIDATED_SOURCES, replayConsolidatedIdeas } from "@/server/ideas/service";
import { getEngineBars, getEngineTicks, getRecentBars } from "@/server/market-data";
import { CLOSE_HOLD_MS } from "./close";
import type { GoldLevel } from "./geometry";
import { applyProposal } from "./publish";
import { entryLeftBehind, filledTradeStillOpen, goldBookAction, goldCallOutsideSilver, goldIdsOverSilverCount } from "./qualify";
import { sourcesRetired } from "./retire";
import { reviseOpenCall, sameGoldEntry } from "./revise";
import { settleStoredGoldCloses } from "./settle-stored";
import { clearGoldClose, deleteGoldEntry, insertGoldEntry, linkGoldEntry, listGoldEntries, liveGoldLevels, markGoldClose, updateGoldLevels } from "./store";

function cents(price: number) {
  return Math.round(price * 100);
}

/** Same direction and the same prices the member sees. A composed copy of a sourced call is one zone. */
export function zoneSignature(level: { direction: string; entryMin: number; entryMax: number; stopLoss: number | null; targets: number[] }) {
  return [level.direction, cents(level.entryMin), cents(level.entryMax), level.stopLoss == null ? "" : cents(level.stopLoss), level.targets.map(cents).join(",")].join("|");
}

/** Drops a second live row for a zone already on the book. Keeps the sourced call, then the earlier one. */
export async function collapseDuplicateGold() {
  const rows = await listGoldEntries();
  const live = rows.filter((row) => row.exitTime === null && !row.retired && row.closeCalledAt === null);
  const groups = new Map<string, typeof live>();
  for (const row of live) {
    const key = zoneSignature(row);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const removed: string[] = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const [keep, ...extras] = [...group].sort((a, b) => {
      if (Boolean(a.ideaId) !== Boolean(b.ideaId)) return a.ideaId ? -1 : 1;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });
    for (const extra of extras) {
      if (!keep.ideaId && extra.ideaId) await linkGoldEntry(keep.id, extra.ideaId);
      await deleteGoldEntry(extra.id);
      removed.push(extra.id);
    }
  }
  return removed;
}

async function retiredSourceIdeas(ideaIds: string[]) {
  const retired = new Set<string>();
  if (!ideaIds.length) return retired;
  const db = await getDb();
  const ideas = await db
    .select({ id: consolidatedIdeas.id, signalIds: consolidatedIdeas.signalIds })
    .from(consolidatedIdeas)
    .where(inArray(consolidatedIdeas.id, ideaIds));
  const signalIds = [...new Set(ideas.flatMap((idea) => idea.signalIds))];
  const members = signalIds.length
    ? await db.select({ id: signals.id, status: signals.status }).from(signals).where(inArray(signals.id, signalIds))
    : [];
  const byId = new Map(members.map((member) => [member.id, member]));
  for (const idea of ideas) {
    const roster = idea.signalIds.map((id) => byId.get(id)).filter((member) => member != null);
    if (sourcesRetired(roster.map((member) => ({ status: member.status, outcome: null })))) retired.add(idea.id);
  }
  return retired;
}

/** Silver's available book: three or more sources, price still able to fill, sources not all expired. */
export async function silverAvailableIds(spot: number | null) {
  const db = await getDb();
  const rows = await db.select().from(consolidatedIdeas).where(gte(consolidatedIdeas.sourceCount, MIN_CONSOLIDATED_SOURCES));
  const ids = new Set<string>();
  if (!rows.length) return ids;
  const played = await replayConsolidatedIdeas(rows, spot);
  const signalIds = [...new Set(rows.flatMap((idea) => idea.signalIds))];
  const members = signalIds.length
    ? await db.select({ id: signals.id, status: signals.status }).from(signals).where(inArray(signals.id, signalIds))
    : [];
  const byId = new Map(members.map((member) => [member.id, member]));
  for (const row of rows) {
    if (played.get(row.id)?.phase !== "available") continue;
    const roster = row.signalIds.map((id) => byId.get(id)).filter((member) => member != null);
    if (roster.length && sourcesRetired(roster.map((member) => ({ status: member.status, outcome: null })))) continue;
    ids.add(row.id);
  }
  return ids;
}

/** Puts a bad close back, closes an old call price has left, and keeps unfilled Gold inside the silver book. */
export async function reconcileGoldBook(now = new Date()) {
  const [bar] = (await getRecentBars(1)).slice(-1);
  const spot = bar?.close ?? null;
  const silver = await silverAvailableIds(spot);
  const rows = await listGoldEntries();
  const db = await getDb();
  const ideaIds = rows.map((row) => row.ideaId).filter((id): id is string => Boolean(id));
  const ideas = ideaIds.length
    ? await db.select({ id: consolidatedIdeas.id, newestSignalAt: consolidatedIdeas.newestSignalAt }).from(consolidatedIdeas).where(inArray(consolidatedIdeas.id, ideaIds))
    : [];
  const calledAtByIdea = new Map(ideas.map((idea) => [idea.id, idea.newestSignalAt.getTime()]));
  const open = rows.filter((row) => row.exitTime === null || row.closeCalledAt !== null);
  if (!open.length) return { closed: [] as string[], reopened: [] as string[], silver, openUnfilled: 0 };
  const from = Math.min(...open.map((row) => row.createdAt.getTime()));
  const windowStart = new Date(from);
  const windowEnd = new Date(now.getTime() + 60_000);
  const [bars, ticks] = await Promise.all([getEngineBars(windowStart, windowEnd), getEngineTicks(windowStart, windowEnd)]);
  const closed: string[] = [];
  const reopened: string[] = [];
  const capRows: { id: string; ideaId: string | null; createdAt: number }[] = [];
  const closeUnfilled = async (id: string, createdAt: number) => {
    const closeAt = new Date(Math.min(createdAt, now.getTime() - CLOSE_HOLD_MS - 1));
    await markGoldClose(id, closeAt, "available");
    closed.push(id);
  };
  for (const row of rows) {
    if (row.exitTime !== null && row.closeCalledAt === null) continue;
    const played = replayIdea(
      {
        direction: row.direction,
        entryMin: row.entryMin,
        entryMax: row.entryMax,
        stopLoss: row.stopLoss,
        targets: row.targets,
        startedAt: row.createdAt.getTime(),
      },
      bars,
      spot,
      true,
      ticks,
    );
    const ideaCalledAt = row.ideaId ? calledAtByIdea.get(row.ideaId) : undefined;
    const calledAt = ideaCalledAt == null ? row.createdAt.getTime() : Math.min(row.createdAt.getTime(), ideaCalledAt);
    const covered = callCovered(bars, row.createdAt.getTime());
    const action = goldBookAction({
      closeCalledAt: row.closeCalledAt ? row.closeCalledAt.getTime() : null,
      entered: played.outcome.entered,
      stopHitAt: played.outcome.stopHitAt,
      targets: played.outcome.targets,
      covered,
      leftBehind: covered && entryLeftBehind({
        direction: row.direction,
        entryMin: row.entryMin,
        entryMax: row.entryMax,
        stopLoss: row.stopLoss,
        spot,
        calledAt,
        now: now.getTime(),
      }),
      outsideSilver: goldCallOutsideSilver({ ideaId: row.ideaId, silverAvailable: silver }),
    });
    if (action === "reopen") {
      await clearGoldClose(row.id);
      reopened.push(row.id);
      continue;
    }
    const bookId = row.ideaId ?? row.id;
    if (action === "close" && !row.closeCalledAt && !row.exitTime) {
      await closeUnfilled(bookId, row.createdAt.getTime());
      continue;
    }
    if (!row.closeCalledAt && !row.exitTime && !played.outcome.entered) {
      capRows.push({ id: bookId, ideaId: row.ideaId, createdAt: row.createdAt.getTime() });
    }
  }
  const over = new Set(goldIdsOverSilverCount({ rows: capRows, silverCount: silver.size }));
  for (const id of over) {
    const row = capRows.find((item) => item.id === id);
    if (row) await closeUnfilled(id, row.createdAt);
  }
  if (closed.length) await settleStoredGoldCloses();
  return { closed, reopened, silver, openUnfilled: capRows.filter((row) => !over.has(row.id)).length };
}

/** Takes Gold calls off the book once every source they used has expired or been cancelled without a fill. */
export async function closeRetiredGold(now = new Date()) {
  const db = await getDb();
  const rows = await listGoldEntries();
  const live = rows.filter((row) => row.exitTime === null && !row.retired && row.closeCalledAt === null && row.ideaId);
  if (!live.length) return [];
  const ideas = await db.select().from(consolidatedIdeas).where(inArray(consolidatedIdeas.id, live.map((row) => row.ideaId!)));
  const signalIds = [...new Set(ideas.flatMap((idea) => idea.signalIds))];
  const members = signalIds.length
    ? await db.select({ id: signals.id, status: signals.status, closedAt: signals.closedAt }).from(signals).where(inArray(signals.id, signalIds))
    : [];
  const byId = new Map(members.map((member) => [member.id, member]));
  const closed: string[] = [];
  for (const row of live) {
    const idea = ideas.find((item) => item.id === row.ideaId);
    if (!idea) continue;
    const roster = idea.signalIds.map((id) => byId.get(id)).filter((member) => member != null);
    if (!sourcesRetired(roster.map((member) => ({ status: member.status, outcome: null })))) continue;
    const calledAt = roster.reduce<Date | null>((latest, member) => {
      if (!member.closedAt) return latest;
      return !latest || member.closedAt > latest ? member.closedAt : latest;
    }, null) ?? now;
    await markGoldClose(row.ideaId!, calledAt, "available");
    closed.push(row.ideaId!);
  }
  if (closed.length) await settleStoredGoldCloses();
  return closed;
}

async function closeSections(ids: string[], stored: Awaited<ReturnType<typeof listGoldEntries>>) {
  const sections = new Map<string, "available" | "active">();
  const working = new Set<string>();
  const rows = ids
    .map((id) => stored.find((row) => (row.ideaId ?? row.id) === id && row.exitTime === null && !row.retired))
    .filter((row) => row != null);
  if (!rows.length) return { sections, working };
  const from = Math.min(...rows.map((row) => row.createdAt.getTime()));
  const windowStart = new Date(from);
  const windowEnd = new Date(Date.now() + 60_000);
  const [bars, ticks] = await Promise.all([getEngineBars(windowStart, windowEnd), getEngineTicks(windowStart, windowEnd)]);
  const [bar] = (await getRecentBars(1)).slice(-1);
  for (const row of rows) {
    const played = replayIdea(
      {
        direction: row.direction,
        entryMin: row.entryMin,
        entryMax: row.entryMax,
        stopLoss: row.stopLoss,
        targets: row.targets,
        startedAt: row.createdAt.getTime(),
      },
      bars,
      bar?.close ?? null,
      true,
      ticks,
    );
    const id = row.ideaId ?? row.id;
    if (filledTradeStillOpen(played.outcome)) {
      working.add(id);
      continue;
    }
    sections.set(id, played.outcome.entered ? "active" : "available");
  }
  return { sections, working };
}

/** Levels the model rewrote on a call that is already live. Hit targets stay. */
async function levelEdits(pending: { row: Awaited<ReturnType<typeof listGoldEntries>>[number]; nextTargets: number[]; nextStop: number | null }[]) {
  if (!pending.length) return [];
  const from = Math.min(...pending.map((item) => item.row.createdAt.getTime()));
  const windowStart = new Date(from);
  const windowEnd = new Date(Date.now() + 60_000);
  const [bars, ticks] = await Promise.all([getEngineBars(windowStart, windowEnd), getEngineTicks(windowStart, windowEnd)]);
  const edits: { id: string; bookId: string; stopLoss: number | null; targets: number[] }[] = [];
  for (const item of pending) {
    const played = replayIdea(
      {
        direction: item.row.direction,
        entryMin: item.row.entryMin,
        entryMax: item.row.entryMax,
        stopLoss: item.row.stopLoss,
        targets: item.row.targets,
        startedAt: item.row.createdAt.getTime(),
      },
      bars,
      null,
      true,
      ticks,
    );
    const revised = reviseOpenCall({
      entered: played.outcome.entered,
      stopLoss: item.row.stopLoss,
      nextStop: item.nextStop,
      currentTargets: item.row.targets,
      nextTargets: item.nextTargets,
      hit: played.outcome.targets.map((target) => target.hitAt !== null),
    });
    if (!revised.edited) continue;
    edits.push({ id: item.row.id, bookId: item.row.ideaId ?? item.row.id, stopLoss: revised.stopLoss, targets: revised.targets });
  }
  return edits;
}

/** Puts the model's own prices on the Gold book. A pick with no silver idea is a new idea. */
export async function syncGoldBook(closeIds: string[] = []) {
  const justClosed = new Set(await closeRetiredGold());
  await collapseDuplicateGold();
  const reconciled = await reconcileGoldBook();
  for (const id of reconciled.closed) justClosed.add(id);
  const silver = reconciled.silver;
  const db = await getDb();
  const stored = await listGoldEntries();
  const [spotBar] = (await getRecentBars(1)).slice(-1);
  const spot = spotBar?.close ?? null;
  const ideaRows = await db.select({ id: consolidatedIdeas.id, newestSignalAt: consolidatedIdeas.newestSignalAt }).from(consolidatedIdeas);
  const known = new Set(ideaRows.map((idea) => idea.id));
  const ideaCalledAt = new Map(ideaRows.map((idea) => [idea.id, idea.newestSignalAt.getTime()]));
  const board = await currentBoard(null);
  const picks = board.post?.active ? [board.post.primary, ...board.post.alternates] : [];
  const sourceRetired = await retiredSourceIdeas([...new Set(picks.flatMap((pick) => pick.ideaIds))]);
  const liveRows = stored.filter((row) => row.exitTime === null && !row.retired && row.closeCalledAt === null);
  const pendingEdits = new Map<string, { row: (typeof liveRows)[number]; nextTargets: number[]; nextStop: number | null }>();
  const postAt = board.post?.createdAt ?? null;
  const candidates: (GoldLevel & { targets: number[]; ideaId: string | null })[] = [];
  let room = Math.max(0, silver.size - reconciled.openUnfilled);
  const ranked = [...picks].sort((a, b) => {
    const score = (pick: BoardPick) => (pick.ideaIds.some((id) => silver.has(id)) ? 0 : 1);
    return score(a) - score(b);
  });

  const blocked = (pick: BoardPick, ideaId: string | null) => {
    const cited = pick.ideaIds.filter((id) => known.has(id));
    if (cited.length && cited.every((id) => sourceRetired.has(id) || justClosed.has(id))) return true;
    if (!postAt) return false;
    return stored.some((row) => {
      if (!row.closeCalledAt || row.closeCalledAt < postAt) return false;
      return zoneSignature(row) === zoneSignature(pick) || (ideaId !== null && row.ideaId === ideaId);
    });
  };

  for (const pick of ranked) {
    const cited = pick.ideaIds.filter((id) => known.has(id));
    if (cited.some((id) => !silver.has(id))) continue;
    if (!cited.length && silver.size === 0) continue;
    const ideaId = cited.length === 1 ? cited[0] : null;
    const prior = stored.find((row) => zoneSignature(row) === zoneSignature(pick));
    const ideaCall = ideaId ? ideaCalledAt.get(ideaId) : undefined;
    const calledAt = ideaCall != null && prior ? Math.min(ideaCall, prior.createdAt.getTime()) : (ideaCall ?? prior?.createdAt.getTime() ?? Date.now());
    if (
      entryLeftBehind({
        direction: pick.direction,
        entryMin: pick.entryMin,
        entryMax: pick.entryMax,
        stopLoss: pick.stopLoss,
        spot,
        calledAt,
        now: Date.now(),
      })
    ) {
      continue;
    }
    if (blocked(pick, ideaId)) continue;
    const entryMatch = liveRows.find((row) => sameGoldEntry(row, pick));
    const existing = liveRows.find((row) => zoneSignature(row) === zoneSignature(pick) || (ideaId !== null && row.ideaId === ideaId)) ?? entryMatch;
    if (existing) {
      if (entryMatch && zoneSignature(entryMatch) !== zoneSignature(pick)) {
        pendingEdits.set(entryMatch.id, { row: entryMatch, nextTargets: pick.targets, nextStop: pick.stopLoss });
      }
      if (!existing.ideaId && ideaId) await linkGoldEntry(existing.id, ideaId);
      continue;
    }
    if (room <= 0) continue;
    const twin = candidates.findIndex((idea) => zoneSignature(idea) === zoneSignature(pick) || (ideaId !== null && idea.ideaId === ideaId));
    if (twin >= 0) {
      if (!candidates[twin].ideaId && ideaId) candidates[twin] = { ...candidates[twin], id: ideaId, ideaId };
      continue;
    }
    candidates.push({
      id: ideaId ?? crypto.randomUUID(),
      ideaId,
      direction: pick.direction,
      entryMin: pick.entryMin,
      entryMax: pick.entryMax,
      stopLoss: pick.stopLoss,
      targets: pick.targets,
    });
    room -= 1;
  }

  const edits = await levelEdits([...pendingEdits.values()]);
  for (const edit of edits) await updateGoldLevels(edit.id, { stopLoss: edit.stopLoss, targets: edit.targets });
  const edited = new Set(edits.map((edit) => edit.bookId));
  const live = liveGoldLevels(stored).filter((level) => !justClosed.has(level.id) && !sourceRetired.has(level.id));
  const requestedCloses = closeIds.filter((id) => !edited.has(id));
  const judged = await closeSections(requestedCloses, stored);
  const closable = requestedCloses.filter((id) => !judged.working.has(id) && judged.sections.has(id));
  return applyProposal({
    ideas: candidates,
    live,
    propose: async () => ({ addIdeaIds: candidates.map((idea) => idea.id), closeIdeaIds: closable }),
    write: async (plan) => {
      const byId = new Map(candidates.map((idea) => [idea.id, idea]));
      for (const idea of plan.add) {
        const full = byId.get(idea.id);
        if (full) await insertGoldEntry(full);
      }
      for (const id of plan.closeIds) {
        await markGoldClose(id, new Date(), judged.sections.get(id) ?? "available");
      }
    },
  });
}
