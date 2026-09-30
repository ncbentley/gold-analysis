"use client";

import { Search } from "lucide-react";
import { useId, useMemo, useState } from "react";

export interface ChatMenuOption {
  id: string;
  accessHash: string | null;
  username: string | null;
  title: string;
  kind: "channel" | "group";
  label: string;
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

/** One filterable checkbox list of channels and groups that are not already sources. */
export function TelegramChatMenu({ chats }: { chats: ChatMenuOption[] }) {
  const [query, setQuery] = useState("");
  const listId = useId();
  const needle = query.trim().toLowerCase();
  const shown = useMemo(() => (needle ? chats.filter((chat) => chat.label.toLowerCase().includes(needle)) : chats), [chats, needle]);

  return (
    <div className="overflow-hidden rounded-xl border border-glow/40 bg-[#081226] font-sans shadow-[0_0_22px_-12px_rgb(47_123_255/0.7)] focus-within:border-primary/60">
      <div className="relative border-b border-glow/25">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          id="ch-pick"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter channels and groups"
          aria-controls={listId}
          autoComplete="off"
          className="w-full bg-transparent py-2.5 pr-3 pl-9 text-sm font-medium text-foreground outline-none placeholder:text-muted-foreground"
        />
      </div>
      <div id={listId} data-testid="telegram-source-menu" className="h-[32rem] overflow-y-auto py-1">
        {shown.length === 0 ? (
          <p className="px-3 py-2 text-sm font-medium text-muted-foreground">No matching channels or groups.</p>
        ) : (
          shown.map((chat) => (
            <label
              key={chat.id}
              className="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-glow/15 has-[:checked]:bg-primary/10 has-[:checked]:text-primary has-[:focus-visible]:bg-glow/15"
            >
              <input type="checkbox" name="chat" value={payload(chat)} className="size-4 shrink-0 accent-primary" />
              <span>{chat.label}</span>
            </label>
          ))
        )}
      </div>
    </div>
  );
}
