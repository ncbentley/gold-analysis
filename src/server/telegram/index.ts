import { and, eq, isNull, sql } from "drizzle-orm";
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
import { storeRawEvent, type IncomingEvent } from "@/server/ingestion";
import { withTelegramSlot } from "@/server/jobs/limits";
import { enqueueJob } from "@/server/jobs/queue";
import { deleteSetting, getSetting, setSetting, SETTING_KEYS } from "@/server/settings";
import { listJoinedChats, accessHashOf, chatWithLoadedAccessHash, type JoinedChat } from "./dialogs";
import { readHistoryPages } from "./history";
import { finishImportIfIdle, markTelegramImportFailed, markTelegramImporting } from "./import-status";
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

function queueOwnsTelegram() {
  return process.env.JOBS_WORKER === "off" && Boolean(process.env.QUEUE_URL);
}

async function queueFetch(path: string, method = "GET") {
  const secret = process.env.APP_SECRET;
  if (!secret) throw new Error("APP_SECRET is not set, so this app cannot ask the queue service.");
  const res = await fetch(new URL(path, process.env.QUEUE_URL), {
    method,
    headers: { "x-app-secret": secret },
    cache: "no-store",
  });
  if (!res.ok) throw new Error("The queue service did not answer.");
  return res.json() as Promise<{ connected?: boolean; lastError?: string | null }>;
}

/**
 * The live Telegram client sits in the queue process. This process has no socket,
 * so its own client is not a signal that the account is disconnected.
 */
async function queueConnection(): Promise<{ connected: boolean; lastError: string | null } | null> {
  if (!queueOwnsTelegram()) return null;
  try {
    const body = await queueFetch("/telegram/status");
    return { connected: Boolean(body.connected), lastError: body.lastError ?? null };
  } catch (err) {
    return { connected: false, lastError: err instanceof Error ? err.message : "The queue service did not answer." };
  }
}

export async function telegramStatus() {
  const [api, session] = await Promise.all([getSetting<ApiCredentials>(SETTING_KEYS.telegramApi), getSetting<StoredSession>(SETTING_KEYS.telegramSession)]);
  const st = state();
  const remote = await queueConnection();
  return {
    apiId: api?.apiId ?? null,
    hasApiCredentials: Boolean(api),
    signedIn: Boolean(session),
    connected: remote ? remote.connected : Boolean(st.client?.connected),
    me: st.me ?? session?.me ?? null,
    lastError: remote ? (remote.connected ? null : remote.lastError) : st.lastError,
    pending: st.pending
      ? { phone: st.pending.phone, viaApp: st.pending.viaApp, needsPassword: st.pending.needsPassword, passwordHint: st.pending.passwordHint }
      : null,
  };
}

/** Connects in whichever process owns the socket. The web process must not open a second session. */
export async function reconnectTelegram() {
  if (queueOwnsTelegram()) {
    const body = await queueFetch("/telegram/connect", "POST");
    return Boolean(body.connected);
  }
  return Boolean(await connectTelegram());
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
  st.pending = null;
  st.me = me;
  st.lastError = null;
  // The queue service owns the live session. Keeping a second client here can
  // invalidate the auth key, so the app drops its socket after the session is saved.
  if (process.env.JOBS_WORKER === "off") {
    await p.client.destroy().catch(() => {});
    st.client = null;
  } else {
    st.client = p.client;
    installHandlers(p.client);
  }
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
  if (process.env.QUEUE_URL && process.env.JOBS_WORKER === "off") {
    const secret = process.env.APP_SECRET;
    if (!secret) throw new Error("APP_SECRET is not set, so this app cannot ask the queue service for Telegram chats.");
    const res = await fetch(new URL("/telegram/dialogs", process.env.QUEUE_URL), {
      headers: { "x-app-secret": secret },
      cache: "no-store",
    });
    if (!res.ok) throw new Error("The queue service could not list Telegram chats.");
    const body = (await res.json()) as { connected: boolean; chats: JoinedChat[] };
    return body.connected ? { connected: true, chats: body.chats } : { connected: false, chats: [] };
  }
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
      .set({ ...linked, active: true, removedAt: null, isQa: input.isQa, name: input.name || existing.name, parserType: input.parserType, importStatus: "queued" })
      .where(eq(sources.id, existing.id));
    await recordAudit({ actor, entityType: "source", entityId: existing.id, action: "telegram.channel_relinked", after: { channel: ch.username ?? ch.channelId } });
    return { sourceId: existing.id, created: false, title: ch.title, importStatus: "queued" as const };
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
      importStatus: "queued",
    })
    .returning({ id: sources.id });
  await recordAudit({
    actor,
    entityType: "source",
    entityId: row.id,
    action: "telegram.channel_added",
    after: { channel: ch.username ?? ch.channelId, title: ch.title, isQa: input.isQa, backfill: input.backfill },
  });
  return { sourceId: row.id, created: true, title: ch.title, importStatus: "queued" as const };
}

