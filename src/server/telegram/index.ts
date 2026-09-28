import { and, eq, sql } from "drizzle-orm";
import { Api, helpers, Logger, password as tgPassword, sessions, TelegramClient } from "telegram";
// Explicit .js file paths: Node can't resolve GramJS directory imports, and a bundled second copy breaks its instanceof checks.
import { EditedMessage, type EditedMessageEvent } from "telegram/events/EditedMessage.js";
import { NewMessage, type NewMessageEvent } from "telegram/events/NewMessage.js";
import { LogLevel } from "telegram/extensions/Logger.js";

const { StringSession } = sessions;
type StringSession = InstanceType<typeof sessions.StringSession>;
const { returnBigInt } = helpers;
const { computeCheck } = tgPassword;
import { recordAudit, type Actor } from "@/server/audit";
import { getDb } from "@/server/db";
import { sources, type Source } from "@/server/db/schema";
import { ingestRawEvent } from "@/server/ingestion";
import { deleteSetting, getSetting, setSetting, SETTING_KEYS } from "@/server/settings";
import { listJoinedChats, type JoinedChat } from "./dialogs";
import { parseChannelInput, toIncomingEvent } from "./mapping";

export { selectJoinedChat } from "./dialogs";
export type { JoinedChat };

interface ApiCredentials {
  apiId: number;
  apiHash: string;
}
interface StoredSession {
  session: string;
  me: TelegramUser;
}
export interface TelegramUser {
  id: string;
  name: string;
  username: string | null;
  phone: string | null;
}
interface PendingLogin {
  client: TelegramClient;
  phone: string;
  phoneCodeHash: string;
  viaApp: boolean;
  needsPassword: boolean;
  passwordHint: string | null;
}
interface State {
  client: TelegramClient | null;
  connecting: Promise<void> | null;
  me: TelegramUser | null;
  lastError: string | null;
  pending: PendingLogin | null;
}

const g = globalThis as unknown as { __gsiTelegram?: State };
function state(): State {
  g.__gsiTelegram ??= { client: null, connecting: null, me: null, lastError: null, pending: null };
  return g.__gsiTelegram;
}

function makeClient(api: ApiCredentials, session: string) {
  return new TelegramClient(new StringSession(session), api.apiId, api.apiHash, {
    connectionRetries: 5,
    autoReconnect: true,
    deviceModel: "Aurum Ledger",
    appVersion: "1.0",
    baseLogger: new Logger(LogLevel.ERROR),
  });
}

function describeUser(u: Api.TypeUser | undefined): TelegramUser {
  if (!(u instanceof Api.User)) return { id: "unknown", name: "Telegram account", username: null, phone: null };
  return {
    id: u.id.toString(),
    name: [u.firstName, u.lastName].filter(Boolean).join(" ") || u.username || "Telegram account",
    username: u.username ?? null,
    phone: u.phone ? `+${u.phone.slice(0, 3)}•••${u.phone.slice(-2)}` : null,
  };
}

const NETWORK_TIMEOUT_MS = 25_000;
const UNREACHABLE =
  "Couldn't reach Telegram's servers. Check that this server allows outbound connections to Telegram (MTProto on ports 80/443).";

/** GramJS waits indefinitely on a dead socket, so every interactive network step is bounded. */
async function withTimeout<T>(work: Promise<T>, ms = NETWORK_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(UNREACHABLE)), ms);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

