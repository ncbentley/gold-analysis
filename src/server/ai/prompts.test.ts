import { describe, expect, it } from "vitest";
import { chatUserContent } from "./providers/openai";
import { coerceSignalSetup, PROMPTS } from "./prompts";
import { signalSetupOutputSchema } from "./types";

describe("analysis prompts", () => {
  it.each(Object.values(PROMPTS))("$version shows a filled example instead of the JSON Schema", (prompt) => {
    expect(prompt.schema.safeParse(JSON.parse(prompt.example)).success).toBe(true);
    const user = chatUserContent({
      analysisType: prompt.analysisType,
      promptVersion: prompt.version,
      system: prompt.system,
      facts: { closedTrades: 12 },
      jsonSchema: { type: "object", properties: {} },
      example: prompt.example,
    });
    expect(user).not.toMatch(/matching this schema/i);
    expect(user).toMatch(/do not return a json schema/i);
    expect(user).toContain(prompt.example);
  });

  it("lifts fields Llama nested inside setupClassification back to the top level", () => {
    const answer = JSON.parse(PROMPTS["signal-setup-v1"].example);
    const { setupClassification, ...rest } = answer;
    const nested = { setupClassification: { ...setupClassification, ...rest } };
    expect(signalSetupOutputSchema.safeParse(nested).success).toBe(false);
    const repaired = signalSetupOutputSchema.parse(coerceSignalSetup(nested));
    expect(repaired).toEqual(answer);
  });

  it("leaves a copied JSON Schema invalid", () => {
    const schema = { type: "object", properties: { setupClassification: { type: "object" }, summary: { type: "string" } } };
    expect(signalSetupOutputSchema.safeParse(coerceSignalSetup(schema)).success).toBe(false);
  });
});
