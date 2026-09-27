/**
 * End-to-end pipeline test on an in-memory Postgres (PGlite):
 * ingestion -> parsing -> normalization -> market replay -> stats -> AI -> entitlement-filtered reads.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb, closeDb } from "@/server/db";
import { runMigrations } from "@/server/db/migrate";
import { auditLogs, marketBars, parseResults, rawEvents, signalOutcomes, signals, sources, tierEntitlements, TIERS } from "@/server/db/schema";
import { buildAccess } from "@/server/entitlements/access";
import { DEFAULT_TIER_CONFIG } from "@/server/entitlements/config";
import type { Viewer } from "@/server/entitlements/service";
import { ingestRawEvent } from "@/server/ingestion";
import { processJobs } from "@/server/jobs/runner";
import { syncMarketData } from "@/server/market-data";
import { correctSignal } from "@/server/normalization";
import { overrideOutcome } from "@/server/outcomes/service";
import { getSignalDetailForViewer, listSignalsForViewer } from "@/server/signals/queries";

// Unlimited history so the fixed-date fixture stays visible; the default windows are tested separately.
const config = Object.fromEntries(TIERS.map((t) => [t, { ...DEFAULT_TIER_CONFIG[t], historyDays: null }])) as typeof DEFAULT_TIER_CONFIG;
const viewer = (tier: "silver" | "gold" | "platinum", cfg = config): Viewer => ({
  user: null,
  access: buildAccess(tier, cfg),
  config: cfg,
  subscription: null,
});
const admin = { userId: null, label: "test-admin" };

// A Tuesday in the mock data range; the market is open.
const T = new Date(Date.UTC(2026, 1, 3, 9, 0));
let sourceId = "";
let signalId = "";

async function drain() {
  while ((await processJobs(500)) > 0) {
    /* keep draining */
  }
}

beforeAll(async () => {
  await runMigrations();
  const db = await getDb();
  for (const tier of TIERS) {
    await db.insert(tierEntitlements).values({ tier, features: config[tier].features, historyDays: null });
  }
  const [s] = await db.insert(sources).values({ name: "Test Desk", slug: "test-desk", sourceType: "webhook", parserType: "text-generic" }).returning();
  sourceId = s.id;
  await syncMarketData({ from: new Date(T.getTime() - 86_400_000), to: new Date(T.getTime() + 2 * 86_400_000) });
  const [bar] = await db.select().from(marketBars).where(eq(marketBars.timestamp, new Date(T.getTime() - 60_000)));
  const p = bar.close;
  const res = await ingestRawEvent(sourceId, {
    externalMessageId: "m1",
    rawText: `XAUUSD BUY NOW @ ${p.toFixed(2)}\nSL: ${(p - 6).toFixed(2)}\nTP1: ${(p + 6).toFixed(2)}\nTP2: ${(p + 12).toFixed(2)}`,
    publishedAt: T,
  });
  expect(res.status).toBe("stored");
  const [sig] = await db.select().from(signals).where(eq(signals.sourceId, sourceId));
  signalId = sig.id;
  await drain();
}, 60_000);

afterAll(async () => {
  await closeDb();
});