const FRIENDLY: Record<string, string> = {
  API_ID_INVALID: "The API ID and API hash don't match. Copy them again from my.telegram.org.",
  API_ID_PUBLISHED_FLOOD: "This API ID is blocked by Telegram. Create a new application on my.telegram.org.",
  PHONE_NUMBER_INVALID: "Telegram doesn't recognise that phone number. Use international format, e.g. +447700900123.",
  PHONE_NUMBER_BANNED: "This phone number is banned by Telegram.",
  PHONE_CODE_INVALID: "That login code is wrong. Check the code Telegram sent and try again.",
  PHONE_CODE_EXPIRED: "That login code has expired. Send a new code.",
  PASSWORD_HASH_INVALID: "The two-step verification password is wrong.",
  USERNAME_INVALID: "That channel username is not valid.",
  USERNAME_NOT_OCCUPIED: "No channel uses that username.",
  INVITE_HASH_INVALID: "That invite link is not valid.",
  INVITE_HASH_EXPIRED: "That invite link has expired.",
  INVITE_REQUEST_SENT: "A join request was sent. Add the channel again once the channel admin approves it.",
  CHANNELS_TOO_MUCH: "This Telegram account has joined too many channels.",
  CHANNEL_PRIVATE: "This channel is private or the account was removed from it.",
  AUTH_KEY_UNREGISTERED: "The Telegram session was signed out. Sign in again.",
  SESSION_REVOKED: "The Telegram session was revoked from another device. Sign in again.",
};

export function telegramErrorMessage(err: unknown) {
  const e = err as { errorMessage?: string; seconds?: number; message?: string };
  if (e?.errorMessage === "FLOOD" || e?.seconds) return `Telegram rate limit: wait ${e.seconds ?? "a few"} seconds and try again.`;
  if (e?.errorMessage && FRIENDLY[e.errorMessage]) return FRIENDLY[e.errorMessage];
  return e?.errorMessage ?? e?.message ?? String(err);
}

/* ------------------------------------------------------------------ */
/* Status and login                                                    */
/* ------------------------------------------------------------------ */

export async function telegramStatus() {
  const [api, session] = await Promise.all([getSetting<ApiCredentials>(SETTING_KEYS.telegramApi), getSetting<StoredSession>(SETTING_KEYS.telegramSession)]);
  const st = state();
  return {
    apiId: api?.apiId ?? null,
    hasApiCredentials: Boolean(api),
    signedIn: Boolean(session),
    connected: Boolean(st.client?.connected),
    me: st.me ?? session?.me ?? null,
    lastError: st.lastError,
    pending: st.pending
      ? { phone: st.pending.phone, viaApp: st.pending.viaApp, needsPassword: st.pending.needsPassword, passwordHint: st.pending.passwordHint }
      : null,
  };
}

export async function startTelegramLogin(input: { apiId: number; apiHash: string; phone: string }, actor: Actor) {
  const st = state();
  if (st.pending) await st.pending.client.destroy().catch(() => {});
  st.pending = null;
  const api = { apiId: input.apiId, apiHash: input.apiHash };
  const client = makeClient(api, "");
  try {
    const { phoneCodeHash, isCodeViaApp } = await withTimeout(
      (async () => {
        await client.connect();
        return client.sendCode(api, input.phone);
      })(),
    );
    await setSetting(SETTING_KEYS.telegramApi, api);
    st.pending = { client, phone: input.phone, phoneCodeHash, viaApp: isCodeViaApp, needsPassword: false, passwordHint: null };
    await recordAudit({ actor, entityType: "telegram", entityId: "account", action: "telegram.login_code_sent", after: { apiId: api.apiId } });
    return { viaApp: isCodeViaApp };
  } catch (err) {
    await client.destroy().catch(() => {});
    throw new Error(telegramErrorMessage(err));
  }
}