/**
 * Joins the channel and creates (or re-links) its source. Re-adding a known channel keeps its
 * history and sync cursor instead of creating a duplicate.
 */
export async function addTelegramChannel(input: AddChannelInput, actor: Actor) {
  const ch = await resolveAndJoinChannel(input.channel);
  return saveLinkedTelegramSource(ch, input, actor);
}

function hashFromPeer(peer: unknown): string | null {
  if (peer instanceof Api.InputPeerChannel || peer instanceof Api.Channel) return accessHashOf(peer.accessHash ?? null);
  return null;
}

/**
 * Dialogs sometimes omit the access hash. The connected session can still resolve the peer
 * from its entity cache, a fresh dialog list, or the public username.
 */
async function loadChannelAccessHash(chat: JoinedChat): Promise<string | null> {
  const client = await requireClient();
  const marked = `-100${chat.id}`;
  try {
    const hash = hashFromPeer(await withTimeout(client.getInputEntity(marked)));
    if (hash) return hash;
  } catch {
    // The peer is not in the session cache yet.
  }
  try {
    const hash = hashFromPeer(await withTimeout(client.getEntity(marked)));
    if (hash) return hash;
  } catch {
    // A direct entity lookup can fail until dialogs are refreshed.
  }
  try {
    const refreshed = await withTimeout(listJoinedChats(client));
    const again = refreshed.find((item) => item.id === chat.id);
    if (again?.accessHash) return again.accessHash;
  } catch {
    // Keep trying the username when the dialog refresh fails.
  }
  if (chat.username) {
    try {
      const res = await withTimeout(client.invoke(new Api.contacts.ResolveUsername({ username: chat.username })));
      for (const item of res.chats) {
        if (item instanceof Api.Channel && item.id.toString() === chat.id) {
          const hash = accessHashOf(item.accessHash ?? null);
          if (hash) return hash;
        }
      }
    } catch {
      // A private channel has no username to resolve.
    }
  }
  return null;
}

export interface QueuedTelegramChat {
  sourceId: string;
  title: string;
  created: boolean;
  importStatus: "queued";
}

/**
 * Records each selected chat and enqueues its import. Returns as soon as the jobs
 * are queued. It does not call Telegram, so an import already in progress cannot
 * make the next add fail. A channel that is already on the list is left as it is.
 */
