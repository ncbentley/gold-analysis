import { afterEach, describe, expect, it } from "vitest";
import { CLOUDFLARE_DEFAULT_MODEL, DEEPINFRA_DEFAULT_MODEL, OPENAI_DEFAULT_MODEL, resolveChatBackend } from "./backend";

const KEYS = ["AI_PROVIDER", "AI_MODEL", "DEEPINFRA_API_KEY", "DEEPINFRA_BASE_URL", "CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID", "OPENAI_API_KEY", "OPENAI_BASE_URL"] as const;
const previous = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of KEYS) {
    if (previous[key] === undefined) delete process.env[key];
    else process.env[key] = previous[key];
  }
});

describe("live chat backend", () => {
  it("prefers DeepInfra when its key is set and no provider is forced", () => {
    delete process.env.AI_PROVIDER;
    process.env.DEEPINFRA_API_KEY = "di-test";
    process.env.OPENAI_API_KEY = "sk-test";
    const backend = resolveChatBackend();
    expect(backend?.name).toBe("deepinfra");
    expect(backend?.model).toBe(DEEPINFRA_DEFAULT_MODEL);
    expect(backend?.baseUrl).toBe("https://api.deepinfra.com/v1/openai");
    expect(backend?.responseFormat).toBe("json_object");
  });

  it("uses Cloudflare Workers AI or OpenAI when that provider is selected", () => {
    process.env.AI_PROVIDER = "cloudflare";
    process.env.CLOUDFLARE_API_TOKEN = "cf-test";
    process.env.CLOUDFLARE_ACCOUNT_ID = "account";
    expect(resolveChatBackend()).toMatchObject({
      name: "cloudflare",
      model: CLOUDFLARE_DEFAULT_MODEL,
      baseUrl: "https://api.cloudflare.com/client/v4/accounts/account/ai/v1",
    });

    process.env.AI_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "sk-test";
    expect(resolveChatBackend()).toMatchObject({ name: "openai", model: OPENAI_DEFAULT_MODEL, responseFormat: "json_schema" });
  });

  it("stays offline when the provider is mock or no key is set", () => {
    delete process.env.AI_PROVIDER;
    delete process.env.DEEPINFRA_API_KEY;
    delete process.env.CLOUDFLARE_API_TOKEN;
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
    delete process.env.OPENAI_API_KEY;
    expect(resolveChatBackend()).toBeNull();
    process.env.AI_PROVIDER = "mock";
    process.env.DEEPINFRA_API_KEY = "di-test";
    expect(resolveChatBackend()).toBeNull();
  });
});