describe("pipeline", () => {
  it("keeps the raw event and rejects duplicates", async () => {
    const db = await getDb();
    const dupById = await ingestRawEvent(sourceId, { externalMessageId: "m1", rawText: "anything", publishedAt: T });
    expect(dupById.status).toBe("duplicate");
    const events = await db.select().from(rawEvents).where(eq(rawEvents.sourceId, sourceId));
    expect(events).toHaveLength(1);
    expect(events[0].rawText).toMatch(/^XAUUSD BUY NOW/);
    const all = await db.select().from(signals).where(eq(signals.sourceId, sourceId));
    expect(all).toHaveLength(1);
  });

  it("sends low-confidence parses to manual review without creating a signal", async () => {
    const db = await getDb();
    const res = await ingestRawEvent(sourceId, { externalMessageId: "m2", rawText: "Gold buy 3400 tp 3410", publishedAt: new Date(T.getTime() + 3_600_000) });
    expect(res.status).toBe("stored");
    if (res.status !== "stored") return;
    const [pr] = await db.select().from(parseResults).where(eq(parseResults.rawEventId, res.rawEventId));
    expect(pr.status).toBe("needs_review");
    expect(await db.select().from(signals).where(eq(signals.originEventId, res.rawEventId))).toHaveLength(0);
  });

  it("computes a deterministic outcome from stored bars", async () => {
    const db = await getDb();
    const [o] = await db.select().from(signalOutcomes).where(eq(signalOutcomes.signalId, signalId));
    expect(o.calcVersion).toBe("outcome-v1");
    expect(o.entered).toBe(true);
    expect(o.mfe).not.toBeNull();
    expect(["WON", "LOST", "BREAKEVEN", "AMBIGUOUS", "OPEN"]).toContain(o.classification);
  });

  it("filters fields by tier through the read API", async () => {
    const silver = await getSignalDetailForViewer(signalId, viewer("silver"));
    const platinum = await getSignalDetailForViewer(signalId, viewer("platinum"));
    expect(silver.kind).toBe("ok");
    expect(platinum.kind).toBe("ok");
    if (silver.kind !== "ok" || platinum.kind !== "ok") return;
    expect(silver.detail.ai.summary.locked).toBe(true);
    expect(JSON.stringify(silver.detail)).not.toContain("setupClassification");
    expect(platinum.detail.ai.classification.locked).toBe(false);
    expect(platinum.detail.ai.meta?.promptVersion).toBe("signal-setup-v1");
  });

  it("locks signals older than the tier's history window", async () => {
    const res = await getSignalDetailForViewer(signalId, viewer("silver", DEFAULT_TIER_CONFIG));
    expect(res).toMatchObject({ kind: "history_locked", requiredTier: "platinum" });
    const list = await listSignalsForViewer(viewer("gold", DEFAULT_TIER_CONFIG), {});
    expect(list.items).toHaveLength(0);
  });

  it("ignores advanced filters for tiers without them", async () => {
    const res = await listSignalsForViewer(viewer("gold"), { entryType: "ZONE", q: "BUY" });
    expect(res.ignoredFilters.sort()).toEqual(["entryType", "q"]);
    expect(res.items.length).toBe(1);
    const plat = await listSignalsForViewer(viewer("platinum"), { entryType: "ZONE" });
    expect(plat.items.length).toBe(0);
  });

  it("corrects a signal without losing history and audits the change", async () => {
    const db = await getDb();
    const [before] = await db.select().from(signals).where(eq(signals.id, signalId));
    await correctSignal(signalId, { stopLoss: before.stopLoss! - 1 }, admin, "Source posted a corrected stop");
    await drain();
    const [after] = await db.select().from(signals).where(eq(signals.id, signalId));
    expect(after.version).toBe(before.version + 1);
    const audit = await db.select().from(auditLogs).where(eq(auditLogs.entityId, signalId));
    const corr = audit.find((a) => a.action === "signal.corrected");
    expect((corr?.beforeJson as { stopLoss: number }).stopLoss).toBe(before.stopLoss);
    const outcomes = await db.select().from(signalOutcomes).where(eq(signalOutcomes.signalId, signalId));
    expect(outcomes.length).toBeGreaterThanOrEqual(2);
    expect(outcomes.filter((o) => o.isCurrent)).toHaveLength(1);
  });

  it("records manual overrides with an audit trail and keeps them through recalculation", async () => {
    const db = await getDb();
    await overrideOutcome(signalId, { classification: "BREAKEVEN", rResult: 0, exitTime: null }, admin, "Broker feed outage");
    await drain();
    const current = (await db.select().from(signalOutcomes).where(eq(signalOutcomes.signalId, signalId))).filter((o) => o.isCurrent);
    expect(current).toHaveLength(1);
    expect(current[0].kind).toBe("override");
    const audit = await db.select().from(auditLogs).where(eq(auditLogs.action, "outcome.override"));
    expect(audit[0].reason).toBe("Broker feed outage");
  });
});
