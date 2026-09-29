import type { AiProvider, AiRequest, SignalSetupOutput, SourcePatternsOutput } from "../types";
import type { SignalFacts, SourcePatternFacts } from "../facts";

/**
 * Deterministic stand-in for an LLM. It only rephrases the supplied facts,
 * which mirrors the contract a real model must follow.
 */
const pct = (x: number | null | undefined) => (x === null || x === undefined ? "n/a" : `${Math.round(x * 100)}%`);
const r = (x: number | null | undefined) => (x === null || x === undefined ? "n/a" : `${x >= 0 ? "+" : ""}${x.toFixed(2)}R`);

function classify(f: SignalFacts) {
  const dir = f.signal.direction === "LONG" ? 1 : -1;
  const t60 = (f.marketContext.change60m ?? 0) * dir;
  const t240 = (f.marketContext.change240m ?? 0) * dir;
  const range = f.marketContext.range240m ?? 0;
  const quiet = range > 0 && Math.abs(f.marketContext.change240m ?? 0) < range * 0.25;

  if (quiet && f.signal.entryType !== "MARKET") return { label: "Range fade", confidence: 0.62, why: "Price was rotating inside a contained 4-hour range and the entry rests at a range edge." };
  if (quiet) return { label: "Range breakout attempt", confidence: 0.55, why: "Market entry while price was contained inside its 4-hour range." };
  if (t240 > 0 && t60 < 0) return { label: "Pullback in trend", confidence: 0.71, why: "The 4-hour move favours the trade direction while the last hour retraced against it." };
  if (t240 > 0 && t60 >= 0) return { label: "Momentum continuation", confidence: 0.68, why: "Both the 1-hour and 4-hour moves already favour the trade direction." };
  if (t240 < 0 && t60 > 0) return { label: "Early reversal", confidence: 0.58, why: "The last hour turned in the trade direction against the prior 4-hour move." };
  return { label: "Counter-trend fade", confidence: 0.6, why: "The trade opposes both the 1-hour and 4-hour moves." };
}

function signalSetup(f: SignalFacts, version: string): SignalSetupOutput {
  const c = classify(f);
  const dirWord = f.signal.direction === "LONG" ? "long" : "short";
  const entry =
    f.signal.entryMin === f.signal.entryMax ? f.signal.entryMin.toFixed(2) : `${f.signal.entryMin.toFixed(2)}–${f.signal.entryMax.toFixed(2)}`;
  const geometry =
    f.geometry.riskUsd !== null
      ? `Risk to the stop is $${f.geometry.riskUsd.toFixed(2)}; the first target sits at ${f.geometry.rewardRiskTp1?.toFixed(2) ?? "n/a"}R and the last at ${f.geometry.rewardRiskLast?.toFixed(2) ?? "n/a"}R.`
      : "No stop was published, so reward-to-risk is unavailable.";
  const context = `Over the prior hour price moved ${(f.marketContext.change60m ?? 0).toFixed(2)} and over four hours ${(f.marketContext.change240m ?? 0).toFixed(2)}.`;
  const history =
    f.sourceHistory.closedTrades > 0
      ? `${f.signal.sourceName} has ${f.sourceHistory.closedTrades} closed trades on record (win rate ${pct(f.sourceHistory.winRate)}, average ${r(f.sourceHistory.avgR)}).`
      : `${f.signal.sourceName} has no closed trades on record yet.`;
  const similar =
    f.similar.n > 0
      ? `${f.similar.n} earlier trades matched on ${f.similar.dimensions.join(", ")}; ${pct(f.similar.winRate)} won with an average of ${r(f.similar.avgR)}.`
      : "No earlier closed trades matched this setup.";
  const outcome = f.outcome
    ? ` The trade has closed as ${f.outcome.classification.toLowerCase()} (${r(f.outcome.rResult)}).`
    : "";

  const summary =
    version === "signal-setup-v2"
      ? `${geometry} ${context} ${similar}${outcome}`
      : `${f.signal.sourceName} published a ${dirWord} ${f.signal.entryType.toLowerCase()} entry at ${entry} during the ${f.signal.session} session. ${context} ${history}${outcome}`;

  const tags = [
    c.label.toLowerCase().replace(/\s+/g, "-"),
    `${f.signal.session.toLowerCase().replace(/\s+/g, "-")}-session`,
    f.signal.entryType.toLowerCase(),
  ];
  if (f.signal.targets.length > 1) tags.push("multi-target");
  if (f.geometry.riskUsd !== null && f.marketContext.avgBarRange60m && f.geometry.riskUsd < f.marketContext.avgBarRange60m * 8) tags.push("tight-stop");
  if (f.signal.signalType) tags.push(f.signal.signalType);

  const ctx: string[] = [];
  const ch240 = f.marketContext.change240m ?? 0;
  ctx.push(ch240 > 3 ? "4h-up" : ch240 < -3 ? "4h-down" : "4h-flat");
  const vr = f.marketContext.volatilityRatio;
  if (vr !== null) ctx.push(vr > 1.25 ? "elevated-volatility" : vr < 0.8 ? "quiet-volatility" : "normal-volatility");

  const strengths: string[] = [];
  const weaknesses: string[] = [];
  const sess = f.sourceHistory.sameSession;
  if (sess && sess.n >= 5) {
    (sess.avgR !== null && sess.avgR > 0 ? strengths : weaknesses).push(
      `${f.signal.session} session: ${r(sess.avgR)} average across ${sess.n} closed trades.`,
    );
  }
  const d = f.sourceHistory.sameDirection;
  if (d && d.n >= 5) {
    (d.avgR !== null && d.avgR > 0 ? strengths : weaknesses).push(`${dirWord} trades: ${pct(d.winRate)} win rate across ${d.n} closed trades.`);
  }

  return {
    setupClassification: { label: c.label, confidence: c.confidence, rationale: c.why },
    summary,
    patternTags: tags,
    marketContextTags: ctx,
    similarPatternExplanation: similar,
    sourceStrengths: strengths,
    sourceWeaknesses: weaknesses,
    factsReferenced: [
      "signal.direction",
      "signal.entryType",
      "signal.session",
      "geometry.riskUsd",
      "geometry.rewardRiskTp1",
      "marketContext.change60m",
      "marketContext.change240m",
      "marketContext.volatilityRatio",
      "sourceHistory.closedTrades",
      "sourceHistory.winRate",
      "similar.n",
      ...(f.outcome ? ["outcome.classification", "outcome.rResult"] : []),
    ],
  };
}

