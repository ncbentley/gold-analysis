import type { Tier } from "@/server/db/schema";
import { ALL_FEATURES, FREE_FEATURES, FREE_HISTORY_DAYS, TIER_ORDER, type Feature, type TierConfig } from "./config";

export interface Access {
  tier: Tier | null;
  isAdmin: boolean;
  features: ReadonlySet<Feature>;
  historyDays: number | null;
}

export type Gated<T> =
  | { locked: false; data: T }
  | { locked: true; feature: Feature; requiredTier: Tier | null };

export const ANONYMOUS: Access = { tier: null, isAdmin: false, features: new Set(), historyDays: 0 };

export function freeAccess(): Access {
  return { tier: null, isAdmin: false, features: new Set(FREE_FEATURES), historyDays: FREE_HISTORY_DAYS };
}

export function buildAccess(tier: Tier | null, config: Record<Tier, TierConfig>, isAdmin = false): Access {
  if (isAdmin) return { tier: "platinum", isAdmin: true, features: new Set(ALL_FEATURES), historyDays: null };
  if (!tier) return ANONYMOUS;
  if (tier === "gold") return buildAccess("platinum", config);
  const c = config[tier];
  return { tier, isAdmin: false, features: new Set(c.features), historyDays: c.historyDays };
}

export function can(access: Access, feature: Feature) {
  return access.features.has(feature);
}

export function lowestTierWith(feature: Feature, config: Record<Tier, TierConfig>): Tier | null {
  return TIER_ORDER.find((t) => t !== "gold" && config[t].features.includes(feature)) ?? null;
}

/** Cheapest offered plan whose history window still contains `signalTime`. Gold is skipped. */
export function tierForSignalTime(signalTime: Date, config: Record<Tier, TierConfig>, now = new Date()): Tier | null {
  return (
    TIER_ORDER.find((tier) => {
      if (tier === "gold") return false;
      const days = config[tier].historyDays;
      if (days === null) return true;
      return signalTime >= new Date(now.getTime() - days * 86_400_000);
    }) ?? null
  );
}

export function gate<T>(
  access: Access,
  feature: Feature,
  config: Record<Tier, TierConfig>,
  produce: () => T,
): Gated<T> {
  if (can(access, feature)) return { locked: false, data: produce() };
  return { locked: true, feature, requiredTier: lowestTierWith(feature, config) };
}

export function historyCutoff(access: Access, now = new Date()): Date | null {
  if (access.historyDays === null) return null;
  return new Date(now.getTime() - access.historyDays * 86_400_000);
}

export class EntitlementError extends Error {
  constructor(
    public feature: Feature | "subscription",
    public status = 403,
  ) {
    super(`Missing entitlement: ${feature}`);
  }
}

export function requireFeature(access: Access, feature: Feature) {
  if (!can(access, feature)) throw new EntitlementError(feature, access.tier ? 403 : 401);
}
