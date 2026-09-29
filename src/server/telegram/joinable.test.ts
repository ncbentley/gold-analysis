import { describe, expect, it } from "vitest";
import { joinableTelegramChats } from "@/server/telegram/joinable";

describe("joinable telegram chats", () => {
  it("leaves out channels that are already an active source", () => {
    const chats = [
      { id: "1", title: "Tracked Desk" },
      { id: "2", title: "Open Desk" },
      { id: "3", title: "Open Group" },
    ];
    const tracked = new Set(["1"]);
    expect(joinableTelegramChats(chats, tracked).map((chat) => chat.title)).toEqual(["Open Desk", "Open Group"]);
  });
});