export async function completeTelegramLogin(input: { code?: string; password?: string }, actor: Actor) {
  const st = state();
  const p = st.pending;
  if (!p) throw new Error("No sign-in in progress. Send a login code first.");
  let user: Api.TypeUser | undefined;
  try {
    if (!p.needsPassword) {
      if (!input.code) throw new Error("Enter the login code Telegram sent you.");
      try {
        const res = await withTimeout(p.client.invoke(new Api.auth.SignIn({ phoneNumber: p.phone, phoneCodeHash: p.phoneCodeHash, phoneCode: input.code })));
        if (res instanceof Api.auth.AuthorizationSignUpRequired) throw new Error("This phone number doesn't have a Telegram account yet.");
        user = res.user;
      } catch (err) {
        if ((err as { errorMessage?: string }).errorMessage !== "SESSION_PASSWORD_NEEDED") throw err;
        const srp = await withTimeout(p.client.invoke(new Api.account.GetPassword()));
        p.needsPassword = true;
        p.passwordHint = srp.hint ?? null;
        if (!input.password) return { needsPassword: true as const, hint: p.passwordHint };
      }
    }
    if (!user) {
      if (!input.password) return { needsPassword: true as const, hint: p.passwordHint };
      const srp = await withTimeout(p.client.invoke(new Api.account.GetPassword()));
      const res = await withTimeout(p.client.invoke(new Api.auth.CheckPassword({ password: await computeCheck(srp, input.password) })));
      user = (res as Api.auth.Authorization).user;
    }
  } catch (err) {
    throw new Error(telegramErrorMessage(err));
  }

  const me = describeUser(user);
  await setSetting(SETTING_KEYS.telegramSession, { session: (p.client.session as StringSession).save(), me } satisfies StoredSession);
  if (st.client && st.client !== p.client) await st.client.destroy().catch(() => {});
  st.client = p.client;
  st.pending = null;
  st.me = me;
  st.lastError = null;
  installHandlers(p.client);
  await recordAudit({ actor, entityType: "telegram", entityId: "account", action: "telegram.signed_in", after: { user: me.username ?? me.id } });
  return { needsPassword: false as const, me };
}

export async function cancelTelegramLogin() {
  const st = state();
  if (st.pending) await st.pending.client.destroy().catch(() => {});
  st.pending = null;
}

export async function signOutTelegram(actor: Actor) {
  const st = state();
  const client = st.client ?? (await connectTelegram());
  if (client) {
    await withTimeout(client.invoke(new Api.auth.LogOut())).catch(() => {});
    await client.destroy().catch(() => {});
  }
  st.client = null;
  st.me = null;
  st.lastError = null;
  await deleteSetting(SETTING_KEYS.telegramSession);
  await recordAudit({ actor, entityType: "telegram", entityId: "account", action: "telegram.signed_out" });
}

/** Connects with the stored session. Safe to call often; reuses a live connection. */
export async function connectTelegram(): Promise<TelegramClient | null> {
  const st = state();
  if (st.client?.connected) return st.client;
  if (!st.connecting) {
    st.connecting = (async () => {
      try {
        const [api, session] = await Promise.all([getSetting<ApiCredentials>(SETTING_KEYS.telegramApi), getSetting<StoredSession>(SETTING_KEYS.telegramSession)]);
        if (!api || !session) return;
        if (st.client) await st.client.destroy().catch(() => {});
        const client = makeClient(api, session.session);
        try {
          await withTimeout(client.connect());
          // GetState throws on a real failure. checkAuthorization turns every
          // failure, including a dropped socket, into `false`, and deleting the
          // stored login on that false result signed the account out on restart.
          await withTimeout(client.invoke(new Api.updates.GetState()));
        } catch (err) {
          await client.destroy().catch(() => {});
          throw err;
        }
        installHandlers(client);
        st.client = client;
        st.me = session.me;
        st.lastError = null;
        try {
          const described = describeUser(await withTimeout(client.getMe()));
          const me = described.id === "unknown" ? session.me : described;
          st.me = me;
          const saved = (client.session as StringSession).save();
          const identityChanged = me.id !== session.me.id || me.username !== session.me.username || me.name !== session.me.name;
          if (saved && (saved !== session.session || identityChanged)) {
            await setSetting(SETTING_KEYS.telegramSession, { session: saved, me } satisfies StoredSession);
          }
        } catch (err) {
          console.error("[telegram] session refresh failed:", telegramErrorMessage(err));
        }
      } catch (err) {
        st.lastError = telegramErrorMessage(err);
        console.error("[telegram] connect failed:", st.lastError);
      } finally {
        st.connecting = null;
      }
    })();
  }
  await st.connecting;
  return st.client?.connected ? st.client : null;
}

