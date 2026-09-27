/**
 * Migrates the database and seeds demo data by pushing mock source messages
 * through the real ingestion -> parsing -> normalization -> outcome pipeline.
 *
 *   pnpm db:setup          migrate + seed if empty
 *   pnpm db:reset          wipe local PGlite data, then migrate + seed
 */
import "dotenv/config";
import { eq, sql } from "drizzle-orm";
import { hashPassword } from "@/server/auth";
import { PLACEHOLDER_PRICES_CENTS, stripePriceEnv } from "@/server/billing/config";
import { closeDb, getDb } from "@/server/db";
import { runMigrations } from "@/server/db/migrate";
import {
  affiliateLinks,
  marketBars,
  plans,
  sources,
  subscriptions,
  tierEntitlements,
  TIERS,
  PERIODS,
  users,
  type Source,
} from "@/server/db/schema";
import { DEFAULT_TIER_CONFIG } from "@/server/entitlements/config";
import { ingestRawEvent } from "@/server/ingestion";
import { processJobs } from "@/server/jobs/runner";
import { syncMarketData } from "@/server/market-data";
import { isGoldMarketOpen } from "@/server/market-data/provider";
import { PERIOD_DAYS } from "@/server/billing/config";

const HISTORY_DAYS = Number(process.env.SEED_HISTORY_DAYS ?? 60);
const MINUTE = 60_000;

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const f2 = (n: number) => n.toFixed(2);

async function seedConfig() {
  const db = await getDb();
  for (const tier of TIERS) {
    const c = DEFAULT_TIER_CONFIG[tier];
    await db.insert(tierEntitlements).values({ tier, features: c.features, historyDays: c.historyDays }).onConflictDoNothing();
    for (const period of PERIODS) {
      await db
        .insert(plans)
        .values({ tier, period, amountCents: PLACEHOLDER_PRICES_CENTS[tier][period], providerPriceId: process.env[stripePriceEnv(tier, period)] ?? null })
        .onConflictDoNothing();
    }
  }
}

async function seedUsers() {
  const db = await getDb();
  const now = new Date();
  const adminPw = await hashPassword(process.env.SEED_ADMIN_PASSWORD ?? "admin12345");
  const demoPw = await hashPassword("demo12345");
  await db
    .insert(users)
    .values({ email: process.env.SEED_ADMIN_EMAIL ?? "admin@example.com", passwordHash: adminPw, role: "admin", emailVerifiedAt: now })
    .onConflictDoNothing();
  const members = [
    { email: "free@example.com", tier: null },
    { email: "silver@example.com", tier: "silver" as const },
    { email: "gold@example.com", tier: "gold" as const },
    { email: "platinum@example.com", tier: "platinum" as const },
  ];
  for (const m of members) {
    const [u] = await db.insert(users).values({ email: m.email, passwordHash: demoPw, emailVerifiedAt: now }).onConflictDoNothing().returning();
    if (u && m.tier) {
      await db.insert(subscriptions).values({
        userId: u.id,
        tier: m.tier,
        period: "monthly",
        status: "active",
        provider: "mock",
        providerCustomerId: `mock_cus_${u.id.slice(0, 8)}`,
        providerSubscriptionId: `mock_sub_seed_${m.tier}`,
        currentPeriodEnd: new Date(now.getTime() + PERIOD_DAYS.monthly * 86_400_000),
      });
    }
  }
}

async function seedSources() {
  const db = await getDb();
  const rows = [
    {
      name: "Aurum Desk",
      slug: "aurum-desk",
      sourceType: "mock_feed" as const,
      sourceUrl: "https://t.me/example_aurum_desk",
      description: "Telegram channel publishing market-execution gold calls with three targets.",
      parserType: "text-generic",
      timezone: "Europe/London",
    },
    {
      name: "Bullion Flow",
      slug: "bullion-flow",
      sourceType: "mock_feed" as const,
      sourceUrl: "https://t.me/example_bullion_flow",
      description: "Zone-based intraday gold setups, usually two targets.",
      parserType: "text-generic",
      timezone: "Asia/Dubai",
    },
    {
      name: "Midas Webhook",
      slug: "midas-webhook",
      sourceType: "webhook" as const,
      sourceUrl: null,
      description: "Algorithmic signal vendor delivering structured JSON over webhook.",
      parserType: "json-webhook",
      timezone: "America/New_York",
    },
  ];
  for (const r of rows) await db.insert(sources).values(r).onConflictDoNothing();
  return db.select().from(sources);
}

