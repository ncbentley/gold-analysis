import { describe, expect, it } from "vitest";
import type { Signal, SignalOutcome, SignalTarget } from "@/server/db/schema";
import { presentSignalDetail, presentSourceStats } from "@/server/presenters";
import { computeSourceStatistics } from "@/server/statistics/compute";
import { ANONYMOUS, buildAccess, can, freeAccess, gate, historyCutoff, lowestTierWith, requireFeature, tierForSignalTime } from "./access";
import { DEFAULT_TIER_CONFIG, type TierConfig } from "./config";

const config = DEFAULT_TIER_CONFIG;
const silver = buildAccess("silver", config);
const gold = buildAccess("gold", config);

const now = new Date("2026-02-01T12:00:00Z");
const signal: Signal = {
  id: "sig1",
  sourceId: "src1",
  originEventId: "ev1",
  instrument: "XAUUSD",
  direction: "LONG",
  entryType: "ZONE",
  signalType: "pullback",
  entryMin: 3399,
  entryMax: 3400,
  stopLoss: 3395,
  status: "WON",
  signalTime: now,
  expiryTime: null,
  closedAt: now,
  sourceConfidenceText: null,
  parserConfidence: 1,
  version: 1,
  createdAt: now,
  updatedAt: now,
};
const targets: SignalTarget[] = [{ id: "t1", signalId: "sig1", targetIndex: 1, price: 3405, hitAt: now, status: "HIT" }];
const outcome: SignalOutcome = {
  id: "o1",
  signalId: "sig1",
  calcVersion: "outcome-v1",
  signalVersion: 1,
  kind: "computed",
  isCurrent: true,
  classification: "WON",
  entered: true,
  entryTime: now,
  entryPrice: 3400,
  exitTime: now,
  exitReason: "TARGETS",
  stopHitAt: null,
  rResult: 1,
  mfe: 5,
  mae: 2,
  mfeR: 1,
  maeR: 0.4,
  bestPrice: 3405,
  worstPrice: 3398,
  durationMinutes: 30,
  ambiguous: false,
  detailJson: { timeline: [{ t: 1, type: "ENTRY" }], targets: [{ index: 1, minutesFromEntry: 30, ambiguous: false }], risk: 5 },
  overrideReason: null,
  createdBy: "engine",
  computedAt: now,
};
const analysis = {
  id: "a1",
  signalId: "sig1",
  sourceId: null,
  analysisType: "signal_setup" as const,
  model: "mock",
  promptVersion: "signal-setup-v1",
  inputHash: "h",
  inputJson: {},
  outputJson: {
    setupClassification: { label: "SECRET_LABEL", confidence: 0.7, rationale: "r" },
    summary: "SECRET_SUMMARY",
    patternTags: ["SECRET_TAG"],
    marketContextTags: [],
    similarPatternExplanation: "",
    sourceStrengths: [],
    sourceWeaknesses: [],
    factsReferenced: [],
  },
  isCurrent: true,
  createdAt: now,
};
const stats = computeSourceStatistics([
  {
    signalId: "sig1",
    direction: "LONG",
    entryType: "ZONE",
    signalType: "pullback",
    signalTime: now,
    classification: "WON",
    entered: true,
    rResult: 1,
    mfe: 5,
    mae: 2,
    mfeR: 1,
    maeR: 0.4,
    durationMinutes: 30,
    targetMinutes: [30],
  },
]);

const detailFor = (access: ReturnType<typeof buildAccess>) =>
  presentSignalDetail(
    {
      signal,
      source: { id: "src1", name: "Src", nickname: "Amber Fox", slug: "src", isQa: false },
      targets,
      outcome,
      rawText: "XAUUSD BUY ZONE",
      updates: [],
      sourceStats: stats,
      similar: { dimensions: ["source"], matched: [{ signalId: "x", signalTime: now.toISOString(), direction: "LONG", classification: "WON", rResult: 1, mfeR: 1, maeR: 0.2, durationMinutes: 5 }], summary: { n: 1, wins: 1, losses: 0, winRate: 1, avgR: 1 } },
      analysis,
    },
    access,
    config,
  );

