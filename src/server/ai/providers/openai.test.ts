import { afterEach, describe, expect, it } from "vitest";
import { createOpenAiProvider } from "./openai";

const request = {
  analysisType: "signal_setup" as const,
  promptVersion: "test",
  system: "Return JSON.",
  facts: { n: 1 },
  jsonSchema: {},
};

describe("chat completion timeout", () => {
  const previous = process.env.AI_REQUEST_TIMEOUT_MS;
  const fetchImpl = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = fetchImpl;
    if (previous === undefined) delete process.env.AI_REQUEST_TIMEOUT_MS;
    else process.env.AI_REQUEST_TIMEOUT_MS = previous;
  });

  it("releases a hung completion instead of holding the request slot", async () => {
    process.env.AI_REQUEST_TIMEOUT_MS = "30";
    globalThis.fetch = ((_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      })) as typeof fetch;

    const provider = createOpenAiProvider("test-key", "test-model", "https://example.test/v1", "json_object");
    await expect(provider.generate(request)).rejects.toThrow("AI provider timed out after 30ms");
  });
});
