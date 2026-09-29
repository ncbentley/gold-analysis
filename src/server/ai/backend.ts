import { createOpenAiProvider } from "./providers/openai";
import type { AiProvider } from "./types";

/** Cheap instruction model on DeepInfra. About two cents per million tokens. */
export const DEEPINFRA_DEFAULT_MODEL = "meta-llama/Meta-Llama-3.1-8B-Instruct";
/** Same key, larger model. Used when the 8B review does not decide. */
export const DEEPINFRA_LARGE_REVIEW_MODEL = "meta-llama/Meta-Llama-3.1-70B-Instruct";
export const CLOUDFLARE_DEFAULT_MODEL = "@cf/meta/llama-3.1-8b-instruct";
export const OPENAI_DEFAULT_MODEL = "gpt-4o-mini";

export interface ChatBackend {
  name: "deepinfra" | "cloudflare" | "openai";
  apiKey: string;
  model: string;
  baseUrl: string;
  /** OpenAI's own API accepts json_schema. The other clouds accept json_object. */
  responseFormat: "json_schema" | "json_object";
}

function deepinfra(): ChatBackend | null {
  const apiKey = process.env.DEEPINFRA_API_KEY;
  if (!apiKey) return null;
  return {
    name: "deepinfra",
    apiKey,
    model: process.env.AI_MODEL || DEEPINFRA_DEFAULT_MODEL,
    baseUrl: process.env.DEEPINFRA_BASE_URL || "https://api.deepinfra.com/v1/openai",
    responseFormat: "json_object",
  };
}

function cloudflare(): ChatBackend | null {
  const apiKey = process.env.CLOUDFLARE_API_TOKEN;
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!apiKey || !accountId) return null;
  return {
    name: "cloudflare",
    apiKey,
    model: process.env.AI_MODEL || CLOUDFLARE_DEFAULT_MODEL,
    baseUrl: `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1`,
    responseFormat: "json_object",
  };
}

function openai(): ChatBackend | null {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  return {
    name: "openai",
    apiKey,
    model: process.env.AI_MODEL || OPENAI_DEFAULT_MODEL,
    baseUrl: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
    responseFormat: "json_schema",
  };
}

/**
 * The live chat backend. DeepInfra is the cheap inference cloud. Cloudflare Workers AI
 * and OpenAI are the other paid options. `AI_PROVIDER=mock` (or no key) returns null,
 * and the review queue stays with a person.
 */
export function resolveChatBackend(): ChatBackend | null {
  const chosen = process.env.AI_PROVIDER;
  if (chosen === "mock") return null;
  if (chosen === "deepinfra") return deepinfra();
  if (chosen === "cloudflare") return cloudflare();
  if (chosen === "openai") return openai();
  return deepinfra() ?? cloudflare() ?? openai();
}

export function chatProvider(backend: ChatBackend): AiProvider {
  return createOpenAiProvider(backend.apiKey, backend.model, backend.baseUrl, backend.responseFormat);
}
