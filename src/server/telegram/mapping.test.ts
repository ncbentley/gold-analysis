import { describe, expect, it } from "vitest";
import { parseChannelInput, toIncomingEvent } from "./mapping";

const ch = { channelId: "1234567890", username: "goldcalls" };
const base = { id: 42, message: "XAUUSD BUY NOW @ 3400\nSL 3394\nTP1 3406", date: 1_770_000_000 };

describe("telegram mapping", () => {
  it("maps a channel post to a raw event keyed by message id", () => {
    const e = toIncomingEvent(base, ch)!;
    expect(e.externalMessageId).toBe("42");
    expect(e.rawText).toBe(base.message);
    expect(e.publishedAt!.toISOString()).toBe(new Date(base.date * 1000).toISOString());
    expect(e.payload).toMatchObject({ message_id: "42", telegram: { link: "https://t.me/goldcalls/42", channelId: ch.channelId } });
    expect(e.payload).not.toHaveProperty("edit_of");
  });

  it("links replies so updates can find their signal", () => {
    const e = toIncomingEvent({ ...base, id: 50, message: "Move SL to entry", replyTo: { replyToMsgId: 42 } }, ch)!;
    expect(e.payload).toMatchObject({ reply_to_message_id: "42" });
  });

  it("stores edits as separate events that reference the original", () => {
    const e = toIncomingEvent({ ...base, editDate: base.date + 600 }, ch, { edited: true })!;
    expect(e.externalMessageId).toBe(`42@edit-${base.date + 600}`);
    expect(e.payload).toMatchObject({ edit_of: "42" });
    expect(e.publishedAt!.getTime()).toBe((base.date + 600) * 1000);
  });

  it("skips empty posts and link previews, keeps captionless media as evidence", () => {
    expect(toIncomingEvent({ ...base, message: "" }, ch)).toBeNull();
    expect(toIncomingEvent({ ...base, message: "", media: { className: "MessageMediaWebPage" } }, ch)).toBeNull();
    expect(toIncomingEvent({ ...base, message: "", media: { className: "MessageMediaPhoto" } }, ch)?.rawText).toBe("[photo without caption]");
  });

  it("uses private links for channels without a username", () => {
    const e = toIncomingEvent(base, { channelId: "777", username: null })!;
    expect((e.payload as { telegram: { link: string } }).telegram.link).toBe("https://t.me/c/777/42");
  });

  it("parses the ways admins paste channels", () => {
    expect(parseChannelInput("@GoldCalls")).toEqual({ kind: "username", username: "GoldCalls" });
    expect(parseChannelInput("goldcalls")).toEqual({ kind: "username", username: "goldcalls" });
    expect(parseChannelInput("https://t.me/goldcalls/123")).toEqual({ kind: "username", username: "goldcalls" });
    expect(parseChannelInput("https://t.me/+AbC_d-12")).toEqual({ kind: "invite", hash: "AbC_d-12" });
    expect(parseChannelInput("t.me/joinchat/XyZ123")).toEqual({ kind: "invite", hash: "XyZ123" });
    expect(parseChannelInput("not a channel!")).toBeNull();
  });
});
