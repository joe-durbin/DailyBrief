import { modelChoiceSchema, roleChoicesSchema, type AiRole, type ModelChoice } from "@dailybrief/shared";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { SecretBox } from "../crypto.ts";
import type { Db } from "../db/index.ts";
import { llmCalls, modelPrices, providers, settings } from "../db/schema.ts";
import { AiError, AiTimeoutError, toAiError } from "./errors.ts";
import { createProvider, MalformedToolOutput, type ChatRequest, type LlmProvider } from "./provider.ts";

/**
 * AI calls are streamed and only stopped when they stall: no data for SILENCE_MS. A call that keeps producing is
 * allowed to finish (its tokens are paid for either way), up to MAX_CALL_MS — the guard against a model stuck in a
 * loop. Normal calls start streaming within seconds; the longest so far took about two minutes, all of it streaming.
 */
const SILENCE_MS = 3 * 60_000;
const MAX_CALL_MS = 10 * 60_000;

export type CallLimits = { silenceMs: number; maxCallMs: number };

type Role = AiRole;

export function providerFromRow(row: typeof providers.$inferSelect, box: SecretBox): LlmProvider {
  return createProvider({ kind: row.kind, baseUrl: row.baseUrl, apiKey: row.apiKeyEnc ? box.open(row.apiKeyEnc) : "" });
}

export function getProvider(db: Db, box: SecretBox, id: number): LlmProvider | null {
  const row = db.select().from(providers).where(eq(providers.id, id)).get();
  return row && row.enabled ? providerFromRow(row, box) : null;
}

const readSetting = (db: Db, key: string) => db.select({ value: settings.value }).from(settings).where(eq(settings.key, key)).get()?.value;

type SchemaNode = Record<string, unknown>;

/**
 * Coerce common local/open-weights LLM tool-call quirks to match the target JSON Schema before Zod validation:
 * - Objects inside string arrays (e.g. `queries: [{ query: "..." }]` -> `["..."]`)
 * - Bare arrays when a single-property wrapper object was expected
 * - String/prefixed IDs where integers are expected (e.g. `"R12"` -> `12`, `[{ id: 1 }]` -> `[1]`)
 * - Missing booleans / nullable fields (e.g. omitted `materiallyNew` -> `false`, `exclude: ""` / `"none"` -> `null`)
 * - Arrays exceeding `maxItems` (truncated instead of rejecting the whole call)
 */
