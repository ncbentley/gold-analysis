import { describe, expect, it } from "vitest";
import { buildAccess, type Access } from "@/server/entitlements/access";
import { DEFAULT_TIER_CONFIG, type Feature } from "@/server/entitlements/config";
import { accessForPreview } from "@/server/entitlements/view-as";
import { presentSignalDetail } from "@/server/presenters";
import {
  computeConsensus,
  isHistoricallyAccurate,
  memberConsensus,
  sameZone,
  ZONE_BAND_USD,
  type ConsensusSignal,
  type SourcePerformance,
} from "./rules";

const t0 = new Date("2026-09-28T12:00:00Z");

function withFeatures(access: Access, extra: Feature[]): Access {
  return { ...access, features: new Set([...access.features, ...extra]) };
}

function signal(
  id: string,
  sourceId: string,
  direction: "LONG" | "SHORT",
  entryMin: number,
  entryMax: number,
  signalTime: Date,
  status = "ACTIVE",
): ConsensusSignal {
  return { id, sourceId, instrument: "XAUUSD", direction, entryMin, entryMax, signalTime, status };
}

function at(minutes: number) {
  return new Date(t0.getTime() + minutes * 60_000);
}

function accurate(sourceId: string, expectancy = 0.45): SourcePerformance {
  return { sourceId, ratedTrades: 24, winRate: 0.67, expectancy };
}

function unproven(sourceId: string): SourcePerformance {
  return { sourceId, ratedTrades: 2, winRate: 0.5, expectancy: 0.1 };
}

describe("same zone", () => {
  it("matches overlapping stored entry intervals", () => {
    expect(sameZone({ entryMin: 3371, entryMax: 3374 }, { entryMin: 3373, entryMax: 3376 })).toBe(true);
  });

  it("matches point entries inside the tight band and rejects a wider gap", () => {
    expect(ZONE_BAND_USD).toBe(2);
    expect(sameZone({ entryMin: 2650, entryMax: 2650 }, { entryMin: 2652, entryMax: 2652 })).toBe(true);
    expect(sameZone({ entryMin: 2650, entryMax: 2650 }, { entryMin: 2652.01, entryMax: 2652.01 })).toBe(false);
  });
});

describe("consensus score", () => {
  it("raises the score when historically accurate sources agree inside 30 minutes", () => {
    const focal = signal("focal", "src-0", "LONG", 2650, 2652, t0);
    const peers = Array.from({ length: 7 }, (_, i) =>
      signal(`peer-${i}`, `src-${i + 1}`, "LONG", 2651, 2651, at(i + 1)),
    );
    const performances = [
      ...Array.from({ length: 8 }, (_, i) => accurate(`src-${i}`, 0.8 - i * 0.01)),
      accurate("bench-a", 0.2),
      accurate("bench-b", 0.15),
    ];
    const alone = computeConsensus(focal, [focal], performances);
    const cluster = computeConsensus(focal, [focal, ...peers], performances);

    expect(cluster.grade.score).toBeGreaterThan(alone.grade.score);
    expect(cluster.grade.score).toBeGreaterThanOrEqual(85);
    expect(cluster.grade.grade).toBe("A");
    expect(cluster.grade.label).toBe(`Consensus Score: ${cluster.grade.score}/100 - Grade A`);
    expect(cluster.grade.risk).toBe("low");
    expect(cluster.timing.alignedSources).toBe(8);
    expect(cluster.timing.clusterSpanMinutes).toBeLessThanOrEqual(30);
    expect(cluster.mapping.sentence).toBe(
      "8 of our top 10 historical performers are currently aligned on this exact entry zone.",
    );
  });

  it("counts two sources on the same entry and direction as agreement", () => {
    const focal = signal("earlier", "src-a", "LONG", 4180, 4180, t0);
    const other = signal("later", "src-b", "LONG", 4180, 4180, at(6));
    const alone = computeConsensus(focal, [focal], [unproven("src-a")]);
    const pair = computeConsensus(focal, [focal, other], [unproven("src-a"), unproven("src-b")]);
    expect(pair.timing.alignedSources).toBe(2);
    expect(pair.grade.score).toBe(alone.grade.score + 2);
  });

  it("does not count a second signal from the same source as another vote", () => {
    const focal = signal("earlier", "src-a", "LONG", 4180, 4180, t0);
    const again = signal("later", "src-a", "LONG", 4180, 4180, at(6));
    const pair = computeConsensus(focal, [focal, again], [unproven("src-a")]);
    expect(pair.timing.alignedSources).toBe(1);
    expect(pair.participants).toHaveLength(1);
  });

  it("ignores a same-direction signal outside the window or off the zone", () => {
    const focal = signal("focal", "src-0", "LONG", 2650, 2650, t0);
    const late = signal("late", "src-late", "LONG", 2650, 2650, at(31));
    const far = signal("far", "src-far", "LONG", 2660, 2660, at(5));
    const performances = [accurate("src-0"), accurate("src-late"), accurate("src-far")];
    const result = computeConsensus(focal, [focal, late, far], performances);
    expect(result.timing.alignedSources).toBe(1);
    expect(result.grade.score).toBe(computeConsensus(focal, [focal], performances).grade.score);
  });

  it("raises risk when historically accurate sources take the other side of the zone", () => {
    const focal = signal("focal", "buyer", "LONG", 4315, 4320, t0);
    const shorts = Array.from({ length: 3 }, (_, i) => signal(`short-${i}`, `short-src-${i}`, "SHORT", 4316, 4318, at(2 + i)));
    const performances = [unproven("buyer"), ...shorts.map((row) => accurate(row.sourceId))];
    const alone = computeConsensus(focal, [focal], performances);
    const conflict = computeConsensus(focal, [focal, ...shorts], performances);

    expect(conflict.grade.risk).toBe("high");
    expect(conflict.grade.riskNote).toMatch(/historically accurate sources/i);
    expect(conflict.grade.score).toBeLessThan(alone.grade.score);
    expect(conflict.grade.grade).not.toBe("A");
    expect(conflict.timing.opposedSources).toBe(3);
    expect(conflict.mapping.oppositionSentence).toMatch(/positioned the other way/);
  });

  it("does not treat a short sample as historically accurate", () => {
    expect(isHistoricallyAccurate(unproven("src"))).toBe(false);
    expect(isHistoricallyAccurate({ sourceId: "src", ratedTrades: 20, winRate: 0.7, expectancy: -0.2 })).toBe(false);
    expect(isHistoricallyAccurate(accurate("src"))).toBe(true);
  });
});

