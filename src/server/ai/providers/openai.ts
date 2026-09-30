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

/**
 * Queue review used to paste the JSON Schema into the user message. Llama 3.1 8B
 * copied that schema back, which failed validation and looked like "unknown".
 * Signal and source analysis do the same with a filled example. Parse review
 * still receives the schema.
 */
export function chatUserContent(req: AiRequest) {
  const facts = `Structured facts (JSON):\n${JSON.stringify(req.facts)}`;
  if (req.analysisType === "queue_review") {
    return `${facts}\n\nAnswer the post in message. Return one JSON object with the same keys as the filled examples in the system message. Do not return a JSON Schema, a type/properties wrapper, or markdown.`;
  }
  if (req.example) {
    return `${facts}\n\nReturn one JSON object with exactly the keys of this example. Replace every example value with your own analysis of the facts above:\n${req.example}\n\nDo not return a JSON Schema, a type/properties wrapper, or markdown.`;
  }
  return `${facts}\n\nRespond with one JSON object matching this schema:\n${JSON.stringify(req.jsonSchema)}`;
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
              content: chatUserContent(req),
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
