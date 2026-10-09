import { and, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { recordAudit, type Actor } from "@/server/audit";
import { getEntitledSubscription } from "@/server/billing/service";
import { getDb } from "@/server/db";
import { complimentaryGrants, subscriptions, users, type BillingPeriod, type Tier } from "@/server/db/schema";
import { canGrant } from "@/server/entitlements/complimentary";
import { TIER_LABEL } from "@/server/entitlements/config";
import { getTierConfig } from "@/server/entitlements/service";
import { accessForMember, trialEndsAt } from "@/server/entitlements/trial";

const ENTITLED = ["active", "trialing", "past_due"] as const;

export interface MemberListItem {
  id: string;
  email: string;
  role: "member" | "admin";
  emailVerifiedAt: Date | null;
  createdAt: Date;
  paid: { tier: Tier; period: BillingPeriod; status: string } | null;
  complimentary: Tier | null;
  accessLabel: string;
  canGrantBasic: boolean;
  canGrantSilver: boolean;
  canGrantGold: boolean;
  canRemove: boolean;
}

export async function listMembers(query: string): Promise<MemberListItem[]> {
  const db = await getDb();
  const q = query.trim().toLowerCase().slice(0, 200);
  const now = new Date();
  const [people, grants, subs, config] = await Promise.all([
    db
      .select({
        id: users.id,
        email: users.email,
        role: users.role,
        emailVerifiedAt: users.emailVerifiedAt,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(q ? sql`position(${q} in lower(${users.email})) > 0` : undefined)
      .orderBy(desc(users.createdAt))
      .limit(300),
    db.select({ userId: complimentaryGrants.userId, tier: complimentaryGrants.tier }).from(complimentaryGrants),
    db
      .select({
        userId: subscriptions.userId,
        tier: subscriptions.tier,
        period: subscriptions.period,
        status: subscriptions.status,
        currentPeriodEnd: subscriptions.currentPeriodEnd,
      })
      .from(subscriptions)
      .where(and(inArray(subscriptions.status, [...ENTITLED]), gt(subscriptions.currentPeriodEnd, now))),
    getTierConfig(),
  ]);

  const grantByUser = new Map(grants.map((g) => [g.userId, g.tier]));
  const paidByUser = new Map<string, (typeof subs)[number]>();
  for (const row of subs) {
    const prev = paidByUser.get(row.userId);
    if (!prev || row.currentPeriodEnd > prev.currentPeriodEnd) paidByUser.set(row.userId, row);
  }

  return people.map((person) => {
    const paidRow = paidByUser.get(person.id);
    const paid = paidRow ? { tier: paidRow.tier, period: paidRow.period, status: paidRow.status } : null;
    const complimentary = grantByUser.get(person.id) ?? null;
    const state = { role: person.role, paid: paid?.tier ?? null, grant: complimentary };
    const access = accessForMember({
      createdAt: person.createdAt,
      now,
      subscription: paid ? { tier: paid.tier } : null,
      complimentary,
      config,
    });
    const accessLabel =
      person.role === "admin" ? "Admin" : access.tier ? TIER_LABEL[access.tier] : now < trialEndsAt(person.createdAt) ? "Trial" : "None";
    return {
      ...person,
      paid,
      complimentary,
      accessLabel,
      canGrantBasic: canGrant(state, "basic"),
      canGrantSilver: canGrant(state, "silver"),
      canGrantGold: canGrant(state, "gold"),
      canRemove: person.role === "member" && complimentary != null,
    };
  });
}

export async function grantComplimentary(actor: Actor, userId: string, tier: Tier) {
  const db = await getDb();
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new Error("Member not found.");
  const [grant] = await db.select().from(complimentaryGrants).where(eq(complimentaryGrants.userId, userId)).limit(1);
  const paid = await getEntitledSubscription(userId);
  if (!canGrant({ role: user.role, paid: paid?.tier ?? null, grant: grant?.tier ?? null }, tier)) {
    throw new Error("That plan is not an upgrade for this member.");
  }
  await db
    .insert(complimentaryGrants)
    .values({ userId, tier, grantedByUserId: actor.userId })
    .onConflictDoUpdate({ target: complimentaryGrants.userId, set: { tier, grantedByUserId: actor.userId, updatedAt: new Date() } });
  await recordAudit({
    actor,
    entityType: "user",
    entityId: userId,
    action: "member.complimentary_granted",
    before: grant ? { tier: grant.tier } : null,
    after: { tier },
  });
}

export async function removeComplimentary(actor: Actor, userId: string) {
  const db = await getDb();
  const [grant] = await db.select().from(complimentaryGrants).where(eq(complimentaryGrants.userId, userId)).limit(1);
  if (!grant) throw new Error("This member has no complimentary plan.");
  await db.delete(complimentaryGrants).where(eq(complimentaryGrants.userId, userId));
  await recordAudit({
    actor,
    entityType: "user",
    entityId: userId,
    action: "member.complimentary_removed",
    before: { tier: grant.tier },
    after: null,
  });
}
