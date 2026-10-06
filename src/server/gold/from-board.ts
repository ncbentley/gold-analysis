import { inArray } from "drizzle-orm";
import { currentBoard } from "@/server/board/service";
import { getDb } from "@/server/db";
import { consolidatedIdeas, signals, type BoardPick } from "@/server/db/schema";
import { replayIdea } from "@/server/ideas/replay";
import { getEngineBars, getRecentBars } from "@/server/market-data";
import type { GoldLevel } from "./geometry";
import { applyProposal } from "./publish";
import { sourcesRetired } from "./retire";
import { settleStoredGoldCloses } from "./settle-stored";
import { deleteGoldEntry, insertGoldEntry, linkGoldEntry, listGoldEntries, liveGoldLevels, markGoldClose } from "./store";

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
  const rows = ids
    .map((id) => stored.find((row) => (row.ideaId ?? row.id) === id && row.exitTime === null && !row.retired))
    .filter((row) => row != null);
  if (!rows.length) return sections;
  const from = Math.min(...rows.map((row) => row.createdAt.getTime()));
  const bars = await getEngineBars(new Date(from), new Date(Date.now() + 60_000));
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
    );
    sections.set(row.ideaId ?? row.id, played.outcome.entered ? "active" : "available");
  }
  return sections;
}

/** Puts the model's own prices on the Gold book. A pick with no silver idea is a new idea. */
export async function syncGoldBook(closeIds: string[] = []) {
  const justClosed = new Set(await closeRetiredGold());
  await collapseDuplicateGold();
  const db = await getDb();
  const stored = await listGoldEntries();
  const ideaRows = await db.select({ id: consolidatedIdeas.id }).from(consolidatedIdeas);
  const known = new Set(ideaRows.map((idea) => idea.id));
  const board = await currentBoard(null);
  const picks = board.post?.active ? [board.post.primary, ...board.post.alternates] : [];
  const sourceRetired = await retiredSourceIdeas([...new Set(picks.flatMap((pick) => pick.ideaIds))]);
  const liveRows = stored.filter((row) => row.exitTime === null && !row.retired && row.closeCalledAt === null);
  const postAt = board.post?.createdAt ?? null;
  const candidates: (GoldLevel & { targets: number[]; ideaId: string | null })[] = [];

  const blocked = (pick: BoardPick, ideaId: string | null) => {
    const cited = pick.ideaIds.filter((id) => known.has(id));
    if (cited.length && cited.every((id) => sourceRetired.has(id) || justClosed.has(id))) return true;
    if (!postAt) return false;
    return stored.some((row) => {
      if (!row.closeCalledAt || row.closeCalledAt < postAt) return false;
      return zoneSignature(row) === zoneSignature(pick) || (ideaId !== null && row.ideaId === ideaId);
    });
  };

  for (const pick of picks) {
    const cited = pick.ideaIds.filter((id) => known.has(id));
    const ideaId = cited.length === 1 ? cited[0] : null;
    if (blocked(pick, ideaId)) continue;
    const existing = liveRows.find((row) => zoneSignature(row) === zoneSignature(pick) || (ideaId !== null && row.ideaId === ideaId));
    if (existing) {
      if (!existing.ideaId && ideaId) await linkGoldEntry(existing.id, ideaId);
      continue;
    }
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
  }

  const live = liveGoldLevels(stored).filter((level) => !justClosed.has(level.id) && !sourceRetired.has(level.id));
  const sections = await closeSections(closeIds, stored);
  return applyProposal({
    ideas: candidates,
    live,
    propose: async () => ({ addIdeaIds: candidates.map((idea) => idea.id), closeIdeaIds: closeIds }),
    write: async (plan) => {
      const byId = new Map(candidates.map((idea) => [idea.id, idea]));
      for (const idea of plan.add) {
        const full = byId.get(idea.id);
        if (full) await insertGoldEntry(full);
      }
      for (const id of plan.closeIds) {
        await markGoldClose(id, new Date(), sections.get(id) ?? "available");
      }
    },
  });
}