export function normalizeToolOutput(val: unknown, schema: SchemaNode): unknown {
  if (!schema || typeof schema !== "object") return val;

  if (Array.isArray(schema.type)) {
    const types = schema.type as string[];
    const nullable = types.includes("null");
    const primary = types.find((t) => t !== "null");
    if (nullable) {
      if (val === null || val === undefined || val === false) return null;
      if (typeof val === "string" && /^(null|none|n\/a|nil|false|unknown|)$/i.test(val.trim())) return null;
    }
    if (primary) {
      return normalizeToolOutput(val, { ...schema, type: primary });
    }
  }

  if (Array.isArray(schema.anyOf)) {
    const branches = schema.anyOf as SchemaNode[];
    const nullable = branches.some((b) => b.type === "null");
    const nonNull = branches.find((b) => b.type !== "null");
    if (nullable) {
      if (val === null || val === undefined || val === false) return null;
      if (typeof val === "string" && /^(null|none|n\/a|nil|false|unknown|)$/i.test(val.trim())) return null;
    }
    if (nonNull) {
      const coerced = normalizeToolOutput(val, nonNull);
      if (nullable && nonNull.type === "string" && typeof nonNull.pattern === "string" && typeof coerced === "string") {
        const isoMatch = coerced.match(/^(\d{4}-\d{2}-\d{2})/);
        if (isoMatch) return isoMatch[1];
        if (!new RegExp(nonNull.pattern).test(coerced)) return null;
      }
      if (nullable && (nonNull.type === "integer" || nonNull.type === "number") && typeof coerced !== "number") {
        return null;
      }
      return coerced;
    }
  }

  const type = schema.type;
  if (type === "string" && typeof schema.pattern === "string" && typeof val === "string") {
    const isoMatch = val.match(/^(\d{4}-\d{2}-\d{2})/);
    if (isoMatch && new RegExp(schema.pattern).test(isoMatch[1]!)) return isoMatch[1];
  }

  if (type === "object" && schema.properties && typeof schema.properties === "object") {
    const props = schema.properties as Record<string, SchemaNode>;
    const keys = Object.keys(props);
    let obj = val;
    if (Array.isArray(obj) && keys.length === 1 && props[keys[0]!]?.type === "array") {
      obj = { [keys[0]!]: obj };
    } else if (typeof obj === "object" && obj !== null && !Array.isArray(obj)) {
      const rec = obj as Record<string, unknown>;
      if (keys.every((k) => !(k in rec))) {
        const inner = rec.parameters ?? rec.arguments ?? rec.input ?? rec.data;
        if (typeof inner === "object" && inner !== null) obj = inner;
      }
    }
    if (typeof obj !== "object" || obj === null || Array.isArray(obj)) return obj;
    const out: Record<string, unknown> = { ...(obj as Record<string, unknown>) };
    for (const [k, propSchema] of Object.entries(props)) {
      out[k] = normalizeToolOutput(out[k], propSchema);
    }
    return out;
  }

  if (type === "array") {
    let arr = val;
    if (typeof arr === "string") {
      try {
        const parsed = JSON.parse(arr);
        if (Array.isArray(parsed)) arr = parsed;
      } catch {
        // leave as-is
      }
    }
    if (!Array.isArray(arr)) return arr;
    const itemSchema = (schema.items as SchemaNode | undefined) ?? {};
    let mapped = arr.map((item) => normalizeToolOutput(item, itemSchema));
    if (typeof schema.maxItems === "number" && mapped.length > schema.maxItems) {
      mapped = mapped.slice(0, schema.maxItems);
    }
    return mapped;
  }

  if (type === "string") {
    if (typeof val === "object" && val !== null && !Array.isArray(val)) {
      const rec = val as Record<string, unknown>;
      for (const k of ["query", "text", "value", "name", "title", "summary", "headline", "instruction", "canonical"]) {
        if (typeof rec[k] === "string" && rec[k].trim()) return rec[k];
      }
      const firstStr = Object.values(rec).find((v): v is string => typeof v === "string" && v.trim().length > 0);
      if (firstStr !== undefined) return firstStr;
    }
    return val;
  }

  if (type === "integer" || type === "number") {
    let num = val;
    if (typeof num === "object" && num !== null && !Array.isArray(num)) {
      const rec = num as Record<string, unknown>;
      num = rec.id ?? rec.slot ?? rec.value ?? Object.values(rec)[0];
    }
    if (typeof num === "string") {
      const cleaned = num.trim().replace(/^[A-Za-z#_-]+/, "");
      if (/^-?\d+(\.\d+)?$/.test(cleaned)) num = Number(cleaned);
    }
    if (typeof num === "number" && Number.isFinite(num)) {
      if (type === "integer") num = Math.round(num);
      if (typeof schema.minimum === "number" && num < schema.minimum) num = schema.minimum;
      if (typeof schema.maximum === "number" && num > schema.maximum) num = schema.maximum;
    }
    return num;
  }

  if (type === "boolean") {
    if (val === undefined || val === null || val === 0 || val === "false" || val === "no") return false;
    if (val === 1 || val === "true" || val === "yes") return true;
    return val;
  }

  return val;
}

/** Role → provider/model: `ai.roles[role]` overrides `ai.default`. */
export function resolveRole(db: Db, role: Role): ModelChoice {
  const override = roleChoicesSchema.safeParse(readSetting(db, "ai.roles") ?? {}).data?.[role];
  if (override) return override;
  const def = modelChoiceSchema.safeParse(readSetting(db, "ai.default"));
  if (!def.success) throw new Error("No default AI model configured (Settings → AI)");
  return def.data;
}

type CallContext = { briefId?: number; articleId?: number; feedItemId?: number; signal?: AbortSignal };

export interface LlmRouter {
  /** Structured call for a role; the result is validated against `schema` and every attempt is recorded in llm_calls. */
  call<T>(role: Role, req: { system: string; user: string; toolName: string; toolDescription: string; schema: z.ZodType<T>; maxTokens?: number }, ctx?: CallContext): Promise<T>;
  /** Streamed free-text chat for a role; usage is recorded when the stream finishes (or fails). */
  chat(role: Role, req: Omit<ChatRequest, "model">, ctx?: CallContext): { deltas: AsyncIterable<string>; providerId: number; model: string };
}

export function createLlmRouter(db: Db, box: SecretBox, limits: CallLimits = { silenceMs: SILENCE_MS, maxCallMs: MAX_CALL_MS }): LlmRouter {
  /** USD for this call from the provider's price list, fixed at the time of the call; null if the model has no price. */
  const costOf = (choice: ModelChoice, usage?: { inputTokens: number; outputTokens: number }) => {
    if (!usage) return null;
    const price = db.select().from(modelPrices).where(eq(modelPrices.model, choice.model)).get();
    if (price?.input == null || price.output == null) return null;
    return (usage.inputTokens * price.input + usage.outputTokens * price.output) / 1_000_000;
  };
  const record = (role: Role, choice: ModelChoice, ctx: CallContext, started: number, ok: boolean, usage?: { inputTokens: number; outputTokens: number }, error?: string) =>
    db.insert(llmCalls)
      .values({
        role,
        providerId: choice.providerId,
        model: choice.model,
        briefId: ctx.briefId,
        articleId: ctx.articleId,
        feedItemId: ctx.feedItemId,
        tokensIn: usage?.inputTokens ?? 0,
        tokensOut: usage?.outputTokens ?? 0,
        costUsd: costOf(choice, usage),
        durationMs: Date.now() - started,
        ok,
        error: error?.slice(0, 500),
      })
      .run();

  /** Provider plus how to name it in error messages ("LiteLLM said: …"). */
  const open = (choice: ModelChoice) => {
    const row = db.select().from(providers).where(eq(providers.id, choice.providerId)).get();
    if (!row?.enabled) throw new Error(`AI provider ${choice.providerId} is missing or disabled (Settings → AI)`);
    return { provider: providerFromRow(row, box), source: `${row.name} (${choice.model})` };
  };
  const minutes = (ms: number) => (ms >= 60_000 ? `${ms / 60_000} minute${ms === 60_000 ? "" : "s"}` : `${ms / 1000} seconds`);
  /**
   * Limits for one call: aborts after `silenceMs` without data (`activity()` resets that clock) or `maxCallMs` in
   * total. `timeout` says which limit fired, if any; the caller's own cancellation is not a timeout.
   */
  const watch = (source: string, callerSignal?: AbortSignal) => {
    const controller = new AbortController();
    let timeout: AiTimeoutError | null = null;
    const stop = (message: string) => {
      timeout = new AiTimeoutError(message, source);
      controller.abort(timeout);
    };
    let silence = setTimeout(() => stop(`No response for ${minutes(limits.silenceMs)}`), limits.silenceMs);
    const cap = setTimeout(() => stop(`Still running after ${minutes(limits.maxCallMs)}; stopped to avoid runaway costs`), limits.maxCallMs);
    return {
      signal: callerSignal ? AbortSignal.any([callerSignal, controller.signal]) : controller.signal,
      activity() {
        clearTimeout(silence);
        silence = setTimeout(() => stop(`No response for ${minutes(limits.silenceMs)}`), limits.silenceMs);
      },
      done() {
        clearTimeout(silence);
        clearTimeout(cap);
      },
      /** The caller's own cancellation passes through as is; our limits become a timeout; anything else is the provider's failure, explained. */
      fail: (e: unknown): unknown =>
        timeout ??
        (callerSignal?.aborted
          ? e
          : e instanceof MalformedToolOutput
            ? Object.assign(new AiError(null, e.message, source, { cause: e }), { invalidOutput: true })
            : toAiError(e, source)),
    };
  };

  return {
    async call(role, req, ctx = {}) {
      const { $schema: _drop, ...jsonSchema } = z.toJSONSchema(req.schema, { target: "draft-7" });
      const choice = resolveRole(db, role);
      const { provider, source } = open(choice);
      const started = Date.now();
      const limit = watch(source, ctx.signal);
      const res = await provider
        .structured({
          model: choice.model,
          system: req.system,
          user: req.user,
          tool: { name: req.toolName, description: req.toolDescription, schema: jsonSchema },
          maxTokens: req.maxTokens,
          signal: limit.signal,
          onActivity: limit.activity,
        })
        .catch((e: unknown) => {
          const err = limit.fail(e);
          record(role, choice, ctx, started, false, e instanceof MalformedToolOutput ? e.usage : undefined, err instanceof Error ? err.message : String(err));
          throw err;
        })
        .finally(limit.done);
      const normalized = normalizeToolOutput(res.output, jsonSchema);
      const parsed = req.schema.safeParse(normalized);
      if (!parsed.success) {
        const msg = `Invalid ${req.toolName} output: ${z.prettifyError(parsed.error).slice(0, 500)}`;
        record(role, choice, ctx, started, false, res.usage, msg);
        throw Object.assign(new AiError(null, msg, source), { invalidOutput: true });
      }
      record(role, choice, ctx, started, true, res.usage);
      return parsed.data;
    },

    chat(role, req, ctx = {}) {
      const choice = resolveRole(db, role);
      const { provider, source } = open(choice);
      const started = Date.now();
      const limit = watch(source, req.signal);
      const stream = provider.chat({ ...req, model: choice.model, signal: limit.signal });
      stream.usage.then(
        (u) => record(role, choice, ctx, started, true, u),
        (e: unknown) => {
          const err = limit.fail(e);
          record(role, choice, ctx, started, false, undefined, err instanceof Error ? err.message : String(err));
        },
      );
      async function* deltas() {
        try {
          for await (const text of stream.deltas) {
            limit.activity();
            yield text;
          }
        } catch (e) {
          throw limit.fail(e);
        } finally {
          limit.done();
        }
      }
      return { deltas: deltas(), providerId: choice.providerId, model: choice.model };
    },
  };
}
