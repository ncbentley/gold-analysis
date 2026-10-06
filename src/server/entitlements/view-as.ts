import { TIERS, type Tier } from "@/server/db/schema";
import { buildAccess, freeAccess, type Access } from "./access";
import type { TierConfig } from "./config";

/** Cookie set only by an admin. Ignored for every other account. */
export const VIEW_AS_COOKIE = "gsi_view_as";

export type ViewAs = Tier | "none";

export function parseViewAs(value: string | undefined | null): ViewAs | null {
  if (!value || value === "admin") return null;
  if (value === "none") return "none";
  if (value === "platinum") return "gold";
  return (TIERS as readonly string[]).includes(value) ? (value as Tier) : null;
}

/** Real admin access, or a member tier, or a signed-in visitor with no plan. */
export function accessForPreview(config: Record<Tier, TierConfig>, viewAs: ViewAs | null): Access {
  if (!viewAs) return buildAccess(null, config, true);
  if (viewAs === "none") return freeAccess();
  return buildAccess(viewAs, config, false);
}
