"use client";

import { Lock, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type Option = { value: string; label: string };

function FilterSelect({
  name,
  label,
  options,
  disabled,
  onChange,
  value,
}: {
  name: string;
  label: string;
  options: Option[];
  disabled?: boolean;
  value: string;
  onChange: (name: string, value: string) => void;
}) {
  const items = [{ value: "all", label: `All ${label.toLowerCase()}` }, ...options];
  return (
    <Select items={items} value={value || "all"} onValueChange={(v) => onChange(name, String(v ?? "all"))} disabled={disabled}>
      <SelectTrigger className="h-8 min-w-36" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function SignalFilters({
  sources,
  signalTypes,
  advanced,
  search,
}: {
  sources: Option[];
  signalTypes: string[];
  advanced: boolean;
  search: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();

  const set = (name: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (!value || value === "all") next.delete(name);
    else next.set(name, value);
    next.delete("page");
    start(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  };
  const hasAny = [...params.keys()].some((k) => k !== "page");

  const lockedHint = (el: React.ReactNode, key: string) =>
    advanced ? (
      el
    ) : (
      <Tooltip key={key}>
        <TooltipTrigger render={<div className="relative">{el}<Lock className="pointer-events-none absolute right-8 top-2 size-3.5 text-primary/70" /></div>} />
        <TooltipContent>Advanced filters are included with Platinum</TooltipContent>
      </Tooltip>
    );

  return (
    <div className={cn("flex flex-wrap items-center gap-2", pending && "opacity-70")}>
      <FilterSelect name="source" label="Sources" options={sources} value={params.get("source") ?? ""} onChange={set} />
      <FilterSelect
        name="status"
        label="Statuses"
        value={params.get("status") ?? ""}
        onChange={set}
        options={[
          { value: "OPEN", label: "Open (pending / active)" },
          { value: "CLOSED", label: "Closed" },
          { value: "PENDING", label: "Pending" },
          { value: "ACTIVE", label: "Active" },
          { value: "PARTIAL", label: "Partial" },
          { value: "WON", label: "Won" },
          { value: "LOST", label: "Lost" },
          { value: "BREAKEVEN", label: "Breakeven" },
          { value: "EXPIRED", label: "Expired" },
          { value: "CANCELLED", label: "Cancelled" },
          { value: "MANUAL_REVIEW", label: "Ambiguous" },
        ]}
      />
      <FilterSelect
        name="direction"
        label="Directions"
        value={params.get("direction") ?? ""}
        onChange={set}
        options={[
          { value: "LONG", label: "Long" },
          { value: "SHORT", label: "Short" },
        ]}
      />
      <Input
        type="date"
        aria-label="From date"
        className="h-8 w-38"
        defaultValue={params.get("from") ?? ""}
        onChange={(e) => set("from", e.target.value)}
      />
      <Input type="date" aria-label="To date" className="h-8 w-38" defaultValue={params.get("to") ?? ""} onChange={(e) => set("to", e.target.value)} />
      {lockedHint(
        <FilterSelect
          name="entryType"
          label="Entry types"
          disabled={!advanced}
          value={params.get("entryType") ?? ""}
          onChange={set}
          options={[
            { value: "MARKET", label: "Market" },
            { value: "LIMIT", label: "Limit" },
            { value: "ZONE", label: "Zone" },
          ]}
        />,
        "entryType",
      )}
      {lockedHint(
        <FilterSelect
          name="signalType"
          label="Signal types"
          disabled={!advanced}
          value={params.get("signalType") ?? ""}
          onChange={set}
          options={signalTypes.map((t) => ({ value: t, label: t.charAt(0).toUpperCase() + t.slice(1) }))}
        />,
        "signalType",
      )}
      {search && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            set("q", String(new FormData(e.currentTarget).get("q") ?? ""));
          }}
        >
          <Input name="q" placeholder="Search source text…" className="h-8 w-48" defaultValue={params.get("q") ?? ""} />
        </form>
      )}
      {hasAny && (
        <Button variant="ghost" size="sm" onClick={() => start(() => router.replace(pathname, { scroll: false }))}>
          <X /> Clear
        </Button>
      )}
    </div>
  );
}
