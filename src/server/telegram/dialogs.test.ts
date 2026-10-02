import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/server/db";
import { runMigrations } from "@/server/db/migrate";
import { sources } from "@/server/db/schema";
import { removeSourceFromList } from "@/server/admin";
import { listSources } from "@/server/signals/queries";
import { addJoinedTelegramChat, listJoinedTelegramChats, telegramErrorMessage, telegramStatus } from "@/server/telegram";
import { joinedChatsFromDialogs, listJoinedChats, selectJoinedChat, chatWithLoadedAccessHash, type DialogEntityLike, type DialogLike } from "./dialogs";

function dialog(entity: DialogEntityLike, extra: Partial<DialogLike> = {}): DialogLike {
  const className = entity.className ?? "";
  return {
    id: className === "Channel" ? `-100${entity.id}` : entity.id,
    title: entity.title,
    isUser: className === "User",
    isGroup: className === "Chat" || Boolean(entity.megagroup || entity.gigagroup),
    isChannel: className === "Channel",
    entity,
    ...extra,
  };
}

const desk = dialog({ className: "Channel", id: "100", title: "Desk Alpha", username: "deskalpha", accessHash: "900", broadcast: true });
const room = dialog({ className: "Channel", id: "200", title: "Room Beta", accessHash: { toString: () => "800" }, megagroup: true });
const small = dialog({ className: "Chat", id: "300", title: "Small Gamma" });
const person = dialog({ className: "User", id: "1", title: "Nico", username: "nico" });

