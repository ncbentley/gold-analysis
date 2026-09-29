import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/server/db";
import { aiAnalyses } from "@/server/db/schema";
import { sha256, stableStringify } from "@/server/lib/hash";
import { buildSignalFacts, buildSourcePatternFacts } from "./facts";
import { DEFAULT_PROMPT, PROMPTS } from "./prompts";
import { chatProvider, resolveChatBackend } from "./backend";
import { mockAiProvider } from "./providers/mock";
import type { AiProvider, AnalysisType } from "./types";

export function getAiProvider(): AiProvider {
  const backend = resolveChatBackend();
  if (backend) return chatProvider(backend);
  return mockAiProvider;
}

async function runAnalysis(opts: {
  analysisType: AnalysisType;
  promptVersion?: string;
  signalId?: string;
  sourceId?: string;
  facts: Record<string, unknown>;
  force?: boolean;
}) {
  const db = await getDb();
  const prompt = PROMPTS[opts.promptVersion ?? DEFAULT_PROMPT[opts.analysisType]];
  if (!prompt || prompt.analysisType !== opts.analysisType) throw new Error(`Unknown prompt version for ${opts.analysisType}`);
  const provider = getAiProvider();
  const inputHash = sha256(stableStringify({ type: opts.analysisType, prompt: prompt.version, model: provider.model, facts: opts.facts }));

  const scope = opts.signalId ? eq(aiAnalyses.signalId, opts.signalId) : eq(aiAnalyses.sourceId, opts.sourceId!);
  const [current] = await db
    .select()
    .from(aiAnalyses)
    .where(and(scope, eq(aiAnalyses.analysisType, opts.analysisType), eq(aiAnalyses.isCurrent, true)))
    .limit(1);
  if (current && current.inputHash === inputHash && !opts.force) return { skipped: true, analysis: current };

  const raw = await provider.generate({
    analysisType: opts.analysisType,
    promptVersion: prompt.version,
    system: prompt.system,
    facts: opts.facts,
    jsonSchema: z.toJSONSchema(prompt.schema) as Record<string, unknown>,
  });
  const output = prompt.schema.parse(raw);

  const analysis = await db.transaction(async (tx) => {
    await tx
      .update(aiAnalyses)
      .set({ isCurrent: false })
      .where(and(scope, eq(aiAnalyses.analysisType, opts.analysisType), eq(aiAnalyses.isCurrent, true)));
    const [row] = await tx
      .insert(aiAnalyses)
      .values({
        signalId: opts.signalId ?? null,
        sourceId: opts.sourceId ?? null,
        analysisType: opts.analysisType,
        model: provider.model,
        promptVersion: prompt.version,
        inputHash,
        inputJson: opts.facts,
        outputJson: output as Record<string, unknown>,
      })
      .returning();
    return row;
  });
  return { skipped: false, analysis };
}

export async function analyzeSignal(signalId: string, opts: { promptVersion?: string; force?: boolean } = {}) {
  const facts = await buildSignalFacts(signalId);
  const db = await getDb();
  // Keep the prompt version an admin chose unless a different one is requested.
  const [current] = await db
    .select({ promptVersion: aiAnalyses.promptVersion })
    .from(aiAnalyses)
    .where(and(eq(aiAnalyses.signalId, signalId), eq(aiAnalyses.isCurrent, true)))
    .limit(1);
  return runAnalysis({
    analysisType: "signal_setup",
    promptVersion: opts.promptVersion ?? current?.promptVersion,
    signalId,
    facts: facts as unknown as Record<string, unknown>,
    force: opts.force,
  });
}

export async function analyzeSourcePatterns(sourceId: string, opts: { force?: boolean } = {}) {
  const facts = await buildSourcePatternFacts(sourceId);
  return runAnalysis({ analysisType: "source_patterns", sourceId, facts: facts as unknown as Record<string, unknown>, force: opts.force });
}

export async function getCurrentAnalysis(opts: { signalId?: string; sourceId?: string; analysisType: AnalysisType }) {
  const db = await getDb();
  const scope = opts.signalId ? eq(aiAnalyses.signalId, opts.signalId) : eq(aiAnalyses.sourceId, opts.sourceId!);
  const [row] = await db
    .select()
    .from(aiAnalyses)
    .where(and(scope, eq(aiAnalyses.analysisType, opts.analysisType), eq(aiAnalyses.isCurrent, true)))
    .limit(1);
  return row ?? null;
}

export async function listAnalysisHistory(signalId: string) {
  const db = await getDb();
  return db.select().from(aiAnalyses).where(eq(aiAnalyses.signalId, signalId)).orderBy(desc(aiAnalyses.createdAt));
}