/* ------------------------------------------------------------------ */
/* Channels                                                            */
/* ------------------------------------------------------------------ */

export interface ResolvedChannel {
  channelId: string;
  accessHash: string | null;
  username: string | null;
  title: string;
  broadcast: boolean;
}

async function requireClient() {
  const client = await connectTelegram();
  if (!client) throw new Error("Telegram is not connected. Sign in on the Telegram page first.");
  return client;
}

/** Channels and groups the connected account is already in. Empty when Telegram is not connected. */
export async function listJoinedTelegramChats(): Promise<{ connected: true; chats: JoinedChat[] } | { connected: false; chats: [] }> {
  const client = await connectTelegram();
  if (!client) return { connected: false, chats: [] };
  try {
    const chats = await withTimeout(listJoinedChats(client));
    return { connected: true, chats };
  } catch (err) {
    throw new Error(telegramErrorMessage(err));
  }
}

/** Resolves a username or invite link and joins the channel, so live updates are delivered. */
export async function resolveAndJoinChannel(input: string): Promise<ResolvedChannel> {
  const parsed = parseChannelInput(input);
  if (!parsed) throw new Error("Enter a channel as @username, a t.me link or an invite link.");
  const client = await requireClient();
  try {
    let chat: Api.TypeChat | undefined;
    if (parsed.kind === "username") {
      const res = await withTimeout(client.invoke(new Api.contacts.ResolveUsername({ username: parsed.username })));
      chat = res.chats[0];
      if (!chat) throw new Error("That username belongs to a person or bot, not a channel.");
      if (chat instanceof Api.Channel && chat.left) {
        await withTimeout(client.invoke(new Api.channels.JoinChannel({ channel: new Api.InputChannel({ channelId: chat.id, accessHash: chat.accessHash ?? returnBigInt(0) }) })));
      }
    } else {
      const check = await withTimeout(client.invoke(new Api.messages.CheckChatInvite({ hash: parsed.hash })));
      if (check instanceof Api.ChatInviteAlready || check instanceof Api.ChatInvitePeek) chat = check.chat;
      else {
        const updates = await withTimeout(client.invoke(new Api.messages.ImportChatInvite({ hash: parsed.hash })));
        chat = "chats" in updates ? updates.chats[0] : undefined;
      }
    }
    if (!(chat instanceof Api.Channel)) throw new Error("Only Telegram channels and supergroups can be tracked.");
    return {
      channelId: chat.id.toString(),
      accessHash: chat.accessHash?.toString() ?? null,
      username: chat.username ?? null,
      title: chat.title,
      broadcast: Boolean(chat.broadcast),
    };
  } catch (err) {
    throw new Error(telegramErrorMessage(err));
  }
}

function slugify(s: string) {
  return (
    s
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50) || "channel"
  );
}

async function uniqueSlug(base: string) {
  const db = await getDb();
  for (let i = 0; i < 50; i++) {
    const slug = i === 0 ? base : `${base}-${i + 1}`;
    const [hit] = await db.select({ id: sources.id }).from(sources).where(eq(sources.slug, slug));
    if (!hit) return slug;
  }
  return `${base}-${Date.now().toString(36)}`;
}

export interface AddChannelInput {
  channel: string;
  name?: string;
  isQa: boolean;
  parserType: string;
  backfill: number;
}

