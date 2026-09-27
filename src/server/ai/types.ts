import { z } from "zod";

export const signalSetupOutputSchema = z.object({
  setupClassification: z.object({
    label: z.string(),
    confidence: z.number().min(0).max(1),
    rationale: z.string(),
  }),
  summary: z.string(),
  patternTags: z.array(z.string()),
  marketContextTags: z.array(z.string()),
  similarPatternExplanation: z.string(),
  sourceStrengths: z.array(z.string()),
  sourceWeaknesses: z.array(z.string()),
  factsReferenced: z.array(z.string()),
});
export type SignalSetupOutput = z.infer<typeof signalSetupOutputSchema>;

export const sourcePatternsOutputSchema = z.object({
  headline: z.string(),
  patterns: z.array(z.object({ title: z.string(), detail: z.string(), sampleSize: z.number() })),
  caveats: z.array(z.string()),
  factsReferenced: z.array(z.string()),
});
export type SourcePatternsOutput = z.infer<typeof sourcePatternsOutputSchema>;

export type AnalysisType = "signal_setup" | "source_patterns";

export interface AiRequest {
  analysisType: AnalysisType;
  promptVersion: string;
  system: string;
  facts: Record<string, unknown>;
  jsonSchema: Record<string, unknown>;
}

export interface AiProvider {
  model: string;
  generate(req: AiRequest): Promise<unknown>;
}
