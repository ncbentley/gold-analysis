"use client";

import { useId, useMemo, useState } from "react";
import { cn } from "@/lib/utils";

export interface ChatMenuOption {
  id: string;
  accessHash: string | null;
  username: string | null;
  title: string;
  kind: "channel" | "group";
  label: string;
  tracked: boolean;
}

function payload(chat: ChatMenuOption) {
  return JSON.stringify({
    id: chat.id,
    accessHash: chat.accessHash,
    username: chat.username,
    title: chat.title,
    kind: chat.kind,
  });
}

/** One filterable list. Each row is a checkbox. Already-tracked chats stay visible and cannot be selected. */
export function TelegramChatMenu({ chats }: { chats: ChatMenuOption[] }) {
  const [query, setQuery] = useState("");
  const listId = useId();
  const needle = query.trim().toLowerCase();
  const shown = useMemo(() => (needle ? chats.filter((chat) => chat.label.toLowerCase().includes(needle)) : chats), [chats, needle]);

  return (
    <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white font-sans">
      <input
        id="ch-pick"
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Filter channels and groups"
        aria-controls={listId}
        autoComplete="off"
        className="w-full border-b border-neutral-200 bg-white px-3 py-2 text-sm font-medium text-neutral-900 outline-none placeholder:text-neutral-500"
      />
      <div id={listId} data-testid="telegram-source-menu" className="h-[32rem] overflow-y-auto">
        {shown.length === 0 ? (
          <p className="px-3 py-2 text-sm font-medium text-neutral-700">No matching channels or groups.</p>
        ) : (
          shown.map((chat) => (
            <label
              key={chat.id}
              className={cn(
                "flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-neutral-900",
                chat.tracked ? "cursor-default text-neutral-500" : "cursor-pointer hover:bg-blue-700 hover:text-white",
              )}
            >
              <input
                type="checkbox"
                name="chat"
                value={payload(chat)}
                disabled={chat.tracked}
                className="size-4 accent-blue-700"
              />
              <span>{chat.label}</span>
            </label>
          ))
        )}
      </div>
    </div>
  );
}
