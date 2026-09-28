"use client";

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
      <label htmlFor="view-as" className="text-xs text-muted-foreground">
        View as
      </label>
      <select
        id="view-as"
        name="level"
        key={current}
        defaultValue={current}
        onChange={(event) => event.currentTarget.form?.requestSubmit()}
        className="h-7 rounded-md border border-input bg-background px-2 text-xs"
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
