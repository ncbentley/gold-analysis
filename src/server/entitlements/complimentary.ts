import type { Tier } from "@/server/db/schema";

const RANK: Record<Tier, number> = { basic: 1, silver: 2, gold: 3 };

/** The grant, when it outranks the plan they pay for. Same or lower is ignored. */
export function appliedComplimentary(paid: Tier | null, grant: Tier | null): Tier | null {
  if (!grant) return null;
  const paidRank = paid ? RANK[paid] : 0;
  return RANK[grant] > paidRank ? grant : null;
}

/** A grant is an upgrade: higher than both the paid plan and any grant already on the account. */
export function canGrant(input: { role: "member" | "admin"; paid: Tier | null; grant: Tier | null }, tier: Tier): boolean {
  if (input.role !== "member") return false;
  const held = Math.max(input.paid ? RANK[input.paid] : 0, input.grant ? RANK[input.grant] : 0);
  return RANK[tier] > held;
}
