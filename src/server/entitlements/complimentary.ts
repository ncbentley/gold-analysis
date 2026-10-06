import type { Tier } from "@/server/db/schema";

const RANK: Record<Tier, number> = { silver: 1, gold: 2 };

/** The grant, when it outranks the plan they pay for. Same or lower is ignored. */
export function appliedComplimentary(paid: Tier | null, grant: Tier | null): Tier | null {
  if (!grant) return null;
  const paidRank = paid ? RANK[paid] : 0;
  return RANK[grant] > paidRank ? grant : null;
}

/**
 * Silver only when they pay for nothing and have no grant.
 * Gold when they are not already on Gold, paid or complimentary.
 * Admins already see everything.
 */
export function canGrant(input: { role: "member" | "admin"; paid: Tier | null; grant: Tier | null }, tier: Tier): boolean {
  if (input.role !== "member") return false;
  if (tier === "silver") return input.paid == null && input.grant == null;
  return input.paid !== "gold" && input.grant !== "gold";
}
