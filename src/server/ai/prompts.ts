import { z } from "zod";
import { signalSetupOutputSchema, sourcePatternsOutputSchema, type AnalysisType } from "./types";

const GUARDRAILS = `You analyse gold (XAU/USD) trading signals for an information product.
Rules:
- Use ONLY the structured facts supplied in the user message. Never invent prices, statistics or events.
- Never give personalised advice, position sizing, risk advice or portfolio allocation.
- Never recommend taking or skipping a trade. Describe; do not advise.
- Never compute P&L; deterministic metrics are supplied when they exist.
- If a fact is missing, say it is unavailable.
- List every fact key you relied on in "factsReferenced".
Respond with JSON matching the provided schema.`;

export interface PromptDefinition {
  version: string;
  analysisType: AnalysisType;
  system: string;
  schema: z.ZodTypeAny;
  /** A filled answer sent in place of the JSON Schema, which Llama 3.1 8B tends to copy back. */
  example: string;
  /** Repairs known answer shapes before validation. Never fills in missing content. */
  coerce?: (raw: unknown) => unknown;
}

const SIGNAL_SETUP_KEYS = Object.keys(signalSetupOutputSchema.shape).filter((k) => k !== "setupClassification");

/**
 * Llama 3.1 8B sometimes closes setupClassification last, so every other field lands
 * inside it. This lifts those fields back to the top level and changes nothing else.
 */
export function coerceSignalSetup(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const obj = raw as Record<string, unknown>;
  const inner = obj.setupClassification;
  if (!inner || typeof inner !== "object" || Array.isArray(inner)) return raw;
  const nested = inner as Record<string, unknown>;
  const lifted = SIGNAL_SETUP_KEYS.filter((k) => !(k in obj) && k in nested);
  if (!lifted.length) return raw;
  const classification = Object.fromEntries(Object.entries(nested).filter(([k]) => !lifted.includes(k)));
  return { ...obj, ...Object.fromEntries(lifted.map((k) => [k, nested[k]])), setupClassification: classification };
}

const SIGNAL_SETUP_EXAMPLE = JSON.stringify({
  setupClassification: { label: "Short name for the setup type", confidence: 0.6, rationale: "One sentence on why, citing the facts." },
  summary: "The summary, written from the facts.",
  patternTags: ["pattern tag"],
  marketContextTags: ["market context tag"],
  similarPatternExplanation: "How comparable past trades from this source resolved, with the sample size, or that they are unavailable.",
  sourceStrengths: ["A strength shown by the source statistics."],
  sourceWeaknesses: ["A weakness shown by the source statistics."],
  factsReferenced: ["fact key you used"],
});

const SOURCE_PATTERNS_EXAMPLE = JSON.stringify({
  headline: "One sentence on this source's clearest pattern.",
  patterns: [{ title: "Short pattern name", detail: "What the statistics show.", sampleSize: 24 }],
  caveats: ["A limit on what the statistics can show."],
  factsReferenced: ["fact key you used"],
});

export const PROMPTS: Record<string, PromptDefinition> = {
  "signal-setup-v1": {
    version: "signal-setup-v1",
    analysisType: "signal_setup",
    system: `${GUARDRAILS}\nClassify the setup type, summarise context in at most three sentences, and tag patterns.`,
    schema: signalSetupOutputSchema,
    example: SIGNAL_SETUP_EXAMPLE,
    coerce: coerceSignalSetup,
  },
  "signal-setup-v2": {
    version: "signal-setup-v2",
    analysisType: "signal_setup",
    system: `${GUARDRAILS}\nClassify the setup type. Summarise in at most two sentences, lead with the reward-to-risk geometry, then market context, then how comparable historical trades from this source resolved (with sample size).`,
    schema: signalSetupOutputSchema,
    example: SIGNAL_SETUP_EXAMPLE,
    coerce: coerceSignalSetup,
  },
  "source-patterns-v1": {
    version: "source-patterns-v1",
    analysisType: "source_patterns",
    system: `${GUARDRAILS}\nIdentify up to four recurring patterns in this source's deterministic statistics. Every pattern must cite its sample size. Add caveats for small samples (n < 10).`,
    schema: sourcePatternsOutputSchema,
    example: SOURCE_PATTERNS_EXAMPLE,
  },
};

export const DEFAULT_PROMPT: Record<AnalysisType, string> = {
  signal_setup: process.env.AI_SIGNAL_PROMPT_VERSION ?? "signal-setup-v1",
  source_patterns: "source-patterns-v1",
};

export function promptsFor(type: AnalysisType) {
  return Object.values(PROMPTS).filter((p) => p.analysisType === type);
}
