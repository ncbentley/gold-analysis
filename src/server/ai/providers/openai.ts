import type { AiProvider, AiRequest } from "../types";

/** OpenAI-compatible chat completions with strict JSON schema output. Server-side only. */
export function createOpenAiProvider(apiKey: string, model: string, baseUrl = "https://api.openai.com/v1"): AiProvider {
  return {
    model,
    async generate(req: AiRequest) {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          messages: [
            { role: "system", content: req.system },
            { role: "user", content: `Structured facts (JSON):\n${JSON.stringify(req.facts)}` },
          ],
          response_format: {
            type: "json_schema",
            json_schema: { name: req.analysisType, schema: req.jsonSchema, strict: false },
          },
        }),
      });
      if (!res.ok) throw new Error(`AI provider HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const body = (await res.json()) as { choices: { message: { content: string } }[] };
      return JSON.parse(body.choices[0].message.content);
    },
  };
}