describe("tier visibility", () => {
  const focal = signal("focal", "src-secret", "LONG", 2650, 2652, t0);
  const peers = Array.from({ length: 6 }, (_, i) => signal(`peer-${i}`, `src-${i}`, "LONG", 2650, 2652, at(i + 1)));
  const performances = [
    accurate("src-secret", 0.5),
    ...peers.map((row, i) => accurate(row.sourceId, 0.9 - i * 0.01)),
    accurate("bench-1", 0.3),
    accurate("bench-2", 0.25),
    accurate("bench-3", 0.2),
  ];
  const consensus = memberConsensus(computeConsensus(focal, [focal, ...peers], performances));
  const secretName = "Chartsyco Trades";

  const detailFor = (access: ReturnType<typeof buildAccess>) =>
    presentSignalDetail(
      {
        signal: {
          id: "focal",
          sourceId: "src-secret",
          originEventId: "ev",
          instrument: "XAUUSD",
          direction: "LONG",
          entryType: "ZONE",
          signalType: null,
          entryMin: 2650,
          entryMax: 2652,
          stopLoss: 2640,
          status: "ACTIVE",
          signalTime: t0,
          expiryTime: null,
          closedAt: null,
          sourceConfidenceText: null,
          parserConfidence: 1,
          version: 1,
          createdAt: t0,
          updatedAt: t0,
        },
        source: { id: "src-secret", name: secretName, nickname: "Amber Fox", slug: "chartsycotrades", isQa: false, telegramUsername: "chartsyco" },
        targets: [],
        outcome: null,
        rawText: null,
        updates: [],
        sourceStats: null,
        similar: null,
        analysis: null,
        consensus,
      },
      access,
      DEFAULT_TIER_CONFIG,
    );

  it("shows silver the trade parameters only", () => {
    const access = accessForPreview(DEFAULT_TIER_CONFIG, "silver");
    const detail = detailFor(access);
    expect(detail.direction).toBe("LONG");
    expect(detail.entryMin).toBe(2650);
    expect(detail.entryMax).toBe(2652);
    expect(detail.stopLoss).toBe(2640);
    expect(detail.consensus.grade.locked).toBe(true);
    expect(detail.consensus.timing.locked).toBe(true);
    expect(detail.consensus.mapping.locked).toBe(true);
    const json = JSON.stringify(detail.consensus);
    expect(json).not.toContain("Consensus Score");
    expect(json).not.toContain("historical performers");
    expect(json).not.toContain("offsetsMinutes");
    expect(json).not.toContain(secretName);
    expect(json).not.toContain("chartsyco");
    expect(json).not.toMatch(/Source #\d/);
  });

  it("shows the score and timing breakdown without the performer mapping or channel names", () => {
    const access = withFeatures(accessForPreview(DEFAULT_TIER_CONFIG, "gold"), ["consensus.grade", "consensus.timing"]);
    const detail = detailFor(access);
    expect(detail.consensus.grade.locked).toBe(false);
    expect(detail.consensus.timing.locked).toBe(false);
    expect(detail.consensus.mapping.locked).toBe(true);
    if (detail.consensus.grade.locked || detail.consensus.timing.locked) return;
    expect(detail.consensus.grade.data?.label).toMatch(/^Consensus Score: \d+\/100 - Grade [A-F]$/);
    expect(detail.consensus.timing.data?.offsetsMinutes.length).toBeGreaterThan(1);
    expect(detail.consensus.timing.data?.windowMinutes).toBe(30);
    const json = JSON.stringify(detail.consensus);
    expect(json).not.toContain("historical performers");
    expect(json).not.toContain(secretName);
    expect(json).not.toContain("chartsycotrades");
    expect(json).not.toContain("src-secret");
    expect(json).not.toMatch(/Source #\d/);
  });

  it("shows gold the anonymized performer mapping and still hides channel identity", () => {
    const access = withFeatures(accessForPreview(DEFAULT_TIER_CONFIG, "gold"), ["consensus.grade", "consensus.mapping"]);
    const detail = detailFor(access);
    expect(detail.consensus.mapping.locked).toBe(false);
    if (detail.consensus.mapping.locked || detail.consensus.grade.locked) return;
    expect(detail.consensus.mapping.data?.sentence).toBe(
      "7 of our top 10 historical performers are currently aligned on this exact entry zone.",
    );
    const json = JSON.stringify(detail.consensus);
    const page = JSON.stringify(detail);
    expect(json).not.toContain(secretName);
    expect(json).not.toContain("chartsycotrades");
    expect(json).not.toContain("chartsyco");
    expect(json).not.toContain("src-secret");
    expect(page).not.toContain(secretName);
    expect(page).not.toContain("chartsycotrades");
    expect(page).not.toContain("@chartsyco");
    expect(json).not.toMatch(/Source #\d/);
    expect(page).not.toMatch(/Source #\d/);
  });
});
