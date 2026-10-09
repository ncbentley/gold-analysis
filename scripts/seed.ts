/**
 * Migrates the database and seeds configuration only: tier entitlements, plans and the
 * admin account. No sources, signals or market data are created; signals come from the
 * Telegram channels connected in /admin/telegram.
 *
 *   pnpm db:setup          migrate + seed if empty
 *   pnpm db:reset          wipe local PGlite data, then migrate + seed
 *
 * SEED_DEMO_USERS=1 additionally creates one member per tier for testing access levels.
 */
import "dotenv/config";
import { and, eq, isNull, sql } from "drizzle-orm";
import { hashPassword } from "@/server/auth";
import { PERIOD_DAYS, PLACEHOLDER_PRICES_CENTS, stripePriceEnv } from "@/server/billing/config";
import { closeDb, getDb } from "@/server/db";
import { runMigrations } from "@/server/db/migrate";
import { PERIODS, plans, subscriptions, tierEntitlements, TIERS, users } from "@/server/db/schema";
import { DEFAULT_TIER_CONFIG } from "@/server/entitlements/config";

const DEV_ADMIN_PASSWORD = "admin12345";

async function seedConfig() {
  const db = await getDb();
  for (const tier of TIERS) {
    const c = DEFAULT_TIER_CONFIG[tier];
    await db.insert(tierEntitlements).values({ tier, features: c.features, historyDays: c.historyDays }).onConflictDoNothing();
    for (const period of PERIODS) {
      const providerPriceId = process.env[stripePriceEnv(tier, period)] ?? null;
      await db
        .insert(plans)
        .values({ tier, period, amountCents: PLACEHOLDER_PRICES_CENTS[tier][period], providerPriceId })
        .onConflictDoNothing();
      if (providerPriceId) {
        await db
          .update(plans)
          .set({ providerPriceId })
          .where(and(eq(plans.tier, tier), eq(plans.period, period), isNull(plans.providerPriceId)));
      }
    }
  }
}

async function seedAdmin() {
  const db = await getDb();
  const email = process.env.SEED_ADMIN_EMAIL ?? "admin@example.com";
  const password = process.env.SEED_ADMIN_PASSWORD ?? DEV_ADMIN_PASSWORD;
  if (process.env.NODE_ENV === "production" && (password === DEV_ADMIN_PASSWORD || password.length < 12)) {
    throw new Error("Set SEED_ADMIN_PASSWORD (12+ characters) before seeding a production database.");
  }
  await db
    .insert(users)
    .values({ email, passwordHash: await hashPassword(password), role: "admin", emailVerifiedAt: new Date() })
    .onConflictDoNothing();
  console.log(`  admin: ${email}${password === DEV_ADMIN_PASSWORD ? ` / ${DEV_ADMIN_PASSWORD}` : ""}`);
}

async function seedDemoUsers() {
  const db = await getDb();
  const now = new Date();
  const pw = await hashPassword("demo12345");
  for (const tier of [null, ...TIERS]) {
    const email = `${tier ?? "free"}@example.com`;
    const [u] = await db.insert(users).values({ email, passwordHash: pw, emailVerifiedAt: now }).onConflictDoNothing().returning();
    if (u && tier) {
      await db.insert(subscriptions).values({
        userId: u.id,
        tier,
        period: "monthly",
        status: "active",
        provider: "mock",
        providerCustomerId: `mock_cus_${u.id.slice(0, 8)}`,
        providerSubscriptionId: `mock_sub_seed_${tier}`,
        currentPeriodEnd: new Date(now.getTime() + PERIOD_DAYS.monthly * 86_400_000),
      });
    }
    console.log(`  member: ${email} / demo12345`);
  }
}

async function main() {
  const reset = process.argv.includes("--reset");
  if (reset && !process.env.DATABASE_URL) {
    const { rm } = await import("node:fs/promises");
    const { pgliteDataDir } = await import("@/server/db");
    await rm(pgliteDataDir(), { recursive: true, force: true });
    console.log("Removed local PGlite data.");
  }
  await runMigrations();
  const db = await getDb();
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(users);
  if (count > 0 && !process.argv.includes("--force")) {
    console.log("Database already seeded. Use `pnpm db:reset` to start over.");
    await closeDb();
    return;
  }

  console.log("Seeding plans, entitlements and the admin account…");
  await seedConfig();
  await seedAdmin();
  if (process.env.SEED_DEMO_USERS === "1") await seedDemoUsers();
  await closeDb();
  console.log("Seed complete. Sign in as the admin and connect Telegram at /admin/telegram.");
}

main().catch(async (err) => {
  console.error(err);
  await closeDb();
  process.exit(1);
});
