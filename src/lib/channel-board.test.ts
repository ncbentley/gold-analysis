import { describe, expect, it } from "vitest";
import {
  buildChannelBoard,
  matchesChannelSearch,
  matchesTrackedColumn,
  parseWinRatePercent,
  sortChannels,
  trackingChanges,
  type BoardChannel,
  type BoardChat,
  type BoardSource,
} from "./channel-board";

const chat = (patch: Partial<BoardChat> & Pick<BoardChat, "id" | "title">): BoardChat => ({
  accessHash: "11",
  username: null,
  kind: "channel",
  ...patch,
});

const source = (patch: Partial<BoardSource> & Pick<BoardSource, "id" | "telegramChannelId">): BoardSource => ({
  name: "Desk",
  sourceType: "telegram",
  telegramAccessHash: "22",
  telegramUsername: null,
  sourceUrl: null,
  description: "Telegram channel Desk",
  syncError: null,
  importStatus: "caught_up",
  active: true,
  isQa: false,
  ...patch,
});

function row(patch: Partial<BoardChannel> & Pick<BoardChannel, "id" | "title">): BoardChannel {
  return {
    username: null,
    link: null,
    kind: "channel",
    accessHash: null,
    sourceId: "src",
    winRate: null,
    error: null,
    importStatus: null,
    active: true,
    isQa: false,
    tracked: true,
    ...patch,
  };
}

describe("buildChannelBoard", () => {
  it("puts joined chats on the left and overlays tracked sources on the right", () => {
    const board = buildChannelBoard(
      [chat({ id: "1", title: "Open", username: "open_desk" }), chat({ id: "2", title: "Kept", username: "kept" })],
      [source({ id: "s2", name: "Kept", telegramChannelId: "2", telegramUsername: "kept", syncError: "flood", isQa: true })],
      new Map([["s2", 0.62]]),
    );
    expect(board.map((channel) => [channel.title, channel.tracked, channel.winRate, channel.link])).toEqual([
      ["Kept", true, 0.62, "https://t.me/kept"],
      ["Open", false, null, "https://t.me/open_desk"],
    ]);
    expect(board[0]).toMatchObject({ sourceId: "s2", error: "flood", isQa: true, kind: "channel" });
  });

  it("keeps a tracked source that is missing from the joined list", () => {
    const board = buildChannelBoard([], [source({ id: "s9", name: "Left behind", telegramChannelId: "9", description: "Telegram group Room", telegramUsername: null })], new Map());
    expect(board).toEqual([
      expect.objectContaining({ id: "9", title: "Left behind", kind: "group", tracked: true, link: null, winRate: null }),
    ]);
  });

  it("ignores webhook sources", () => {
    expect(buildChannelBoard([], [source({ id: "w", telegramChannelId: null, sourceType: "webhook", name: "Hook" })], new Map())).toEqual([]);
  });
});

describe("channel filters", () => {
  const gold = row({ id: "1", title: "Gold Desk", username: "golddesk", link: "https://t.me/golddesk", winRate: 0.7, error: "timeout" });

  it("matches name, handle, and link", () => {
    expect(matchesChannelSearch(gold, "gold desk")).toBe(true);
    expect(matchesChannelSearch(gold, "@golddesk")).toBe(true);
    expect(matchesChannelSearch(gold, "https://t.me/golddesk")).toBe(true);
    expect(matchesChannelSearch(gold, "t.me/golddesk")).toBe(true);
    expect(matchesChannelSearch(gold, "silver")).toBe(false);
  });

  it("applies errors and win-rate bounds only when set", () => {
    const quiet = row({ id: "2", title: "Quiet", winRate: 0.4 });
    const unrated = row({ id: "3", title: "New", winRate: null, importStatus: "failed" });
    const filter = { query: "", errorsOnly: false, minWinRate: null, maxWinRate: null };
    expect(matchesTrackedColumn(gold, { ...filter, errorsOnly: true })).toBe(true);
    expect(matchesTrackedColumn(quiet, { ...filter, errorsOnly: true })).toBe(false);
    expect(matchesTrackedColumn(unrated, { ...filter, errorsOnly: true })).toBe(true);
    expect(matchesTrackedColumn(gold, { ...filter, minWinRate: 0.6, maxWinRate: 0.8 })).toBe(true);
    expect(matchesTrackedColumn(quiet, { ...filter, minWinRate: 0.6 })).toBe(false);
    expect(matchesTrackedColumn(unrated, { ...filter, maxWinRate: 0.9 })).toBe(false);
    expect(matchesTrackedColumn(gold, { ...filter, minWinRate: 0.9, maxWinRate: 0.2 })).toBe(false);
  });

  it("parses percent bounds", () => {
    expect(parseWinRatePercent("")).toBeNull();
    expect(parseWinRatePercent("70")).toBe(0.7);
    expect(parseWinRatePercent("150")).toBe(1);
    expect(parseWinRatePercent("nope")).toBeNull();
  });
});

describe("sortChannels", () => {
  const rows = [
    row({ id: "b", title: "Beta", winRate: 0.4 }),
    row({ id: "a", title: "Alpha", winRate: null }),
    row({ id: "c", title: "Cedar", winRate: 0.9 }),
    row({ id: "d", title: "alpha two", winRate: 0.4 }),
  ];

  it("sorts channel names and reverses them", () => {
    expect(sortChannels(rows, { key: "channel", dir: "asc" }).map((channel) => channel.title)).toEqual(["Alpha", "alpha two", "Beta", "Cedar"]);
    expect(sortChannels(rows, { key: "channel", dir: "desc" }).map((channel) => channel.title)).toEqual(["Cedar", "Beta", "alpha two", "Alpha"]);
  });

  it("sorts win rate with missing rates last", () => {
    expect(sortChannels(rows, { key: "winRate", dir: "desc" }).map((channel) => channel.title)).toEqual(["Cedar", "alpha two", "Beta", "Alpha"]);
    expect(sortChannels(rows, { key: "winRate", dir: "asc" }).map((channel) => channel.title)).toEqual(["alpha two", "Beta", "Cedar", "Alpha"]);
  });
});

describe("trackingChanges", () => {
  const channels = [
    row({ id: "1", title: "Kept", sourceId: "s1", tracked: true }),
    row({ id: "2", title: "Open", sourceId: null, tracked: false }),
  ];

  it("is clean until a channel changes sides", () => {
    expect(trackingChanges(channels, new Set(["1"])).dirty).toBe(false);
    const moved = trackingChanges(channels, new Set(["2"]));
    expect(moved.add.map((channel) => channel.id)).toEqual(["2"]);
    expect(moved.remove.map((channel) => channel.id)).toEqual(["1"]);
    expect(moved.dirty).toBe(true);
  });

  it("drops a round trip", () => {
    expect(trackingChanges(channels, new Set(["1"])).dirty).toBe(false);
  });
});
