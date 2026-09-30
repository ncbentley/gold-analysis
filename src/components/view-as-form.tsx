"use client";

import { Eye } from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";
import { setViewAsAction } from "@/app/actions/view-as";

const LEVELS = [
  { value: "admin", label: "Admin" },
  { value: "platinum", label: "Platinum" },
  { value: "gold", label: "Gold" },
  { value: "silver", label: "Silver" },
  { value: "none", label: "No plan" },
] as const;

export function ViewAsForm({ current }: { current: string }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const query = search.toString();
  const returnTo = query ? `${pathname}?${query}` : pathname;

  return (
    <form action={setViewAsAction} className="flex items-center gap-2">
      <input type="hidden" name="return" value={returnTo} />
      <label htmlFor="view-as" className="flex items-center gap-1.5 text-xs font-medium text-primary/90">
        <Eye className="size-3.5" />
        View as
      </label>
      <select
        id="view-as"
        name="level"
        key={current}
        defaultValue={current}
        onChange={(event) => event.currentTarget.form?.requestSubmit()}
        className="h-7 rounded-lg border border-primary/40 bg-[#0a1428] px-2 text-xs font-semibold text-foreground outline-none transition-colors hover:border-primary/70 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {LEVELS.map((level) => (
          <option key={level.value} value={level.value}>
            {level.label}
          </option>
        ))}
      </select>
    </form>
  );
}