async function saveLinkedTelegramSource(ch: ResolvedChannel, input: { name?: string; isQa: boolean; parserType: string; backfill: number }, actor: Actor) {
  const db = await getDb();
  const [existing] = await db.select().from(sources).where(eq(sources.telegramChannelId, ch.channelId));
  const linked = {
    telegramAccessHash: ch.accessHash,
    telegramUsername: ch.username,
    sourceUrl: ch.username ? `https://t.me/${ch.username}` : null,
    syncError: null,
  };
  if (existing) {
    await db
      .update(sources)
      .set({ ...linked, active: true, isQa: input.isQa, name: input.name || existing.name, parserType: input.parserType })
      .where(eq(sources.id, existing.id));
    await recordAudit({ actor, entityType: "source", entityId: existing.id, action: "telegram.channel_relinked", after: { channel: ch.username ?? ch.channelId } });
    return { sourceId: existing.id, created: false, title: ch.title };
  }
  const name = (input.name || ch.title).trim().slice(0, 80);
  const [row] = await db
    .insert(sources)
    .values({
      ...linked,
      name,
      slug: await uniqueSlug(slugify(ch.username ?? name)),
      sourceType: "telegram",
      telegramChannelId: ch.channelId,
      description: ch.broadcast ? `Telegram channel ${ch.title}` : `Telegram group ${ch.title}`,
      parserType: input.parserType,
      timezone: "UTC",
      isQa: input.isQa,
      active: true,
      showRawText: true,
    })
    .returning({ id: sources.id });
  await recordAudit({
    actor,
    entityType: "source",
    entityId: row.id,
    action: "telegram.channel_added",
    after: { channel: ch.username ?? ch.channelId, title: ch.title, isQa: input.isQa, backfill: input.backfill },
  });
  return { sourceId: row.id, created: true, title: ch.title };
}

/**
 * Joins the channel and creates (or re-links) its source. Re-adding a known channel keeps its
 * history and sync cursor instead of creating a duplicate.
 */
export async function addTelegramChannel(input: AddChannelInput, actor: Actor) {
  const ch = await resolveAndJoinChannel(input.channel);
  return saveLinkedTelegramSource(ch, input, actor);
}

/** Creates a source from a channel or group the account has already joined. The title is the dialog title. */
export async function addJoinedTelegramChat(input: { chat: JoinedChat; name?: string; isQa: boolean; parserType: string; backfill: number }, actor: Actor) {
  const title = input.chat.title.trim();
  if (!title || !/^[1-9][0-9]*$/.test(input.chat.id)) throw new Error("Choose a channel or group the connected account has joined.");
  if (input.chat.kind === "channel" && !input.chat.accessHash) {
    throw new Error(`Telegram did not include an access hash for ${title}. Open it in Telegram and try again.`);
  }
  return saveLinkedTelegramSource(
    {
      channelId: input.chat.id,
      accessHash: input.chat.accessHash,
      username: input.chat.username,
      title,
      broadcast: input.chat.kind === "channel",
    },
    input,
    actor,
  );
}

function inputPeer(source: Source) {
  if (!source.telegramChannelId) throw new Error("Source is not linked to a Telegram channel");
  if (source.telegramAccessHash) {
    return new Api.InputPeerChannel({ channelId: returnBigInt(source.telegramChannelId), accessHash: returnBigInt(source.telegramAccessHash) });
  }
  return new Api.InputPeerChat({ chatId: returnBigInt(source.telegramChannelId) });
}

const PAGE = 100;
const MAX_CATCH_UP = 1000;

async function fetchMessages(client: TelegramClient, source: Source, opts: { minId?: number; limit: number }) {
  const peer = inputPeer(source);
  const out: Api.Message[] = [];
  let offsetId = 0;
  while (out.length < opts.limit) {
    const batch = await withTimeout(client.getMessages(peer, { limit: Math.min(PAGE, opts.limit - out.length), minId: opts.minId ?? 0, offsetId }));
    const msgs = batch.filter((m): m is Api.Message => m instanceof Api.Message);
    out.push(...msgs);
    if (batch.length < PAGE || !batch.length) break;
    offsetId = batch[batch.length - 1].id;
  }
  return out.sort((a, b) => a.id - b.id);
}

async function ingestMessage(source: Source, msg: Api.Message, edited: boolean) {
  const event = toIncomingEvent(msg, { channelId: source.telegramChannelId!, username: source.telegramUsername }, { edited });
  const result = event ? await ingestRawEvent(source.id, event) : null;
  if (!edited) {
    const db = await getDb();
    await db
      .update(sources)
      .set({ lastMessageId: sql`greatest(coalesce(${sources.lastMessageId}, 0), ${msg.id})`, lastSyncedAt: new Date(), syncError: null })
      .where(eq(sources.id, source.id));
  }
  return result;
}

