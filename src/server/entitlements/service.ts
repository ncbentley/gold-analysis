import { cookies } from "next/headers";
import { cache } from "react";
import { getCurrentUser } from "@/server/auth";
import { getEntitledSubscription } from "@/server/billing/service";
import { getDb } from "@/server/db";
import { tierEntitlements, TIERS, type Tier, type User } from "@/server/db/schema";
import { ANONYMOUS, buildAccess, type Access } from "./access";
import { ALL_FEATURES, DEFAULT_TIER_CONFIG, type Feature, type TierConfig } from "./config";
import { getComplimentaryTier } from "./grants";
import { accessForMember } from "./trial";
import { accessForPreview, parseViewAs, VIEW_AS_COOKIE, type ViewAs } from "./view-as";

export async function getTierConfig(): Promise<Record<Tier, TierConfig>> {
  const db = await getDb();
  const rows = await db.select().from(tierEntitlements);
  const config = structuredClone(DEFAULT_TIER_CONFIG);
  for (const row of rows) {
    config[row.tier] = {
      features: row.features.filter((f): f is Feature => (ALL_FEATURES as string[]).includes(f)),
      historyDays: row.historyDays,
    };
  }
  return config;
}

export async function saveTierConfig(tier: Tier, value: TierConfig) {
  if (!TIERS.includes(tier)) throw new Error("Unknown tier");
  const db = await getDb();
  await db
    .insert(tierEntitlements)
    .values({ tier, features: value.features, historyDays: value.historyDays })
    .onConflictDoUpdate({ target: tierEntitlements.tier, set: { features: value.features, historyDays: value.historyDays } });
}

export async function accessForUser(user: User | null, config?: Record<Tier, TierConfig>): Promise<Access> {
  const cfg = config ?? (await getTierConfig());
  if (!user) return ANONYMOUS;
  if (user.role === "admin") return buildAccess(null, cfg, true);
  const [sub, complimentary] = await Promise.all([getEntitledSubscription(user.id), getComplimentaryTier(user.id)]);
  return accessForMember({ createdAt: user.createdAt, now: new Date(), subscription: sub, complimentary, config: cfg });
}

export interface Viewer {
  user: User | null;
  access: Access;
  config: Record<Tier, TierConfig>;
  subscription: Awaited<ReturnType<typeof getEntitledSubscription>>;
  /** Stored complimentary tier, including one that does not outrank a paid plan. */
  complimentary: Tier | null;
  /** Set only for an admin who is previewing a membership. Admin tools ignore it. */
  viewAs: ViewAs | null;
}

/**
 * Per-request viewer context. Member pages and the member API honor an admin's
 * view-as choice. Pass "admin" from admin screens so previewing Silver does not
 * hide the operator's own tools.
 */
export const getViewer = cache(async (scope: "member" | "admin" = "member"): Promise<Viewer> => {
  const user = await getCurrentUser();
  const config = await getTierConfig();
  const subscription = user ? await getEntitledSubscription(user.id) : null;
  const complimentary = user ? await getComplimentaryTier(user.id) : null;
  const requested = user?.role === "admin" ? parseViewAs((await cookies()).get(VIEW_AS_COOKIE)?.value) : null;
  const viewAs = scope === "member" ? requested : null;
  const access =
    user?.role === "admin"
      ? accessForPreview(config, viewAs)
      : user
        ? accessForMember({ createdAt: user.createdAt, now: new Date(), subscription, complimentary, config })
        : ANONYMOUS;
  return { user, access, config, subscription, complimentary, viewAs: requested };
});
