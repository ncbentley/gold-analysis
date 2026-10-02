/**
 * End-to-end pipeline test on an in-memory Postgres (PGlite):
 * ingestion -> parsing -> normalization -> market replay -> stats -> AI -> entitlement-filtered reads.
 */
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb, closeDb } from "@/server/db";
import { runMigrations } from "@/server/db/migrate";
import { auditLogs, jobs, marketBars, parseResults, rawEvents, signalOutcomes, signals, signalTargets, sources, tierEntitlements, TIERS } from "@/server/db/schema";
import { buildAccess } from "@/server/entitlements/access";
import { DEFAULT_TIER_CONFIG } from "@/server/entitlements/config";
import type { Viewer } from "@/server/entitlements/service";
import { ingestRawEvent } from "@/server/ingestion";
import { processJobs } from "@/server/jobs/runner";
import { syncMarketData } from "@/server/market-data";
import { correctSignal } from "@/server/normalization";
import { overrideOutcome } from "@/server/outcomes/service";
import { getSignalDetailForViewer, getSourceBySlugOrId, listSignalsForViewer, listSources } from "@/server/signals/queries";

// Unlimited history so the fixed-date fixture stays visible; the default windows are tested separately.
const config = Object.fromEntries(TIERS.map((t) => [t, { ...DEFAULT_TIER_CONFIG[t], historyDays: null }])) as typeof DEFAULT_TIER_CONFIG;
const viewer = (tier: "silver" | "gold" | "platinum", cfg = config): Viewer => ({
  user: null,
  access: buildAccess(tier, cfg),
  config: cfg,
  subscription: null,
  viewAs: null,
});
const adminViewer = (): Viewer => ({ user: null, access: buildAccess(null, config, true), config, subscription: null, viewAs: null });
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
  const listed = await listSignalsForViewer(viewer("gold"), {});
  expect(listed.items.map((item) => item.id)).toContain(signalId);
  const [aiJob] = await db
    .select({ status: jobs.status })
    .from(jobs)
    .where(and(eq(jobs.type, "AI_ANALYZE_SIGNAL"), eq(jobs.status, "queued")));
  expect(aiJob?.status).toBe("queued");
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
    const res = await ingestRawEvent(sourceId, { externalMessageId: "m2", rawText: "Gold buy 3400 sl 3404 tp 3410", publishedAt: new Date(T.getTime() + 3_600_000) });
    expect(res.status).toBe("stored");
    if (res.status !== "stored") return;
    const [pr] = await db.select().from(parseResults).where(eq(parseResults.rawEventId, res.rawEventId));
    expect(pr.status).toBe("needs_review");
    expect(await db.select().from(signals).where(eq(signals.originEventId, res.rawEventId))).toHaveLength(0);
  });

  it("computes a deterministic outcome from stored bars", async () => {
    const db = await getDb();
    const [o] = await db.select().from(signalOutcomes).where(eq(signalOutcomes.signalId, signalId));
    expect(o.calcVersion).toBe("outcome-v3");
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
    expect(silver.detail.consensus.grade.locked).toBe(true);
    expect(JSON.stringify(silver.detail)).not.toContain("setupClassification");
    expect(JSON.stringify(silver.detail.consensus)).not.toContain("Consensus Score");
    expect(platinum.detail.ai.classification.locked).toBe(true);
    expect(platinum.detail.ai.summary.locked).toBe(true);
    expect(platinum.detail.ai.meta?.promptVersion).toBe("signal-setup-v1");
    expect(platinum.detail.consensus.grade.locked).toBe(true);
    expect(platinum.detail.consensus.mapping.locked).toBe(true);
    expect(JSON.stringify(platinum.detail.consensus)).not.toContain("Consensus Score");
    expect(JSON.stringify(platinum.detail)).not.toContain("Test Desk");
  });

  it("locks signals older than the tier's history window", async () => {
    const res = await getSignalDetailForViewer(signalId, viewer("silver", DEFAULT_TIER_CONFIG));
    expect(res).toMatchObject({ kind: "history_locked", requiredTier: "platinum" });
    const list = await listSignalsForViewer(viewer("gold", DEFAULT_TIER_CONFIG), {});
    expect(list.items.map((item) => item.id)).toContain(signalId);
  });

  it("ignores advanced filters for tiers without them", async () => {
    const res = await listSignalsForViewer(viewer("silver"), { entryType: "ZONE", q: "BUY" });
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

  it("sends edited signal posts to review instead of applying them", async () => {
    const db = await getDb();
    const [bar] = await db.select().from(marketBars).where(eq(marketBars.timestamp, new Date(T.getTime() + 2 * 3_600_000 - 60_000)));
    const p = bar.close;
    const res = await ingestRawEvent(sourceId, {
      externalMessageId: "m1@edit-1",
      rawText: `XAUUSD BUY NOW @ ${p.toFixed(2)}\nSL: ${(p - 5).toFixed(2)}\nTP1: ${(p + 8).toFixed(2)}`,
      payload: { message_id: "m1", edit_of: "m1" },
      publishedAt: new Date(T.getTime() + 2 * 3_600_000),
    });
    expect(res.status).toBe("stored");
    if (res.status !== "stored") return;
    const [pr] = await db.select().from(parseResults).where(eq(parseResults.rawEventId, res.rawEventId));
    expect(pr.status).toBe("needs_review");
    expect(JSON.stringify(pr.issues)).toContain("edited message m1");
    expect(await db.select().from(signals).where(eq(signals.originEventId, res.rawEventId))).toHaveLength(0);
  });

  it("keeps QA channels visible to admins only", async () => {
    const db = await getDb();
    const [qa] = await db.insert(sources).values({ name: "QA", slug: "qa-channel", sourceType: "telegram", telegramChannelId: "999", parserType: "text-generic", isQa: true }).returning();
    const [bar] = await db.select().from(marketBars).where(eq(marketBars.timestamp, new Date(T.getTime() + 3 * 3_600_000 - 60_000)));
    const p = bar.close;
    await ingestRawEvent(qa.id, {
      externalMessageId: "1",
      rawText: `XAUUSD SELL NOW @ ${p.toFixed(2)}\nSL: ${(p + 6).toFixed(2)}\nTP1: ${(p - 6).toFixed(2)}`,
      publishedAt: new Date(T.getTime() + 3 * 3_600_000),
    });
    await drain();
    const [qaSignal] = await db.select().from(signals).where(eq(signals.sourceId, qa.id));
    expect(qaSignal).toBeDefined();

    expect((await getSignalDetailForViewer(qaSignal.id, viewer("platinum"))).kind).toBe("not_found");
    expect((await getSignalDetailForViewer(qaSignal.id, adminViewer())).kind).toBe("ok");
    const member = await listSignalsForViewer(viewer("platinum"), {});
    expect(member.items.map((i) => i.id)).not.toContain(qaSignal.id);
    expect(member.total).toBe(member.items.length);
    const adminList = await listSignalsForViewer(adminViewer(), {});
    expect(adminList.items.map((i) => i.id)).toContain(qaSignal.id);

    expect((await listSources()).map((s) => s.id)).not.toContain(qa.id);
    expect((await listSources({ includeQa: true })).map((s) => s.id)).toContain(qa.id);
    expect(await getSourceBySlugOrId("qa-channel")).toBeNull();
    expect(await getSourceBySlugOrId("qa-channel", { includeQa: true })).not.toBeNull();
  });

  it("records a bare entry and attaches a later stop and targets", async () => {
    const db = await getDb();
    const when = new Date(T.getTime() + 5 * 3_600_000);
    const [bar] = await db.select().from(marketBars).where(eq(marketBars.timestamp, new Date(when.getTime() - 60_000)));
    const p = bar.close;
    const quoted = Number(p.toFixed(2));
    const bare = await ingestRawEvent(sourceId, {
      externalMessageId: "bare-1",
      rawText: `GOLD BUY ${quoted.toFixed(2)}`,
      publishedAt: when,
    });
    expect(bare.status).toBe("stored");
    if (bare.status !== "stored") return;
    const [created] = await db.select().from(signals).where(eq(signals.originEventId, bare.rawEventId));
    expect(created).toMatchObject({ direction: "LONG", entryMin: quoted, stopLoss: null });
    expect(await db.select().from(signalTargets).where(eq(signalTargets.signalId, created.id))).toHaveLength(0);
    const [bareParse] = await db.select().from(parseResults).where(eq(parseResults.rawEventId, bare.rawEventId));
    expect(bareParse.status).toBe("applied");
    expect(bareParse.issues.join(" ")).not.toMatch(/Stop loss is missing|No targets stated/);

    const follow = await ingestRawEvent(sourceId, {
      externalMessageId: "bare-2",
      rawText: `SL ${(p - 6).toFixed(2)}\nTP1 ${(p + 8).toFixed(2)}\nTP2 OPEN`,
      publishedAt: new Date(when.getTime() + 60_000),
    });
    expect(follow.status).toBe("stored");
    if (follow.status !== "stored") return;
    const [updated] = await db.select().from(signals).where(eq(signals.id, created.id));
    expect(updated.stopLoss).toBe(Number((p - 6).toFixed(2)));
    const targets = await db.select().from(signalTargets).where(eq(signalTargets.signalId, created.id));
    const ordered = [...targets].sort((a, b) => a.targetIndex - b.targetIndex);
    expect(ordered.map((target) => target.price)).toEqual([Number((p + 8).toFixed(2)), null]);
    const [followParse] = await db.select().from(parseResults).where(eq(parseResults.rawEventId, follow.rawEventId));
    expect(followParse.status).toBe("applied");
    expect(followParse.signalId).toBe(created.id);
    expect(await db.select().from(signals).where(eq(signals.originEventId, follow.rawEventId))).toHaveLength(0);
  });
});
