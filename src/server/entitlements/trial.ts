import type { Tier } from "@/server/db/schema";
import { ANONYMOUS, buildAccess, freeAccess, type Access } from "./access";
import { appliedComplimentary } from "./complimentary";
import type { TierConfig } from "./config";

export const TRIAL_MS = 7 * 24 * 60 * 60 * 1000;

export function trialEndsAt(createdAt: Date): Date {
  return new Date(createdAt.getTime() + TRIAL_MS);
}

function inTrial(createdAt: Date, now: Date): boolean {
  return now < trialEndsAt(createdAt);
}

export function showTrialBanner(input: { createdAt: Date; now: Date; hasPlan: boolean }): boolean {
  return !input.hasPlan && input.now.getTime() < trialEndsAt(input.createdAt).getTime();
}

export function accessForMember(input: {
  createdAt: Date;
  now: Date;
  subscription: { tier: Tier } | null;
  complimentary?: Tier | null;
  config: Record<Tier, TierConfig>;
}): Access {
  const { createdAt, now, subscription, config } = input;
  const grant = appliedComplimentary(subscription?.tier ?? null, input.complimentary ?? null);
  if (subscription) {
    if (inTrial(createdAt, now)) return buildAccess("gold", config);
    if (grant) return buildAccess(grant, config);
    return buildAccess(subscription.tier, config);
  }
  if (grant) return buildAccess(grant, config);
  if (inTrial(createdAt, now)) return freeAccess();
  return ANONYMOUS;
}
