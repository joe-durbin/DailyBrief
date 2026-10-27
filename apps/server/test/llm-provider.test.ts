import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { createProvider } from "../src/llm/provider.ts";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("provider request text", () => {
  it("sends well-formed text when scraped content contains a lone surrogate", async () => {
    let sent: { messages: { role: string; content: string }[] } | undefined;
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body));
      const chunk = (delta: object, finish: string | null = null) => `data: ${JSON.stringify({ id: "1", object: "chat.completion.chunk", created: 0, model: "m", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
      const body =
        chunk({ tool_calls: [{ index: 0, id: "c1", type: "function", function: { name: "submit", arguments: '{"ok":true}' } }] }) +
        chunk({}, "tool_calls") +
        `data: ${JSON.stringify({ id: "1", object: "chat.completion.chunk", created: 0, model: "m", choices: [], usage: { prompt_tokens: 1, completion_tokens: 1 } })}\n\n` +
        "data: [DONE]\n\n";
      return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
    }) as typeof fetch;

    const provider = createProvider({ kind: "openai_compatible", baseUrl: "http://proxy.test/v1", apiKey: "" });
    const broken = "Ghost \udd2c report";
    await provider.structured({
      model: "m",
      system: "system",
      user: broken,
      tool: { name: "submit", description: "submit", schema: { type: "object", properties: {} } },
    });

    assert.equal(sent?.messages[1]?.content, broken.toWellFormed(), "the lone surrogate is replaced before the request leaves the server");
  });
});
