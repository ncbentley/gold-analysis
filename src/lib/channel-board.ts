export type ChannelKind = "channel" | "group";
export type ImportStatus = "queued" | "importing" | "caught_up" | "failed";

export interface BoardChat {
  id: string;
  accessHash: string | null;
  username: string | null;
  title: string;
  kind: ChannelKind;
}

export interface BoardSource {
  id: string;
  name: string;
  sourceType: string;
  telegramChannelId: string | null;
  telegramAccessHash: string | null;
  telegramUsername: string | null;
  sourceUrl: string | null;
  description: string | null;
  syncError: string | null;
  importStatus: ImportStatus | null;
  active: boolean;
  isQa: boolean;
  starred: boolean;
  /** False when the source is headlines only. */
  parseSignals: boolean;
}

/** One joined chat or tracked Telegram source, keyed by the Telegram channel id. */
export interface BoardChannel {
  id: string;
  title: string;
  username: string | null;
  link: string | null;
  kind: ChannelKind;
  accessHash: string | null;
  sourceId: string | null;
  winRate: number | null;
  error: string | null;
  importStatus: ImportStatus | null;
  active: boolean;
  isQa: boolean;
  starred: boolean;
  tracked: boolean;
}

export function channelLink(username: string | null, sourceUrl?: string | null) {
  if (username) return `https://t.me/${username}`;
  if (sourceUrl && /t\.me\//i.test(sourceUrl)) return sourceUrl;
  return null;
}

function kindFromDescription(description: string | null): ChannelKind {
  return description?.startsWith("Telegram group") ? "group" : "channel";
}

/** Joined chats plus tracked sources, including sources the account is no longer in. */
export function buildChannelBoard(chats: BoardChat[], sources: BoardSource[], winRates: ReadonlyMap<string, number | null>): BoardChannel[] {
  const byId = new Map<string, BoardChannel>();
  for (const chat of chats) {
    byId.set(chat.id, {
      id: chat.id,
      title: chat.title,
      username: chat.username,
      link: channelLink(chat.username),
      kind: chat.kind,
      accessHash: chat.accessHash,
      sourceId: null,
      winRate: null,
      error: null,
      importStatus: null,
      active: true,
      isQa: false,
      starred: false,
      tracked: false,
    });
  }
  for (const source of sources) {
    if (source.sourceType !== "telegram" || !source.telegramChannelId) continue;
    const existing = byId.get(source.telegramChannelId);
    const username = source.telegramUsername ?? existing?.username ?? null;
    byId.set(source.telegramChannelId, {
      id: source.telegramChannelId,
      title: source.name || existing?.title || "Untitled",
      username,
      link: channelLink(username, source.sourceUrl ?? existing?.link),
      kind: existing?.kind ?? kindFromDescription(source.description),
      accessHash: source.telegramAccessHash ?? existing?.accessHash ?? null,
      sourceId: source.id,
      winRate: winRates.get(source.id) ?? null,
      error: source.syncError,
      importStatus: source.importStatus,
      active: source.active,
      isQa: source.isQa,
      starred: source.starred,
      tracked: source.parseSignals,
    });
  }
  return [...byId.values()].sort((a, b) => {
    const title = a.title.toLowerCase();
    const other = b.title.toLowerCase();
    if (title < other) return -1;
    if (title > other) return 1;
    if (a.id < b.id) return -1;
    if (a.id > b.id) return 1;
    return 0;
  });
}

export function matchesChannelSearch(channel: Pick<BoardChannel, "title" | "username" | "link">, query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const handle = channel.username?.toLowerCase() ?? "";
  const link = channel.link?.toLowerCase() ?? "";
  const bare = needle.replace(/^@/, "").replace(/^https?:\/\//, "").replace(/^t\.me\//, "");
  return (
    channel.title.toLowerCase().includes(needle) ||
    (handle !== "" && (handle.includes(bare) || `@${handle}`.includes(needle))) ||
    (link !== "" && (link.includes(needle) || link.includes(bare)))
  );
}

export function hasChannelError(channel: Pick<BoardChannel, "error" | "importStatus">) {
  return Boolean(channel.error) || channel.importStatus === "failed";
}

/** Empty is unset. A number is clamped to 0–100 and returned as a 0–1 rate. */
export function parseWinRatePercent(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return null;
  return Math.min(100, Math.max(0, n)) / 100;
}

export interface TrackedColumnFilter {
  query: string;
  errorsOnly: boolean;
  minWinRate: number | null;
  maxWinRate: number | null;
}

export function matchesTrackedColumn(channel: BoardChannel, filter: TrackedColumnFilter) {
  if (!matchesChannelSearch(channel, filter.query)) return false;
  if (filter.errorsOnly && !hasChannelError(channel)) return false;
  if (filter.minWinRate !== null && filter.maxWinRate !== null && filter.minWinRate > filter.maxWinRate) return false;
  if (filter.minWinRate !== null || filter.maxWinRate !== null) {
    if (channel.winRate === null) return false;
    if (filter.minWinRate !== null && channel.winRate < filter.minWinRate) return false;
    if (filter.maxWinRate !== null && channel.winRate > filter.maxWinRate) return false;
  }
  return true;
}

export type ChannelSortKey = "channel" | "winRate";
export type ChannelSortDir = "asc" | "desc";

export interface ChannelSort {
  key: ChannelSortKey;
  dir: ChannelSortDir;
}

function compareText(a: string, b: string) {
  const left = a.toLowerCase();
  const right = b.toLowerCase();
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareChannel(a: BoardChannel, b: BoardChannel) {
  const title = compareText(a.title, b.title);
  if (title !== 0) return title;
  return compareText(a.id, b.id);
}

/** Missing win rates stay at the bottom in either direction. Equal rates fall back to channel name. */
export function sortChannels(channels: readonly BoardChannel[], sort: ChannelSort): BoardChannel[] {
  const sign = sort.dir === "asc" ? 1 : -1;
  return [...channels].sort((a, b) => {
    if (sort.key === "winRate") {
      if (a.winRate === null && b.winRate === null) return compareChannel(a, b);
      if (a.winRate === null) return 1;
      if (b.winRate === null) return -1;
      if (a.winRate !== b.winRate) return (a.winRate - b.winRate) * sign;
      return compareChannel(a, b);
    }
    return compareChannel(a, b) * sign;
  });
}

export function trackingChanges(channels: BoardChannel[], trackedIds: ReadonlySet<string>) {
  const saved = new Set(channels.filter((channel) => channel.tracked).map((channel) => channel.id));
  const add = channels.filter((channel) => trackedIds.has(channel.id) && !saved.has(channel.id));
  const remove = channels.filter((channel) => !trackedIds.has(channel.id) && saved.has(channel.id) && channel.sourceId);
  return { add, remove, dirty: add.length > 0 || remove.length > 0 };
}