describe("joined telegram dialogs", () => {
  it("lists channels and groups from a fake dialog list and skips people", async () => {
    const calls: ({ archived?: boolean } | undefined)[] = [];
    const chats = await listJoinedChats({
      async getDialogs(params) {
        calls.push(params);
        if (params?.archived) return [dialog({ className: "Chat", id: "301", title: "Archived Delta" })];
        return [
          desk,
          room,
          small,
          person,
          dialog({ className: "User", id: "2", title: "Signal Bot", username: "signalbot" }, { isUser: true }),
          dialog({ className: "Channel", id: "400", title: "Left Echo", accessHash: "1", broadcast: true, left: true }),
          dialog({ className: "ChannelForbidden", id: "401", title: "Forbidden Foxtrot" }),
          dialog({ className: "Chat", id: "402", title: "Migrated Golf", migratedTo: { className: "InputChannel" } }),
          dialog({ className: "Channel", id: "403", title: "   ", username: "blankhotel", accessHash: "5", broadcast: true }),
          dialog({ className: "Channel", id: "500", title: "Giant Hotel", accessHash: "6", gigagroup: true }),
        ];
      },
    });

    expect(calls).toEqual([{}, { archived: true }]);
    expect(chats.map((c) => c.title)).toEqual(["Archived Delta", "Desk Alpha", "Giant Hotel", "Room Beta", "Small Gamma"]);
    expect(chats.find((c) => c.id === "100")).toEqual({
      id: "100",
      accessHash: "900",
      username: "deskalpha",
      title: "Desk Alpha",
      kind: "channel",
    });
    expect(chats.find((c) => c.id === "200")).toMatchObject({ kind: "group", accessHash: "800", username: null });
    expect(chats.find((c) => c.id === "300")).toMatchObject({ kind: "group", accessHash: null, username: null });
    expect(chats.find((c) => c.id === "500")?.kind).toBe("group");
    expect(chats.some((c) => c.title === "Nico" || c.username === "nico" || c.username === "blankhotel")).toBe(false);
  });

  it("uses the raw channel id, not GramJS's marked peer id", () => {
    const [chat] = joinedChatsFromDialogs([desk]);
    expect(desk.id).toBe("-100100");
    expect(chat.id).toBe("100");
  });

  it("keeps the main list when the archived folder cannot be loaded", async () => {
    const chats = await listJoinedChats({
      async getDialogs(params) {
        if (params?.archived) throw new Error("archive unavailable");
        return [desk];
      },
    });
    expect(chats.map((c) => c.title)).toEqual(["Desk Alpha"]);
  });

  it("keeps a negative access hash from the dialog payload", () => {
    const [chat] = joinedChatsFromDialogs([
      dialog({ className: "Channel", id: "100", title: "GTS VIP", accessHash: { toString: () => "-900" }, broadcast: true }),
    ]);
    expect(chat.accessHash).toBe("-900");
  });

  it("fills a missing channel access hash from a later lookup and does not ask anyone to open Telegram", () => {
    const listed = { id: "100", accessHash: null, username: null, title: "GTS VIP 🏆", kind: "channel" as const };
    expect(chatWithLoadedAccessHash(listed, "-42").accessHash).toBe("-42");
    expect(() => chatWithLoadedAccessHash(listed, null)).toThrow(/Couldn't load the Telegram access hash/);
    expect(() => chatWithLoadedAccessHash(listed, "0")).toThrow(/Couldn't load the Telegram access hash/);
  });

  it("dedupes a chat that appears in both folders and prefers an access hash", () => {
    const chats = joinedChatsFromDialogs([
      dialog({ className: "Channel", id: "100", title: "Desk Alpha", broadcast: true }),
      dialog({ className: "Channel", id: "100", title: "Desk Alpha", username: "deskalpha", accessHash: "900", broadcast: true }),
    ]);
    expect(chats).toHaveLength(1);
    expect(chats[0].accessHash).toBe("900");
    expect(chats[0].username).toBe("deskalpha");
  });

  it("chooses only an id present in the fake list", () => {
    const chats = joinedChatsFromDialogs([desk, room, person]);
    expect(selectJoinedChat(chats, "200").title).toBe("Room Beta");
    expect(() => selectJoinedChat(chats, "1")).toThrow(/joined/);
    expect(() => selectJoinedChat(chats, "")).toThrow(/joined/);
  });
});

describe("addJoinedTelegramChat", () => {
  beforeAll(async () => {
    await runMigrations();
  }, 60_000);

  afterAll(async () => {
    await closeDb();
  });

  it("reports that Telegram is not connected when no session is stored", async () => {
    await expect(listJoinedTelegramChats()).resolves.toEqual({ connected: false, chats: [] });
  });

  it("creates a source from the chosen dialog title without a typed channel", async () => {
    const chats = joinedChatsFromDialogs([desk, room, small, person]);
    const channel = selectJoinedChat(chats, "100");
    const created = await addJoinedTelegramChat({ chat: channel, isQa: true, parserType: "text-generic", backfill: 0 }, { userId: null, label: "test" });
    expect(created).toMatchObject({ created: true, title: "Desk Alpha" });

    const db = await getDb();
    const [row] = await db.select().from(sources).where(eq(sources.id, created.sourceId));
    expect(row.name).toBe("Desk Alpha");
    expect(row.slug).toBe("deskalpha");
    expect(row.sourceType).toBe("telegram");
    expect(row.telegramChannelId).toBe("100");
    expect(row.telegramAccessHash).toBe("900");
    expect(row.telegramUsername).toBe("deskalpha");
    expect(row.sourceUrl).toBe("https://t.me/deskalpha");
    expect(row.description).toBe("Telegram channel Desk Alpha");
    expect(row.isQa).toBe(true);

    const group = selectJoinedChat(chats, "300");
    const grouped = await addJoinedTelegramChat({ chat: group, isQa: false, parserType: "text-generic", backfill: 0 }, { userId: null, label: "test" });
    const [groupRow] = await db.select().from(sources).where(eq(sources.id, grouped.sourceId));
    expect(groupRow.name).toBe("Small Gamma");
    expect(groupRow.telegramAccessHash).toBeNull();
    expect(groupRow.description).toBe("Telegram group Small Gamma");

    const again = await addJoinedTelegramChat({ chat: channel, isQa: true, parserType: "text-generic", backfill: 0 }, { userId: null, label: "test" });
    expect(again).toMatchObject({ created: false, sourceId: created.sourceId, title: "Desk Alpha" });
    const rows = await db.select().from(sources).where(eq(sources.telegramChannelId, "100"));
    expect(rows).toHaveLength(1);
  });

  it("takes a channel off the list without dropping the row, and adding it again tracks the same source", async () => {
    const db = await getDb();
    const [row] = await db.select().from(sources).where(eq(sources.telegramChannelId, "100"));
    expect(await removeSourceFromList(row.id, { userId: null, label: "test" })).toBe("Desk Alpha");
    const listed = await listSources({ includeInactive: true, includeQa: true });
    expect(listed.some((source) => source.id === row.id)).toBe(false);

    const channel = selectJoinedChat(joinedChatsFromDialogs([desk]), "100");
    const again = await addJoinedTelegramChat({ chat: channel, isQa: true, parserType: "text-generic", backfill: 0 }, { userId: null, label: "test" });
    expect(again).toMatchObject({ created: false, sourceId: row.id });
    const [back] = await db.select().from(sources).where(eq(sources.id, row.id));
    expect(back.removedAt).toBeNull();
    expect(back.active).toBe(true);
    expect(await listSources({ includeInactive: true, includeQa: true })).toEqual(expect.arrayContaining([expect.objectContaining({ id: row.id })]));
  });

  it("treats the account as connected when the queue process holds the live session", async () => {
    const previous = {
      jobs: process.env.JOBS_WORKER,
      url: process.env.QUEUE_URL,
      secret: process.env.APP_SECRET,
    };
    process.env.JOBS_WORKER = "off";
    process.env.QUEUE_URL = "http://queue.test";
    process.env.APP_SECRET = "test-secret";
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      expect(String(input)).toBe("http://queue.test/telegram/status");
      return new Response(JSON.stringify({ connected: true, lastError: "ignored while connected" }), { status: 200 });
    }) as typeof fetch;
    try {
      const status = await telegramStatus();
      expect(status.connected).toBe(true);
      expect(status.lastError).toBeNull();
    } finally {
      globalThis.fetch = original;
      if (previous.jobs === undefined) delete process.env.JOBS_WORKER;
      else process.env.JOBS_WORKER = previous.jobs;
      if (previous.url === undefined) delete process.env.QUEUE_URL;
      else process.env.QUEUE_URL = previous.url;
      if (previous.secret === undefined) delete process.env.APP_SECRET;
      else process.env.APP_SECRET = previous.secret;
    }
  });

  it("shows the queue service's Telegram error when listing chats fails", async () => {
    const previous = {
      jobs: process.env.JOBS_WORKER,
      url: process.env.QUEUE_URL,
      secret: process.env.APP_SECRET,
    };
    process.env.JOBS_WORKER = "off";
    process.env.QUEUE_URL = "http://queue.test";
    process.env.APP_SECRET = "test-secret";
    const original = globalThis.fetch;
    globalThis.fetch = (async () => new Response("AUTH_KEY_DUPLICATED", { status: 500 })) as typeof fetch;
    try {
      await expect(listJoinedTelegramChats()).rejects.toThrow(telegramErrorMessage({ errorMessage: "AUTH_KEY_DUPLICATED" }));
    } finally {
      globalThis.fetch = original;
      if (previous.jobs === undefined) delete process.env.JOBS_WORKER;
      else process.env.JOBS_WORKER = previous.jobs;
      if (previous.url === undefined) delete process.env.QUEUE_URL;
      else process.env.QUEUE_URL = previous.url;
      if (previous.secret === undefined) delete process.env.APP_SECRET;
      else process.env.APP_SECRET = previous.secret;
    }
  });
});
