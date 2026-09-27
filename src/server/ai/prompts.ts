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
}

export const PROMPTS: Record<string, PromptDefinition> = {
  "signal-setup-v1": {
    version: "signal-setup-v1",
    analysisType: "signal_setup",
    system: `${GUARDRAILS}\nClassify the setup type, summarise context in at most three sentences, and tag patterns.`,
    schema: signalSetupOutputSchema,
  },
  "signal-setup-v2": {
    version: "signal-setup-v2",
    analysisType: "signal_setup",
    system: `${GUARDRAILS}\nClassify the setup type. Summarise in at most two sentences, lead with the reward-to-risk geometry, then market context, then how comparable historical trades from this source resolved (with sample size).`,
    schema: signalSetupOutputSchema,
  },
  "source-patterns-v1": {
    version: "source-patterns-v1",
    analysisType: "source_patterns",
    system: `${GUARDRAILS}\nIdentify up to four recurring patterns in this source's deterministic statistics. Every pattern must cite its sample size. Add caveats for small samples (n < 10).`,
    schema: sourcePatternsOutputSchema,
  },
};

export const DEFAULT_PROMPT: Record<AnalysisType, string> = {
  signal_setup: process.env.AI_SIGNAL_PROMPT_VERSION ?? "signal-setup-v1",
  source_patterns: "source-patterns-v1",
};

export function promptsFor(type: AnalysisType) {
  return Object.values(PROMPTS).filter((p) => p.analysisType === type);
}
