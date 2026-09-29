/**
 * Channels and groups a Telegram account is already a member of.
 * Titles are copied from the dialog. A chat with no title is skipped.
 */

export type JoinedChatKind = "channel" | "group";

export interface JoinedChat {
  id: string;
  accessHash: string | null;
  username: string | null;
  title: string;
  kind: JoinedChatKind;
}

export interface DialogEntityLike {
  className?: string;
  id?: { toString(): string } | string | number | bigint | null;
  title?: string | null;
  username?: string | null;
  usernames?: readonly { username?: string | null; active?: boolean | null }[] | null;
  accessHash?: { toString(): string } | string | number | bigint | null;
  broadcast?: boolean | null;
  megagroup?: boolean | null;
  gigagroup?: boolean | null;
  left?: boolean | null;
  kicked?: boolean | null;
  deactivated?: boolean | null;
  migratedTo?: unknown;
}

/** The fields GramJS puts on a dialog. Tests pass plain objects with this shape. */
export interface DialogLike {
  /** Marked peer id (`-100…`). Not used; the raw entity id is. */
  id?: { toString(): string } | string | number | bigint | null;
  title?: string | null;
  name?: string | null;
  isUser?: boolean;
  isGroup?: boolean;
  isChannel?: boolean;
  entity?: DialogEntityLike | null;
}

export interface DialogListClient {
  getDialogs(params?: { archived?: boolean }): Promise<readonly DialogLike[]>;
}

function rawId(value: DialogEntityLike["id"]): string | null {
  if (value == null || value === "") return null;
  const s = typeof value === "object" ? value.toString() : String(value);
  if (!/^[1-9][0-9]*$/.test(s)) return null;
  return s;
}

/** Telegram access hashes are signed 64-bit values. Zero means the payload omitted one. */
export function accessHashOf(value: DialogEntityLike["accessHash"]): string | null {
  if (value == null || value === "") return null;
  const s = (typeof value === "object" ? value.toString() : String(value)).trim();
  if (!/^-?[1-9][0-9]*$/.test(s)) return null;
  return s;
}

/** A listed channel with no hash still has one in the connected session. Load that, then add it. */
export function chatWithLoadedAccessHash(chat: JoinedChat, loaded: string | null): JoinedChat {
  if (chat.kind !== "channel" || chat.accessHash) return chat;
  const accessHash = accessHashOf(loaded);
  if (!accessHash) throw new Error(`Couldn't load the Telegram access hash for ${chat.title.trim() || "this chat"}.`);
  return { ...chat, accessHash };
}

function usernameOf(entity: DialogEntityLike): string | null {
  const direct = entity.username?.trim();
  if (direct) return direct;
  const fromList = entity.usernames?.find((u) => u.active && u.username?.trim())?.username ?? entity.usernames?.find((u) => u.username?.trim())?.username;
  const handle = fromList?.trim();
  return handle || null;
}

function titleOf(dialog: DialogLike, entity: DialogEntityLike): string {
  return (entity.title ?? dialog.title ?? dialog.name ?? "").trim();
}

function kindOf(dialog: DialogLike, entity: DialogEntityLike): JoinedChatKind | null {
  const className = entity.className ?? "";
  if (dialog.isUser || className === "User" || className === "UserEmpty") return null;
  if (className === "ChatForbidden" || className === "ChannelForbidden") return null;
  if (entity.left || entity.kicked || entity.deactivated || entity.migratedTo) return null;

  const megagroup = Boolean(entity.megagroup || entity.gigagroup);
  const basicGroup = className === "Chat" || (Boolean(dialog.isGroup) && className !== "Channel" && !dialog.isChannel && !entity.broadcast);
  const channel = className === "Channel" || Boolean(dialog.isChannel) || Boolean(entity.broadcast);
  if (!megagroup && !basicGroup && !channel && !dialog.isGroup) return null;
  if (megagroup || basicGroup || (dialog.isGroup && !entity.broadcast && !dialog.isChannel)) return "group";
  if (channel || entity.broadcast) return "channel";
  return dialog.isGroup ? "group" : null;
}

/** Keeps channels and groups the account is still in. Private chats are dropped. */
export function joinedChatsFromDialogs(dialogs: readonly DialogLike[]): JoinedChat[] {
  const byId = new Map<string, JoinedChat>();
  for (const dialog of dialogs) {
    const entity = dialog.entity;
    if (!entity) continue;
    const kind = kindOf(dialog, entity);
    const id = rawId(entity.id);
    const title = titleOf(dialog, entity);
    if (!kind || !id || !title) continue;
    const chat: JoinedChat = {
      id,
      accessHash: accessHashOf(entity.accessHash),
      username: usernameOf(entity),
      title,
      kind,
    };
    const prev = byId.get(id);
    if (!prev || (!prev.accessHash && chat.accessHash)) byId.set(id, chat);
  }
  return [...byId.values()].sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }) || a.id.localeCompare(b.id));
}

export function selectJoinedChat(chats: readonly JoinedChat[], id: string): JoinedChat {
  const chat = chats.find((c) => c.id === id);
  if (!chat) throw new Error("Choose a channel or group the connected account has joined.");
  return chat;
}

/** Main dialogs plus archived ones. A failure loading the archive keeps the main list. */
export async function listJoinedChats(client: DialogListClient): Promise<JoinedChat[]> {
  const main = await client.getDialogs({});
  let archived: readonly DialogLike[] = [];
  try {
    archived = await client.getDialogs({ archived: true });
  } catch {
    archived = [];
  }
  return joinedChatsFromDialogs([...main, ...archived]);
}