export async function queueJoinedTelegramChats(
  chats: JoinedChat[],
  input: { isQa: boolean; parserType: string; backfill: number },
  actor: Actor,
): Promise<{ queued: QueuedTelegramChat[]; alreadyTracked: string[] }> {
  const db = await getDb();
  const seen = new Set<string>();
  const queued: QueuedTelegramChat[] = [];
  const alreadyTracked: string[] = [];
  for (const chat of chats) {
    const title = chat.title.trim();
    if (!title || !/^[1-9][0-9]*$/.test(chat.id)) throw new Error("Choose a channel or group the connected account has joined.");
    if (seen.has(chat.id)) continue;
    seen.add(chat.id);
    const [existing] = await db
      .select({ id: sources.id })
      .from(sources)
      .where(and(eq(sources.telegramChannelId, chat.id), isNull(sources.removedAt)));
    if (existing) {
      alreadyTracked.push(title);
      continue;
    }
    const saved = await saveLinkedTelegramSource(
      {
        channelId: chat.id,
        accessHash: chat.accessHash,
        username: chat.username,
        title,
        broadcast: chat.kind === "channel",
      },
      input,
      actor,
    );
    await enqueueJob("TELEGRAM_SYNC", { sourceId: saved.sourceId, backfill: input.backfill }, { dedupeKey: `telegram-sync:${saved.sourceId}` });
    queued.push({ sourceId: saved.sourceId, title: saved.title, created: saved.created, importStatus: "queued" });
  }
  return { queued, alreadyTracked };
}

