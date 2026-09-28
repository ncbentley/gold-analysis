"use client";

import { useId, useMemo, useState } from "react";
import { cn } from "@/lib/utils";

export interface ChatMenuOption {
  id: string;
  label: string;
}

function matches(option: ChatMenuOption, query: string) {
  return option.label.toLowerCase().includes(query);
}

function MenuGroup({ label, options, selected, onPick }: { label: string; options: ChatMenuOption[]; selected: string; onPick: (option: ChatMenuOption) => void }) {
  if (options.length === 0) return null;
  return (
    <div>
      <div className="px-3 py-1.5 text-xs font-semibold text-neutral-700">{label}</div>
      {options.map((option) => {
        const active = option.id === selected;
        return (
          <button
            key={option.id}
            type="button"
            role="option"
            aria-selected={active}
            className={cn(
              "block w-full px-3 py-1.5 text-left text-sm font-medium text-neutral-900",
              active ? "bg-blue-700 text-white" : "hover:bg-blue-700 hover:text-white",
            )}
            onClick={() => onPick(option)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function TelegramChatMenu({ channels, groups }: { channels: ChatMenuOption[]; groups: ChatMenuOption[] }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState("");
  const listId = useId();
  const needle = query.trim().toLowerCase();
  const shownChannels = useMemo(() => (needle ? channels.filter((option) => matches(option, needle)) : channels), [channels, needle]);
  const shownGroups = useMemo(() => (needle ? groups.filter((option) => matches(option, needle)) : groups), [groups, needle]);
  const empty = shownChannels.length === 0 && shownGroups.length === 0;

  return (
    <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white font-sans">
      <input name="chatId" value={selected} required tabIndex={-1} aria-hidden="true" onChange={() => {}} className="sr-only" />
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
      <div id={listId} role="listbox" data-testid="telegram-source-menu" className="h-[32rem] overflow-y-auto">
        {empty ? (
          <p className="px-3 py-2 text-sm font-medium text-neutral-700">No matching channels or groups.</p>
        ) : (
          <>
            <MenuGroup label="Channels" options={shownChannels} selected={selected} onPick={(option) => setSelected(option.id)} />
            <MenuGroup label="Groups" options={shownGroups} selected={selected} onPick={(option) => setSelected(option.id)} />
          </>
        )}
      </div>
    </div>
  );
}
