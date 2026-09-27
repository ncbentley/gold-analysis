import type { IncomingEvent } from "@/server/ingestion";

/** The subset of a GramJS Api.Message used for ingestion. */
export interface TelegramMessageLike {
  id: number;
  message?: string | null;
  date: number;
  editDate?: number | null;
  replyTo?: { replyToMsgId?: number | null } | null;
  media?: { className?: string } | null;
  groupedId?: { toString(): string } | null;
  fwdFrom?: unknown;
}

export interface TelegramChannelRef {
  channelId: string;
  username: string | null;
}

const MEDIA_LABEL: Record<string, string> = {
  MessageMediaPhoto: "photo",
  MessageMediaDocument: "file",
  MessageMediaWebPage: "link",
  MessageMediaPoll: "poll",
};

export function messageLink(ch: TelegramChannelRef, messageId: number) {
  return ch.username ? `https://t.me/${ch.username}/${messageId}` : `https://t.me/c/${ch.channelId}/${messageId}`;
}

/**
 * Maps a channel post to a raw event. The Telegram message id is the external id, so
 * redelivery (live update plus catch-up poll) is de-duplicated. Edits are stored as separate
 * events keyed by edit time; they never overwrite the original evidence.
 */
export function toIncomingEvent(msg: TelegramMessageLike, ch: TelegramChannelRef, opts: { edited?: boolean } = {}): IncomingEvent | null {
  const text = (msg.message ?? "").trim();
  const mediaKind = msg.media?.className ? MEDIA_LABEL[msg.media.className] ?? "media" : null;
  const isLinkPreviewOnly = mediaKind === "link";
  if (!text && (!mediaKind || isLinkPreviewOnly)) return null;

  const edited = Boolean(opts.edited && msg.editDate);
  const replyTo = msg.replyTo?.replyToMsgId ? String(msg.replyTo.replyToMsgId) : undefined;
  const rawText = text || `[${mediaKind} without caption]`;

  return {
    externalMessageId: edited ? `${msg.id}@edit-${msg.editDate}` : String(msg.id),
    rawText,
    publishedAt: new Date((edited ? msg.editDate! : msg.date) * 1000),
    payload: {
      message_id: String(msg.id),
      ...(replyTo ? { reply_to_message_id: replyTo } : {}),
      ...(edited ? { edit_of: String(msg.id) } : {}),
      telegram: {
        channelId: ch.channelId,
        username: ch.username,
        messageId: msg.id,
        date: new Date(msg.date * 1000).toISOString(),
        editDate: msg.editDate ? new Date(msg.editDate * 1000).toISOString() : null,
        groupedId: msg.groupedId ? msg.groupedId.toString() : null,
        media: mediaKind,
        forwarded: Boolean(msg.fwdFrom),
        link: messageLink(ch, msg.id),
      },
    },
  };
}

/** Accepts @name, name, t.me/name, t.me/name/123, t.me/+hash, t.me/joinchat/hash. */
export function parseChannelInput(input: string): { kind: "username"; username: string } | { kind: "invite"; hash: string } | null {
  const s = input.trim();
  const invite = s.match(/(?:t(?:elegram)?\.me\/(?:joinchat\/|\+))([A-Za-z0-9_-]+)/);
  if (invite) return { kind: "invite", hash: invite[1] };
  const link = s.match(/t(?:elegram)?\.me\/(?:s\/)?([A-Za-z][A-Za-z0-9_]{3,})/);
  if (link) return { kind: "username", username: link[1] };
  const handle = s.match(/^@?([A-Za-z][A-Za-z0-9_]{3,})$/);
  if (handle) return { kind: "username", username: handle[1] };
  return null;
}
