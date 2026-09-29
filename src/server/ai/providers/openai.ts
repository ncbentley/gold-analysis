import type { AiProvider, AiRequest } from "../types";

function responseFormat(req: AiRequest, format: "json_schema" | "json_object") {
  if (format === "json_object") return { type: "json_object" };
  return { type: "json_schema", json_schema: { name: req.analysisType, schema: req.jsonSchema, strict: false } };
}

function parseContent(content: string) {
  const trimmed = content.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  return JSON.parse(fenced ? fenced[1] : trimmed);
}

/** OpenAI-compatible chat completions. Server-side only. The request body is not logged. */
export function createOpenAiProvider(
  apiKey: string,
  model: string,
  baseUrl = "https://api.openai.com/v1",
  format: "json_schema" | "json_object" = "json_schema",
): AiProvider {
  return {
    model,
    async generate(req: AiRequest) {
      const res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          messages: [
            { role: "system", content: req.system },
            {
              role: "user",
              content: `Structured facts (JSON):\n${JSON.stringify(req.facts)}\n\nRespond with one JSON object matching this schema:\n${JSON.stringify(req.jsonSchema)}`,
            },
          ],
          response_format: responseFormat(req, format),
        }),
      });
      if (!res.ok) throw new Error(`AI provider HTTP ${res.status}`);
      const body = (await res.json()) as { choices: { message: { content: string } }[] };
      return parseContent(body.choices[0].message.content);
    },
  };
}