function sourcePatterns(f: SourcePatternFacts): SourcePatternsOutput {
  const patterns: SourcePatternsOutput["patterns"] = [];
  const sessions = Object.entries(f.bySession).filter(([, b]) => b.n > 0 && b.avgR !== null);
  sessions.sort((a, b) => (b[1].avgR ?? 0) - (a[1].avgR ?? 0));
  if (sessions.length >= 2) {
    const [bestName, best] = sessions[0];
    const [worstName, worst] = sessions[sessions.length - 1];
    patterns.push({
      title: `Strongest in the ${bestName} session`,
      detail: `${bestName} trades averaged ${r(best.avgR)} versus ${r(worst.avgR)} in the ${worstName} session.`,
      sampleSize: best.n + worst.n,
    });
  }
  const long = f.byDirection.LONG;
  const short = f.byDirection.SHORT;
  if (long?.n && short?.n) {
    const better = (long.avgR ?? 0) >= (short.avgR ?? 0) ? "Long" : "Short";
    patterns.push({
      title: `${better} signals resolve better`,
      detail: `Longs: ${pct(long.winRate)} win rate, ${r(long.avgR)} (n=${long.n}). Shorts: ${pct(short.winRate)}, ${r(short.avgR)} (n=${short.n}).`,
      sampleSize: long.n + short.n,
    });
  }
  if (f.recent30.n >= 5 && f.avgR !== null && f.recent30.avgR !== null) {
    const trend = f.recent30.avgR > f.avgR ? "above" : "below";
    patterns.push({
      title: `Recent form is ${trend} the long-run average`,
      detail: `Last ${f.recent30.n} closed trades averaged ${r(f.recent30.avgR)} against a lifetime ${r(f.avgR)}.`,
      sampleSize: f.recent30.n,
    });
  }
  if (f.avgMaeR !== null && f.avgMfeR !== null) {
    patterns.push({
      title: "Typical excursion profile",
      detail: `After entry, trades moved on average ${f.avgMfeR.toFixed(2)}R in favour and ${f.avgMaeR.toFixed(2)}R against before exit.`,
      sampleSize: f.closedTrades,
    });
  }
  const caveats = [];
  if (f.closedTrades < 30) caveats.push(`Only ${f.closedTrades} closed trades are on record; patterns may not persist.`);
  caveats.push("Historical results do not guarantee future performance.");
  return {
    headline: `${f.sourceName}: ${f.closedTrades} closed trades, ${pct(f.winRate)} win rate, expectancy ${r(f.expectancy)} per trade.`,
    patterns,
    caveats,
    factsReferenced: ["closedTrades", "winRate", "expectancy", "bySession", "byDirection", "recent30", "avgMfeR", "avgMaeR"],
  };
}

export const mockAiProvider: AiProvider = {
  model: "mock-analyst-1",
  async generate(req: AiRequest) {
    if (req.analysisType === "queue_review") {
      return {
        decision: "unknown",
        confidence: 0,
        reason: "No model is configured.",
        entryType: null,
        direction: null,
        entryMin: null,
        entryMax: null,
        stopLoss: null,
        targets: [],
      };
    }
    if (req.analysisType === "parse_review") {
      return {
        decision: "reject",
        reason: "No model is configured.",
        entryType: null,
        direction: null,
        entryMin: null,
        entryMax: null,
        stopLoss: null,
        targets: [],
      };
    }
    if (req.analysisType === "signal_setup") return signalSetup(req.facts as unknown as SignalFacts, req.promptVersion);
    return sourcePatterns(req.facts as unknown as SourcePatternFacts);
  },
};