/**
 * Catch-up sync for one channel. On the first sync only `backfill` recent messages are imported
 * (0 = start from now); afterwards everything newer than the last seen message id is fetched.
 */
export async function syncTelegramSource(sourceId: string, opts: { backfill?: number } = {}) {
  const db = await getDb();
  const [source] = await db.select().from(sources).where(eq(sources.id, sourceId));
  if (!source || source.sourceType !== "telegram") throw new Error("Not a Telegram source");
  if (!source.active) return { ingested: 0, skipped: "inactive" as const };
  const client = await requireClient();
  try {
    let msgs: Api.Message[];
    if (source.lastMessageId == null) {
      const backfill = Math.max(0, Math.min(opts.backfill ?? 0, MAX_CATCH_UP));
      msgs = await fetchMessages(client, source, { limit: Math.max(backfill, 1) });
      if (backfill === 0) {
        const newest = msgs[msgs.length - 1]?.id ?? 0;
        await db.update(sources).set({ lastMessageId: newest, lastSyncedAt: new Date(), syncError: null }).where(eq(sources.id, source.id));
        return { ingested: 0 };
      }
    } else {
      msgs = await fetchMessages(client, source, { minId: source.lastMessageId, limit: MAX_CATCH_UP });
    }
    let ingested = 0;
    for (const m of msgs) {
      const r = await ingestMessage(source, m, false);
      if (r?.status === "stored") ingested++;
    }
    await db.update(sources).set({ lastSyncedAt: new Date(), syncError: null }).where(eq(sources.id, source.id));
    return { ingested };
  } catch (err) {
    const message = telegramErrorMessage(err);
    await db.update(sources).set({ syncError: message }).where(eq(sources.id, source.id));
    throw new Error(message);
  }
}

export async function syncAllTelegramSources() {
  const client = await connectTelegram();
  if (!client) return { skipped: "not_connected" as const };
  const db = await getDb();
  const rows = await db.select({ id: sources.id }).from(sources).where(and(eq(sources.sourceType, "telegram"), eq(sources.active, true)));
  const results: Record<string, number | string> = {};
  for (const r of rows) {
    try {
      results[r.id] = (await syncTelegramSource(r.id)).ingested;
    } catch (err) {
      results[r.id] = (err as Error).message;
    }
  }
  return results;
}

/* ------------------------------------------------------------------ */
/* Live updates                                                        */
/* ------------------------------------------------------------------ */

const installed = new WeakSet<TelegramClient>();

function installHandlers(client: TelegramClient) {
  if (installed.has(client)) return;
  installed.add(client);
  client.addEventHandler((e: NewMessageEvent) => void onLiveMessage(e.message, false), new NewMessage({}));
  client.addEventHandler((e: EditedMessageEvent) => void onLiveMessage(e.message, true), new EditedMessage({}));
}

function messagePeerId(msg: Api.Message) {
  if (msg.peerId instanceof Api.PeerChannel) return msg.peerId.channelId.toString();
  if (msg.peerId instanceof Api.PeerChat) return msg.peerId.chatId.toString();
  return null;
}

async function onLiveMessage(msg: Api.Message, edited: boolean) {
  try {
    const channelId = messagePeerId(msg);
    if (!channelId) return;
    const db = await getDb();
    const [source] = await db
      .select()
      .from(sources)
      .where(and(eq(sources.telegramChannelId, channelId), eq(sources.sourceType, "telegram"), eq(sources.active, true)));
    if (!source || source.lastMessageId == null) return;
    await ingestMessage(source, msg, edited);
    const { processJobs } = await import("@/server/jobs/runner");
    void processJobs(100).catch(() => {});
  } catch (err) {
    console.error("[telegram] live message failed:", (err as Error).message);
  }
}