async function seedAffiliates() {
  const db = await getDb();
  await db
    .insert(affiliateLinks)
    .values([
      {
        name: "Northgate Markets",
        slug: "northgate",
        destinationUrl: "https://example.com/brokers/northgate",
        disclosure: "Affiliate link. We may receive a referral fee. Your membership is not affected by opening or funding an account.",
        placements: ["landing", "pricing", "dashboard"],
      },
      {
        name: "Harbor FX",
        slug: "harbor-fx",
        destinationUrl: "https://example.com/brokers/harbor",
        disclosure: "Affiliate link. We may receive a referral fee. Your membership is not affected by opening or funding an account.",
        placements: ["landing", "signal_detail"],
      },
    ])
    .onConflictDoNothing();
}

type Msg = {
  at: Date;
  externalMessageId: string;
  rawText: string;
  payload: Record<string, unknown> | null;
};

function barAt(bars: Map<number, { c: number }>, t: number) {
  for (let k = 0; k < 90; k++) {
    const b = bars.get(t - k * MINUTE);
    if (b) return b.c;
  }
  return null;
}

function buildHistory(source: Source, bars: Map<number, { c: number }>, start: number, end: number, seed: number): Msg[] {
  const rnd = mulberry32(seed);
  const out: Msg[] = [];
  // Per-source "skill": probability of picking the direction of the next few hours' move.
  const skill = source.slug === "aurum-desk" ? 0.64 : source.slug === "bullion-flow" ? 0.52 : 0.46;
  let t = start + Math.floor(rnd() * 6 * 60) * MINUTE;
  let n = 0;
  while (t < end - 30 * MINUTE) {
    const at = new Date(t + Math.floor(rnd() * 50) * 1000);
    const price = barAt(bars, t - MINUTE);
    if (!isGoldMarketOpen(new Date(t)) || price === null) {
      t += 60 * MINUTE;
      continue;
    }
    n++;
    const future = barAt(bars, t + 180 * MINUTE) ?? price;
    const favoured = future >= price ? 1 : -1;
    const dir = rnd() < skill ? favoured : -favoured;
    const long = dir === 1;
    const risk = 3.5 + Math.round(rnd() * 70) / 10;
    const id = `${source.slug}-${n}`;
    const roll = rnd();

    if (source.slug === "midas-webhook") {
      const entry = price - dir * Math.round(rnd() * 20) / 10;
      const payload = {
        action: "open",
        symbol: "XAU/USD",
        side: long ? "buy" : "sell",
        entry: rnd() < 0.5 ? Number(f2(entry)) : [Number(f2(entry - 0.8)), Number(f2(entry + 0.8))],
        sl: Number(f2(entry - dir * risk)),
        tp: [Number(f2(entry + dir * risk * 1.5)), Number(f2(entry + dir * risk * 2.5))],
        type: ["breakout", "reversal", "intraday"][Math.floor(rnd() * 3)],
        ref: id,
      };
      out.push({ at, externalMessageId: id, rawText: JSON.stringify(payload), payload });
      if (roll < 0.15) {
        const upd = { action: "move_sl", sl: "entry", ref: id };
        out.push({ at: new Date(t + (40 + Math.floor(rnd() * 60)) * MINUTE), externalMessageId: `${id}-u`, rawText: JSON.stringify(upd), payload: upd });
      }
    } else if (source.slug === "aurum-desk") {
      let text = `XAUUSD ${long ? "BUY" : "SELL"} NOW @ ${f2(price)}\nSL: ${f2(price - dir * risk)}\nTP1: ${f2(price + dir * risk * 1.2)}\nTP2: ${f2(price + dir * risk * 2)}\nTP3: ${f2(price + dir * risk * 3)}\nConfidence: ${rnd() < 0.5 ? "High" : "Medium"}`;
      if (roll < 0.05) text = `Gold ${long ? "buy" : "sell"} ${f2(price)} tp ${f2(price + dir * risk * 1.5)}`; // no stop -> review
      else if (roll < 0.08) text = `XAUUSD ${long ? "BUY" : "SELL"} ${f2(price)} SL ${f2(price + dir * risk)} TP ${f2(price + dir * risk * 2)}`; // wrong-side stop -> review
      out.push({ at, externalMessageId: id, rawText: text, payload: { channel: source.slug, message_id: id } });
      if (roll > 0.08 && roll < 0.3) {
        out.push({
          at: new Date(t + (25 + Math.floor(rnd() * 50)) * MINUTE),
          externalMessageId: `${id}-be`,
          rawText: "Move SL to entry, lock it in 🔒",
          payload: { channel: source.slug, message_id: `${id}-be`, reply_to_message_id: id },
        });
      } else if (roll > 0.3 && roll < 0.38) {
        out.push({
          at: new Date(t + (60 + Math.floor(rnd() * 90)) * MINUTE),
          externalMessageId: `${id}-close`,
          rawText: "Close gold now, taking what the market gives",
          payload: { channel: source.slug, message_id: `${id}-close`, reply_to_message_id: id },
        });
      } else if (roll > 0.38 && roll < 0.45) {
        out.push({
          at: new Date(t + 35 * MINUTE),
          externalMessageId: `${id}-tp1`,
          rawText: "TP1 hit ✅ congrats team",
          payload: { channel: source.slug, message_id: `${id}-tp1`, reply_to_message_id: id },
        });
      }
      if (roll > 0.95) {
        // Channel re-posts the same message (duplicate delivery).
        out.push({ at, externalMessageId: id, rawText: text, payload: { channel: source.slug, message_id: id } });
      }
      if (roll > 0.9 && roll < 0.93) {
        out.push({ at: new Date(t - 20 * MINUTE), externalMessageId: `${id}-gm`, rawText: "Good morning traders, big data today. Stay patient.", payload: { channel: source.slug, message_id: `${id}-gm` } });
      }
    } else {
      const offset = 1 + Math.round(rnd() * 30) / 10;
      const near = price - dir * offset;
      const far = near - dir * 1.5;
      const lo = Math.min(near, far);
      const hi = Math.max(near, far);
      const ref = long ? hi : lo;
      const stop = ref - dir * risk;
      let text = `GOLD ${long ? "BUY" : "SELL"} ZONE ${f2(lo)} - ${f2(hi)}\nStop Loss ${f2(stop)}\nTake Profit ${f2(ref + dir * risk * 1.3)} / ${f2(ref + dir * risk * 2.2)}\n#${["scalp", "intraday", "pullback", "swing"][Math.floor(rnd() * 4)]}`;
      if (roll < 0.04) text = `Gold ${long ? "buy" : "sell"} area ${f2(lo)}-${f2(hi)}, targets ${f2(ref + dir * risk * 1.3)} and ${f2(ref + dir * risk * 2.2)}`; // no stop
      out.push({ at, externalMessageId: id, rawText: text, payload: { channel: source.slug, message_id: id } });
      if (roll > 0.8 && roll < 0.9) {
        out.push({
          at: new Date(t + 30 * MINUTE),
          externalMessageId: `${id}-cx`,
          rawText: "Cancel this one, price ran away without us",
          payload: { channel: source.slug, message_id: `${id}-cx`, reply_to_message_id: id },
        });
      }
    }
    t += (source.slug === "bullion-flow" ? 5 : 6) * 60 * MINUTE + Math.floor(rnd() * 5 * 60) * MINUTE;
  }
  return out;
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

  console.log("Seeding configuration, users, sources and affiliates…");
  await seedConfig();
  await seedUsers();
  const srcs = await seedSources();
  await seedAffiliates();

  const now = new Date();
  const start = new Date(Math.floor((now.getTime() - HISTORY_DAYS * 86_400_000) / MINUTE) * MINUTE);
  console.log(`Syncing ${HISTORY_DAYS} days of mock XAU/USD minute bars…`);
  const t0 = Date.now();
  const { inserted } = await syncMarketData({ from: start, to: now });
  console.log(`  ${inserted} bars in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  const barRows = await db.select({ t: marketBars.timestamp, c: marketBars.close }).from(marketBars).where(eq(marketBars.instrument, "XAUUSD"));
  const bars = new Map(barRows.map((b) => [b.t.getTime(), { c: b.c }]));

  const messages = srcs
    .flatMap((s, i) => buildHistory(s, bars, start.getTime() + 86_400_000, now.getTime(), 1000 + i * 7).map((m) => ({ ...m, source: s })))
    .filter((m) => m.at.getTime() <= now.getTime())
    .sort((a, b) => a.at.getTime() - b.at.getTime());

  console.log(`Ingesting ${messages.length} source messages through the pipeline…`);
  const t1 = Date.now();
  const tally: Record<string, number> = {};
  for (const m of messages) {
    const res = await ingestRawEvent(m.source.id, { externalMessageId: m.externalMessageId, rawText: m.rawText, payload: m.payload, publishedAt: m.at });
    const key = res.status === "duplicate" ? "duplicate" : res.parse.status;
    tally[key] = (tally[key] ?? 0) + 1;
    await processJobs(50, ["RECALC_OUTCOME"]);
  }
  console.log(`  ${JSON.stringify(tally)} in ${((Date.now() - t1) / 1000).toFixed(1)}s`);

  console.log("Running stats and AI analysis jobs…");
  const t2 = Date.now();
  let n = 0;
  do {
    n = await processJobs(1000);
  } while (n > 0);
  console.log(`  done in ${((Date.now() - t2) / 1000).toFixed(1)}s`);
  await closeDb();
  console.log("Seed complete.");
}

main().catch(async (err) => {
  console.error(err);
  await closeDb();
  process.exit(1);
});
