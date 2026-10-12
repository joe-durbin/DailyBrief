import Anthropic from "@anthropic-ai/sdk";
import type { ProviderCheck, ProviderKind } from "@dailybrief/shared";
import OpenAI from "openai";

type JsonSchema = Record<string, unknown>;

/** One structured-output call: the model must answer through the named tool. */
type StructuredRequest = {
  model: string;
  system: string;
  user: string;
  tool: { name: string; description: string; schema: JsonSchema };
  maxTokens?: number;
  signal?: AbortSignal;
  /** Called whenever data arrives (the call is streamed), so the caller can tell a slow answer from a stalled one. */
  onActivity?: () => void;
};

type StructuredResult = { output: unknown; usage: { inputTokens: number; outputTokens: number } };

type ChatTurn = { role: "user" | "assistant"; content: string };
export type ChatRequest = { model: string; system: string; messages: ChatTurn[]; maxTokens?: number; signal?: AbortSignal };
/** Streamed text deltas; `usage` resolves once the stream ends. */
type ChatStream = { deltas: AsyncIterable<string>; usage: Promise<{ inputTokens: number; outputTokens: number }> };

export interface LlmProvider {
  listModels(): Promise<string[]>;
  check(): Promise<ProviderCheck>;
  structured(req: StructuredRequest): Promise<StructuredResult>;
  chat(req: ChatRequest): ChatStream;
}

const CHECK_TIMEOUT_MS = 8_000;

type ProviderConfig = { kind: ProviderKind; baseUrl: string; apiKey: string };

/** Default endpoints for each provider type (custom providers may override). */
/**
 * One client per provider. Anthropic API keys speak the Messages API; every other kind (including a LiteLLM
 * proxy, as "OpenAI-compatible") speaks OpenAI Chat Completions at its base URL.
 */
export function createProvider({ kind, baseUrl, apiKey }: ProviderConfig): LlmProvider {
  const base = baseUrl.replace(/\/+$/, "");
  const anthropic = new Anthropic({ baseURL: base, apiKey, maxRetries: 2 });
  const openai = new OpenAI({ baseURL: base, apiKey: apiKey || "none", maxRetries: 2 });
  const isAnthropic = () => kind === "anthropic";

  async function fetchModelIds(signal?: AbortSignal): Promise<string[]> {
    const url = kind === "anthropic" ? `${base}/v1/models` : `${base}/models`;
    const headers: Record<string, string> =
      kind === "anthropic" ? { "x-api-key": apiKey, "anthropic-version": "2023-06-01" } : apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
    const res = await fetch(url, { headers, signal });
    if (!res.ok) throw new Error(`Provider returned HTTP ${res.status}`);
    const body: unknown = await res.json();
    const data = typeof body === "object" && body !== null && "data" in body && Array.isArray(body.data) ? body.data : [];
    return data.flatMap((m: unknown) => (typeof m === "object" && m !== null && "id" in m && typeof m.id === "string" ? [m.id] : [])).sort();
  }

  return {
    listModels: () => fetchModelIds(AbortSignal.timeout(CHECK_TIMEOUT_MS)),

    async check() {
      if (!apiKey && kind !== "openai_compatible") return { ok: false, models: 0, error: "No API key configured" };
      try {
        const ids = await fetchModelIds(AbortSignal.timeout(CHECK_TIMEOUT_MS));
        return { ok: ids.length > 0, models: ids.length, error: ids.length ? undefined : "No models listed" };
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        // A local proxy (e.g. LiteLLM on the host) that times out is usually a listen address or firewall issue.
        const reason = err.name === "TimeoutError" ? `Unreachable at ${base} (timed out — check the address and the host firewall)` : err.message;
        return { ok: false, models: 0, error: reason };
      }
    },

    // Streamed, so a long answer that is still arriving can be told apart from a stalled request.
    async structured(req) {
      if (isAnthropic()) {
        const stream = anthropic.messages.stream(
          {
            model: req.model,
            max_tokens: req.maxTokens ?? 4096,
            system: req.system,
            messages: [{ role: "user", content: req.user }],
            tools: [{ name: req.tool.name, description: req.tool.description, input_schema: { type: "object", ...req.tool.schema } }],
            tool_choice: { type: "tool", name: req.tool.name },
          },
          { signal: req.signal },
        );
        for await (const _event of stream) req.onActivity?.();
        const r = await stream.finalMessage();
        const block = r.content.find((b) => b.type === "tool_use");
        if (!block || block.type !== "tool_use") throw new Error(`Model did not call ${req.tool.name} (stop: ${r.stop_reason})`);
        return { output: block.input, usage: { inputTokens: r.usage.input_tokens, outputTokens: r.usage.output_tokens } };
      }
      const stream = await openai.chat.completions.create(
        {
          model: req.model,
          max_completion_tokens: req.maxTokens ?? 4096,
          messages: [
            { role: "system", content: req.system },
            { role: "user", content: req.user },
          ],
          tools: [{ type: "function", function: { name: req.tool.name, description: req.tool.description, parameters: req.tool.schema } }],
          tool_choice: { type: "function", function: { name: req.tool.name } },
          stream: true,
          stream_options: { include_usage: true },
        },
        { signal: req.signal },
      );
      let args = "";
      let called = false;
      let finish: string | null = null;
      const usage = { inputTokens: 0, outputTokens: 0 };
      for await (const chunk of stream) {
        req.onActivity?.();
        const choice = chunk.choices[0];
        const call = choice?.delta.tool_calls?.[0];
        if (call) {
          called = true;
          args += call.function?.arguments ?? "";
        }
        finish = choice?.finish_reason ?? finish;
        if (chunk.usage) Object.assign(usage, { inputTokens: chunk.usage.prompt_tokens, outputTokens: chunk.usage.completion_tokens });
      }
      if (called === false) throw new Error(`Model did not call ${req.tool.name} (finish: ${finish})`);
      return { output: JSON.parse(args), usage };
    },

    chat(req) {
      const usage = Promise.withResolvers<{ inputTokens: number; outputTokens: number }>();
      async function* anthropicDeltas() {
        const stream = anthropic.messages.stream({ model: req.model, max_tokens: req.maxTokens ?? 2_000, system: req.system, messages: req.messages }, { signal: req.signal });
        try {
          for await (const ev of stream) {
            if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") yield ev.delta.text;
          }
          const final = await stream.finalMessage();
          usage.resolve({ inputTokens: final.usage.input_tokens, outputTokens: final.usage.output_tokens });
        } catch (e) {
          usage.reject(e);
          throw e;
        }
      }
      async function* openaiDeltas() {
        try {
          const stream = await openai.chat.completions.create(
            {
              model: req.model,
              max_completion_tokens: req.maxTokens ?? 2_000,
              messages: [{ role: "system", content: req.system }, ...req.messages],
              stream: true,
              stream_options: { include_usage: true },
            },
            { signal: req.signal },
          );
          let tokens = { inputTokens: 0, outputTokens: 0 };
          for await (const chunk of stream) {
            const text = chunk.choices[0]?.delta.content;
            if (text) yield text;
            if (chunk.usage) tokens = { inputTokens: chunk.usage.prompt_tokens, outputTokens: chunk.usage.completion_tokens };
          }
          usage.resolve(tokens);
        } catch (e) {
          usage.reject(e);
          throw e;
        }
      }
      // Callers may abandon the stream; never leave an unhandled rejection behind.
      usage.promise.catch(() => {});
      return { deltas: isAnthropic() ? anthropicDeltas() : openaiDeltas(), usage: usage.promise };
    },
  };
}
