import { eq, sql } from "drizzle-orm";
import { currentBoard, type BoardCard } from "@/server/board/service";
import { getDb } from "@/server/db";
import { boardPosts, consolidatedIdeas, dashboardSnapshots, feedRevisions, marketDirectionSnapshots, signalTargets, signals, sourceStats } from "@/server/db/schema";
import { latestMarketDirection } from "@/server/direction/service";
import { buildAccess, freeAccess } from "@/server/entitlements/access";
import { getTierConfig, type Viewer } from "@/server/entitlements/service";
import { listIdeasForViewer } from "@/server/ideas/service";
import { getRecentBars } from "@/server/market-data";
import { countOpenSignalsForViewer, listSignalsForViewer, listTopSourcesForViewer } from "@/server/signals/queries";
import type { ListedIdea } from "@/server/ideas/service";
import type { SignalListItem } from "@/server/presenters";

const CACHE_VERSION = "v1";

export const DASHBOARD_VIEWS = ["admin", "gold", "silver", "free"] as const;
export type DashboardView = (typeof DASHBOARD_VIEWS)[number];

export function dashboardViewFor(access: { isAdmin: boolean; tier: string | null }): DashboardView {
  if (access.isAdmin) return "admin";
  if (access.tier === "gold") return "gold";
  if (access.tier === "silver") return "silver";
  return "free";
}

export interface DashboardCache {
  spot: { close: number; timestamp: string } | null;
  direction: {
    lean: "bid" | "defensive" | "offered";
    label: string;
    summary: string;
    headlines: { sourceId: string; sourceName: string; text: string; publishedAt: string }[];
    spot: number | null;
    change60m: number | null;
    createdAt: string;
  } | null;
  ranking: {
    rows: { sourceId: string; name: string; closedTrades: number; metrics: { winRate: number | null; expectancy: number | null } | null }[];
    eligibleCount: number;
    sourceCount: number;
  };
  signals: {
    open: SignalListItem[];
    closed: SignalListItem[];
    active: number;
    pending: number;
    total: number;
  } | null;
  ideas: { live: ListedIdea[]; history: ListedIdea[] } | null;
  board: { active: boolean; live: BoardCard[]; playing: BoardCard[]; history: BoardCard[] } | null;
}

async function viewerFor(view: DashboardView, config: Awaited<ReturnType<typeof getTierConfig>>): Promise<Viewer> {
  const access = view === "admin" ? buildAccess(null, config, true) : view === "free" ? freeAccess() : buildAccess(view, config, false);
  return { user: null, access, config, subscription: null, viewAs: null };
}