describe("access", () => {
  it("anonymous users have no features", () => {
    expect(ANONYMOUS.features.size).toBe(0);
    expect(() => requireFeature(ANONYMOUS, "signals.core")).toThrow();
  });

  it("tiers are cumulative by default", () => {
    for (const f of config.silver.features) expect(can(gold, f)).toBe(true);
    expect(can(silver, "sources.stats.summary")).toBe(true);
    expect(can(silver, "sources.stats.recent")).toBe(false);
    expect(can(gold, "ai.summary")).toBe(false);
  });

  it("admins get every feature", () => {
    const admin = buildAccess(null, config, true);
    expect(can(admin, "export.csv")).toBe(true);
  });

  it("gives an admin the gold tier label", () => {
    expect(buildAccess(null, config, true).tier).toBe("gold");
  });

  it("reports the lowest tier that unlocks a feature", () => {
    expect(lowestTierWith("signals.core", config)).toBe("silver");
    expect(lowestTierWith("similar.summary", config)).toBe("gold");
    expect(lowestTierWith("ai.patterns", config)).toBeNull();
    expect(lowestTierWith("consensus.grade", config)).toBeNull();
    expect(lowestTierWith("consensus.timing", config)).toBeNull();
    expect(lowestTierWith("consensus.mapping", config)).toBeNull();
    expect(lowestTierWith("export.csv", config)).toBeNull();
  });

  it("follows configuration rather than hard-coded tiers", () => {
    const custom: Record<"silver" | "gold", TierConfig> = {
      ...config,
      silver: { features: [...config.silver.features, "ai.summary"], historyDays: 7 },
    };
    const s = buildAccess("silver", custom);
    expect(can(s, "ai.summary")).toBe(true);
    expect(gate(s, "ai.summary", custom, () => 1)).toEqual({ locked: false, data: 1 });
    expect(historyCutoff(s, now)?.toISOString()).toBe("2026-01-25T12:00:00.000Z");
  });

  it("gold has unlimited history", () => {
    expect(historyCutoff(gold, now)).toBeNull();
  });

  it("names the cheapest plan whose history window covers the signal", () => {
    const eightDaysAgo = new Date(now.getTime() - 8 * 86_400_000);
    const twoHundredDaysAgo = new Date(now.getTime() - 200 * 86_400_000);
    expect(tierForSignalTime(eightDaysAgo, config, now)).toBe("silver");
    expect(tierForSignalTime(twoHundredDaysAgo, config, now)).toBe("gold");
  });

  it("gives a signed-in user with no subscription the raw feed for seven days", () => {
    const free = freeAccess();
    expect(free.tier).toBeNull();
    expect(can(free, "signals.core")).toBe(true);
    expect(can(free, "signals.basic_result")).toBe(true);
    expect(historyCutoff(free, now)?.toISOString()).toBe("2026-01-25T12:00:00.000Z");
  });

  it("keeps advanced filters, consensus, and AI off silver", () => {
    expect(can(silver, "filters.advanced")).toBe(false);
    expect(can(silver, "consensus.grade")).toBe(false);
    expect(can(silver, "ai.summary")).toBe(false);
  });
});

describe("signal detail projection", () => {
  it("silver receives the core signal and basic result but nothing from higher tiers", () => {
    const d = detailFor(silver);
    expect(d.entryMin).toBe(3399);
    expect(d.rawText.locked).toBe(true);
    expect(JSON.stringify(d)).not.toContain("XAUUSD BUY ZONE");
    expect(d.result.locked).toBe(false);
    expect(d.outcome.excursionSummary.locked).toBe(true);
    expect(d.similar.summary.locked).toBe(true);
    expect(d.ai.classification.locked).toBe(true);
    const json = JSON.stringify(d);
    for (const secret of ["SECRET_LABEL", "SECRET_SUMMARY", "SECRET_TAG", '"mfe"', '"bestPrice"', '"timeline"']) {
      expect(json).not.toContain(secret);
    }
    expect(d.sourceStats?.summary.locked).toBe(false);
    expect(d.consensus.grade.locked).toBe(true);
    expect(d.consensus.timing.locked).toBe(true);
    expect(d.consensus.mapping.locked).toBe(true);
    expect(json).not.toContain("Consensus Score");
  });

  it("gold gets full history features without AI", () => {
    const d = detailFor(gold);
    expect(d.ai.classification.locked).toBe(true);
    expect(d.ai.summary.locked).toBe(true);
    expect(d.outcome.excursionDetail).toMatchObject({ locked: false, data: { bestPrice: 3405 } });
    expect(d.outcome.timeToTarget).toMatchObject({ locked: false, data: [{ index: 1, minutesFromEntry: 30 }] });
    expect(d.similar.details.locked).toBe(false);
    expect(JSON.stringify(d)).not.toContain("SECRET_SUMMARY");
  });

  it("keeps original posts off member payloads, including gold", () => {
    const d = presentSignalDetail(
      { signal, source: { id: "s", name: "S", nickname: "Amber Fox", slug: "s", isQa: false }, targets, outcome, rawText: "PRIVATE", updates: [], sourceStats: null, similar: null, analysis: null },
      gold,
      config,
    );
    expect(JSON.stringify(d)).not.toContain("PRIVATE");
  });
});

describe("source stats projection", () => {
  it("exposes the summary to silver and locks the rest", () => {
    const s = presentSourceStats(stats, silver, config);
    expect(s.totalSignals).toBe(1);
    expect(s.summary.locked).toBe(false);
    expect(s.recent.locked && s.timeOfDay.locked && s.extended.locked).toBe(true);
  });
});
