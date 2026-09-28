"use client";

import { useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface ChatMenuOption {
  id: string;
  label: string;
}

function MenuGroup({ label, options, selected, onPick }: { label: string; options: ChatMenuOption[]; selected: string; onPick: (option: ChatMenuOption) => void }) {
  if (options.length === 0) return null;
  return (
    <div>
      <div className="px-2 py-1 text-xs font-semibold text-neutral-700">{label}</div>
      {options.map((option) => {
        const active = option.id === selected;
        return (
          <button
            key={option.id}
            type="button"
            role="option"
            aria-selected={active}
            className={cn(
              "block w-full px-2 py-1.5 text-left text-sm font-medium text-neutral-900",
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
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState("");
  const [label, setLabel] = useState("Choose a channel or group");
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    function onPointer(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function pick(option: ChatMenuOption) {
    setSelected(option.id);
    setLabel(option.label);
    setOpen(false);
  }

  return (
    <div ref={rootRef} className="relative">
      <input
        name="chatId"
        value={selected}
        required
        tabIndex={-1}
        aria-hidden="true"
        onChange={() => {}}
        className="sr-only"
      />
      <button
        id="ch-pick"
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        className="flex h-8 w-full min-w-0 items-center rounded-lg border border-input bg-input/30 px-2 text-left text-sm font-medium text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="truncate">{label}</span>
      </button>
      {open && (
        <div
          id={listId}
          role="listbox"
          data-testid="telegram-source-menu"
          className="absolute z-30 mt-1 max-h-80 w-full overflow-auto rounded-lg border border-neutral-200 bg-white py-1 font-sans shadow-lg"
        >
          <MenuGroup label="Channels" options={channels} selected={selected} onPick={pick} />
          <MenuGroup label="Groups" options={groups} selected={selected} onPick={pick} />
        </div>
      )}
    </div>
  );
}