function iso(value: Date | string | null | undefined) {
  if (!value) return "";
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

async function fingerprint() {
  const db = await getDb();
  const [signalsRow] = await db
    .select({
      n: sql<number>`count(*)::int`,
      newest: sql<Date | null>`max(${signals.signalTime})`,
      active: sql<number>`count(*) filter (where ${signals.status} in ('ACTIVE', 'PARTIAL'))::int`,
      pending: sql<number>`count(*) filter (where ${signals.status} = 'PENDING')::int`,
      digest: sql<string>`md5(coalesce(string_agg(${signals.id} || '|' || ${signals.status} || '|' || ${signals.version}::text || '|' || ${signals.entryMin}::text || '|' || ${signals.entryMax}::text || '|' || coalesce(${signals.stopLoss}::text, ''), ',' order by ${signals.id}), ''))`,
    })
    .from(signals);
  const [targets] = await db
    .select({ hits: sql<number>`count(*) filter (where ${signalTargets.status} = 'HIT')::int` })
    .from(signalTargets);
  const [ideasRow] = await db
    .select({
      n: sql<number>`count(*)::int`,
      newest: sql<Date | null>`max(${consolidatedIdeas.newestSignalAt})`,
      available: sql<number>`count(*) filter (where ${consolidatedIdeas.phase} = 'available' and ${consolidatedIdeas.sourceCount} >= 3)::int`,
      playing: sql<number>`count(*) filter (where ${consolidatedIdeas.phase} = 'playing-out' and ${consolidatedIdeas.sourceCount} >= 3)::int`,
      history: sql<number>`count(*) filter (where ${consolidatedIdeas.phase} = 'history' and ${consolidatedIdeas.sourceCount} >= 3)::int`,
      digest: sql<string>`md5(coalesce(string_agg(${consolidatedIdeas.id} || '|' || ${consolidatedIdeas.phase} || '|' || ${consolidatedIdeas.sourceCount}::text || '|' || ${consolidatedIdeas.entryMin}::text || '|' || ${consolidatedIdeas.entryMax}::text || '|' || ${consolidatedIdeas.direction} || '|' || ${consolidatedIdeas.signalIds}::text, ',' order by ${consolidatedIdeas.id}), ''))`,
    })
    .from(consolidatedIdeas);
  const [stats] = await db.select({ newest: sql<Date | null>`max(${sourceStats.computedAt})` }).from(sourceStats);
  const [board] = await db
    .select({ id: boardPosts.id, labeledAt: boardPosts.labeledAt })
    .from(boardPosts)
    .where(eq(boardPosts.active, true))
    .orderBy(sql`${boardPosts.createdAt} desc`)
    .limit(1);
  const [direction] = await db
    .select({ id: marketDirectionSnapshots.id })
    .from(marketDirectionSnapshots)
    .orderBy(sql`${marketDirectionSnapshots.createdAt} desc`)
    .limit(1);
  return [
    CACHE_VERSION,
    signalsRow?.n ?? 0,
    iso(signalsRow?.newest),
    signalsRow?.active ?? 0,
    signalsRow?.pending ?? 0,
    signalsRow?.digest ?? "",
    targets?.hits ?? 0,
    ideasRow?.n ?? 0,
    iso(ideasRow?.newest),
    ideasRow?.available ?? 0,
    ideasRow?.playing ?? 0,
    ideasRow?.history ?? 0,
    ideasRow?.digest ?? "",
    iso(stats?.newest),
    board?.id ?? "",
    iso(board?.labeledAt),
    direction?.id ?? "",
  ].join("|");
}

async function buildSnapshot(view: DashboardView, config: Awaited<ReturnType<typeof getTierConfig>>): Promise<DashboardCache> {
  const viewer = await viewerFor(view, config);
  const [lastBar] = (await getRecentBars(1)).slice(-1);
  const direction = await latestMarketDirection();
  const ranking = await listTopSourcesForViewer(viewer, 5);
  const cache: DashboardCache = {
    spot: lastBar ? { close: lastBar.close, timestamp: lastBar.timestamp.toISOString() } : null,
    direction: direction
      ? { ...direction, createdAt: direction.createdAt instanceof Date ? direction.createdAt.toISOString() : direction.createdAt }
      : null,
    ranking,
    signals: null,
    ideas: null,
    board: null,
  };
  if (view === "silver") {
    const ideas = await listIdeasForViewer(viewer, lastBar?.close ?? null);
    cache.ideas = {
      live: ideas.filter((idea) => idea.phase !== "history"),
      history: ideas.filter((idea) => idea.phase === "history"),
    };
  } else if (view === "gold") {
    const board = await currentBoard(lastBar?.close ?? null);
    const cards = board.post?.active ? board.cards : [];
    const retired = board.post?.active ? [] : board.cards;
    cache.board = {
      active: board.post?.active ?? false,
      live: cards.filter((card) => card.phase === "available"),
      playing: cards.filter((card) => card.phase === "playing-out"),
      history: [...cards.filter((card) => card.phase === "history"), ...retired],
    };
  } else {
    const [open, closed, counts] = await Promise.all([
      listSignalsForViewer(viewer, { status: "OPEN" }, { limit: 20, segment: true }),
      listSignalsForViewer(viewer, { status: "CLOSED" }, { limit: 10, segment: true }),
      countOpenSignalsForViewer(viewer),
    ]);
    cache.signals = {
      open: open.items,
      closed: closed.items,
      active: counts.active,
      pending: counts.pending,
      total: open.total + closed.total,
    };
  }
  return cache;
}

/** Rebuilds the four dashboard snapshots when the stored inputs changed. Returns whether a page should refresh. */
export async function syncDashboardCache() {
  const db = await getDb();
  const next = await fingerprint();
  const [mark] = await db.select({ fingerprint: feedRevisions.fingerprint }).from(feedRevisions).where(eq(feedRevisions.id, "dashboard"));
  const [existing] = await db.select({ n: sql<number>`count(*)::int` }).from(dashboardSnapshots);
  if (mark?.fingerprint === next && (existing?.n ?? 0) >= DASHBOARD_VIEWS.length) return false;
  const config = await getTierConfig();
  for (const view of DASHBOARD_VIEWS) {
    const payload = await buildSnapshot(view, config);
    await db
      .insert(dashboardSnapshots)
      .values({ view, payload: payload as unknown as Record<string, unknown>, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: dashboardSnapshots.view,
        set: { payload: payload as unknown as Record<string, unknown>, updatedAt: new Date() },
      });
  }
  await db.update(feedRevisions).set({ fingerprint: next, updatedAt: new Date() }).where(eq(feedRevisions.id, "dashboard"));
  return true;
}

export async function readDashboardSnapshot(view: DashboardView): Promise<DashboardCache | null> {
  const db = await getDb();
  const [row] = await db.select({ payload: dashboardSnapshots.payload }).from(dashboardSnapshots).where(eq(dashboardSnapshots.view, view));
  return (row?.payload as unknown as DashboardCache | undefined) ?? null;
}