/** Creates a source from a channel or group the account has already joined. The title is the dialog title. */
export async function addJoinedTelegramChat(input: { chat: JoinedChat; name?: string; isQa: boolean; parserType: string; backfill: number }, actor: Actor) {
  const title = input.chat.title.trim();
  if (!title || !/^[1-9][0-9]*$/.test(input.chat.id)) throw new Error("Choose a channel or group the connected account has joined.");
  const chat = input.chat.kind === "channel" && !input.chat.accessHash ? chatWithLoadedAccessHash(input.chat, await loadChannelAccessHash(input.chat)) : input.chat;
  return saveLinkedTelegramSource(
    {
      channelId: chat.id,
      accessHash: chat.accessHash,
      username: chat.username,
      title,
      broadcast: chat.kind === "channel",
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
  let remaining = opts.limit;
  const msgs = await readHistoryPages(async (offsetId) => {
    const ask = Math.min(PAGE, remaining);
    const batch = await withTimeout(client.getMessages(peer, { limit: ask, minId: opts.minId ?? 0, offsetId }));
    const items = batch.filter((m): m is Api.Message => m instanceof Api.Message);
    remaining -= items.length;
    const nextOffset = batch.length < ask || batch.length === 0 ? null : batch[batch.length - 1].id;
    return { items, nextOffset };
  }, opts.limit);
  return msgs.sort((a, b) => a.id - b.id);
}

export interface LoadedTelegramMessage {
  id: number;
  text: string;
  date: Date;
}

let historyLoader: ((source: Source, opts: { backfill?: number }) => Promise<LoadedTelegramMessage[]>) | null = null;

/** Tests supply messages here so a source can be queued without calling Telegram. */
export function useTelegramHistoryLoader(loader: typeof historyLoader) {
  historyLoader = loader;
}

async function queueIncoming(source: Source, event: IncomingEvent | null, messageId: number, edited: boolean, opts?: { live?: boolean }) {
  if (!edited) {
    const db = await getDb();
    await db
      .update(sources)
      .set({ lastMessageId: sql`greatest(coalesce(${sources.lastMessageId}, 0), ${messageId})`, lastSyncedAt: new Date(), syncError: null })
      .where(eq(sources.id, source.id));
  }
  if (!event) return null;
  const stored = await storeRawEvent(source.id, event);
  if (stored.status === "stored") {
    await enqueueJob(
      "PROCESS_EVENT",
      { rawEventId: stored.rawEventId, sourceId: source.id, ...(opts?.live ? { live: true } : {}) },
      { dedupeKey: `event:${stored.rawEventId}` },
    );
  }
  return stored;
}

async function queueTelegramMessage(source: Source, msg: Api.Message, edited: boolean, opts?: { live?: boolean }) {
  const event = toIncomingEvent(msg, { channelId: source.telegramChannelId!, username: source.telegramUsername }, { edited });
  return queueIncoming(source, event, msg.id, edited, opts);
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
  const track = source.importStatus === "queued" || source.importStatus === "importing";
  if (source.importStatus === "queued") await markTelegramImporting(source.id);
  try {
    if (!historyLoader && source.telegramChannelId && !source.telegramAccessHash && source.description?.startsWith("Telegram channel")) {
      const hash = await withTelegramSlot(() =>
        loadChannelAccessHash({
          id: source.telegramChannelId!,
          accessHash: null,
          username: source.telegramUsername,
          title: source.name,
          kind: "channel",
        }),
      );
      if (hash) {
        await db.update(sources).set({ telegramAccessHash: hash }).where(eq(sources.id, source.id));
        source.telegramAccessHash = hash;
      }
    }
    if (historyLoader) {
      const loaded = await historyLoader(source, opts);
      let queued = 0;
      for (const message of loaded) {
        const stored = await queueIncoming(
          source,
          { externalMessageId: String(message.id), rawText: message.text, publishedAt: message.date, payload: { message_id: message.id } },
          message.id,
          false,
        );
        if (stored?.status === "stored") queued += 1;
      }
      if (track) await finishImportIfIdle(source.id);
      return { ingested: queued, queued };
    }
    const client = await requireClient();
    let msgs: Api.Message[];
    if (source.lastMessageId == null) {
      const backfill = Math.max(0, Math.min(opts.backfill ?? 0, MAX_CATCH_UP));
      msgs = await fetchMessages(client, source, { limit: Math.max(backfill, 1) });
      if (backfill === 0) {
        const newest = msgs[msgs.length - 1]?.id ?? 0;
        await db.update(sources).set({ lastMessageId: newest, lastSyncedAt: new Date(), syncError: null }).where(eq(sources.id, source.id));
        if (track) await finishImportIfIdle(source.id);
        return { ingested: 0, queued: 0 };
      }
    } else {
      msgs = await fetchMessages(client, source, { minId: source.lastMessageId, limit: MAX_CATCH_UP });
    }
    let queued = 0;
    for (const m of msgs) {
      const r = await queueTelegramMessage(source, m, false);
      if (r?.status === "stored") queued += 1;
    }
    if (track) await finishImportIfIdle(source.id);
    else await db.update(sources).set({ lastSyncedAt: new Date(), syncError: null }).where(eq(sources.id, source.id));
    return { ingested: queued, queued };
  } catch (err) {
    const message = telegramErrorMessage(err);
    await db.update(sources).set({ syncError: message }).where(eq(sources.id, source.id));
    if (track) await markTelegramImportFailed(source.id, message);
    throw new Error(message);
  }
}

export async function syncAllTelegramSources() {
  const client = await connectTelegram();
  if (!client) return { skipped: "not_connected" as const };
  const db = await getDb();
  const rows = await db.select({ id: sources.id }).from(sources).where(and(eq(sources.sourceType, "telegram"), eq(sources.active, true)));
  const results: Record<string, number | string> = {};
  await Promise.all(
    rows.map(async (r) => {
      try {
        results[r.id] = (await syncTelegramSource(r.id)).ingested;
      } catch (err) {
        results[r.id] = (err as Error).message;
      }
    }),
  );
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
    // The update is already delivered. Do not take a Telegram slot for the
    // database write, or a history fetch can delay storing the post.
    const channelId = messagePeerId(msg);
    if (!channelId) return;
    const db = await getDb();
    const [source] = await db
      .select()
      .from(sources)
      .where(and(eq(sources.telegramChannelId, channelId), eq(sources.sourceType, "telegram"), eq(sources.active, true)));
    if (!source || source.lastMessageId == null) return;
    await queueTelegramMessage(source, msg, edited, { live: true });
    if (process.env.JOBS_WORKER !== "off") {
      const { processJobs } = await import("@/server/jobs/runner");
      void processJobs(50, ["PROCESS_EVENT"]).catch(() => {});
    }
  } catch (err) {
    console.error("[telegram] live message failed:", (err as Error).message);
  }
}
