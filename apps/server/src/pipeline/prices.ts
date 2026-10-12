import type { ModelPriceRow } from "@dailybrief/shared";
import { eq, inArray } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";
import { z } from "zod";
import type { SecretBox } from "../crypto.ts";
import type { Db } from "../db/index.ts";
import { modelPrices, providers } from "../db/schema.ts";
import { providerFromRow } from "../llm/router.ts";

/** LiteLLM's maintained catalogue of ~4,500 models (USD per token). */
const CATALOGUE_URL = "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";
/** OpenRouter's public model list (USD per token, as strings). */
const OPENROUTER_URL = "https://openrouter.ai/api/v1/models";
const TIMEOUT_MS = 30_000;
const PER_MILLION = 1_000_000;

type Price = { input: number; output: number };
type Found = Price & { source: "catalogue" | "openrouter" | "provider" };

const catalogueSchema = z.record(z.string(), z.unknown());
const catalogueEntry = z.object({ input_cost_per_token: z.number(), output_cost_per_token: z.number() });
const openRouterSchema = z.object({ data: z.array(z.object({ id: z.string(), pricing: z.object({ prompt: z.string(), completion: z.string() }).partial().optional() })) });
const litellmInfoSchema = z.object({
  data: z.array(z.object({ model_name: z.string(), litellm_params: z.object({ model: z.string() }).partial().optional(), model_info: z.object({ input_cost_per_token: z.number().nullish(), output_cost_per_token: z.number().nullish() }).partial().nullish() })),
});

/** A real price: both sides known and not $0 (a $0 "price" means a subscription route or unknown, not free). */
const real = (input: number | null | undefined, output: number | null | undefined): Price | null =>
  input && output && input > 0 && output > 0 ? { input: round(input * PER_MILLION), output: round(output * PER_MILLION) } : null;
const round = (n: number) => Math.round(n * 1e6) / 1e6;

/** Names to try for a model: as given, without a routing prefix ("chatgpt/gpt-6-sol"), without a date suffix ("-20251001"). */
function candidates(name: string): string[] {
  const out = new Set<string>();
  for (const n of [name, name.slice(name.lastIndexOf("/") + 1)]) {
    out.add(n);
    out.add(n.replace(/-\d{8}$/, ""));
  }
  return [...out].filter(Boolean);
}
/** OpenRouter writes versions with dots ("claude-opus-5.5"); LiteLLM with dashes. Compare on a dot-free form. */
const loose = (name: string) => name.slice(name.lastIndexOf("/") + 1).toLowerCase().replace(/\./g, "-").replace(/-\d{8}$/, "");

async function getJson(url: string, headers: Record<string, string> = {}): Promise<unknown> {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${url} returned HTTP ${res.status}`);
  return res.json();
}

/**
 * Per enabled provider: its model names, plus (for a LiteLLM proxy) what each name routes to and any price it
 * reports. Unreachable providers contribute nothing (their existing rows are left alone).
 */
async function providerModels(db: Db, box: SecretBox, log: FastifyBaseLogger): Promise<Map<string, { routesTo?: string; price?: Price | null }>> {
  const models = new Map<string, { routesTo?: string; price?: Price | null }>();
  for (const row of db.select().from(providers).where(eq(providers.enabled, true)).all()) {
    try {
      for (const id of await providerFromRow(row, box).listModels()) models.set(id, models.get(id) ?? {});
    } catch (e) {
      log.warn({ provider: row.name, err: String(e) }, "price lookup: couldn't list models");
      continue;
    }
    if (row.kind !== "openai_compatible") continue;
    // LiteLLM exposes /model/info: the underlying model for each alias, and its own cost figures.
    try {
      const key = row.apiKeyEnc ? box.open(row.apiKeyEnc) : "";
      const info = litellmInfoSchema.parse(await getJson(`${row.baseUrl.replace(/\/+$/, "")}/model/info`, key ? { Authorization: `Bearer ${key}` } : {}));
      for (const m of info.data) {
        const entry = models.get(m.model_name);
        if (!entry) continue;
        entry.routesTo = m.litellm_params?.model;
        entry.price = real(m.model_info?.input_cost_per_token, m.model_info?.output_cost_per_token);
      }
    } catch {
      /* not a LiteLLM proxy */
    }
  }
  return models;
}

/**
 * Fill in prices for every model the providers offer: the provider's own figure, else LiteLLM's catalogue (by name,
 * by the model it routes to, without a date suffix), else OpenRouter. Unmatched models are recorded with no price
 * (shown as "—"); manual prices are never touched.
 */
export async function refreshPrices(deps: { db: Db; box: SecretBox; log: FastifyBaseLogger }): Promise<{ priced: number; missing: number }> {
  const { db, box, log } = deps;
  const models = await providerModels(db, box, log);
  if (!models.size) return { priced: 0, missing: 0 };

  const [catalogue, openrouter] = await Promise.all([
    getJson(CATALOGUE_URL)
      .then((j) => catalogueSchema.parse(j))
      .catch((e: unknown): Record<string, unknown> => (log.warn({ err: String(e) }, "price catalogue unavailable"), {})),
    getJson(OPENROUTER_URL).then((j) => openRouterSchema.parse(j).data).catch((e: unknown) => (log.warn({ err: String(e) }, "OpenRouter prices unavailable"), [])),
  ]);
  const fromCatalogue = (name: string) => {
    const e = catalogueEntry.safeParse(catalogue[name]);
    return e.success ? real(e.data.input_cost_per_token, e.data.output_cost_per_token) : null;
  };
  const openrouterByName = new Map<string, Price>();
  for (const m of openrouter) {
    if (m.id.includes(":")) continue; // ":batch", ":free" and other variants
    const p = real(Number(m.pricing?.prompt), Number(m.pricing?.completion));
    if (p && !openrouterByName.has(loose(m.id))) openrouterByName.set(loose(m.id), p);
  }

  const manual = new Set(db.select({ model: modelPrices.model }).from(modelPrices).where(eq(modelPrices.source, "manual")).all().map((r) => r.model));
  let priced = 0;
  let missing = 0;
  const now = new Date();
  for (const [model, info] of models) {
    if (manual.has(model)) continue;
    const names = [...candidates(model), ...(info.routesTo ? candidates(info.routesTo) : [])];
    let found: Found | null = info.price ? { ...info.price, source: "provider" } : null;
    for (const n of names) {
      if (found) break;
      const p = fromCatalogue(n);
      if (p) found = { ...p, source: "catalogue" };
    }
    for (const n of names) {
      if (found) break;
      const p = openrouterByName.get(loose(n));
      if (p) found = { ...p, source: "openrouter" };
    }
    const row = found ? { input: found.input, output: found.output, source: found.source } : { input: null, output: null, source: null };
    db.insert(modelPrices)
      .values({ model, ...row, checkedAt: now })
      .onConflictDoUpdate({ target: modelPrices.model, set: { ...row, checkedAt: now } })
      .run();
    if (found) priced++;
    else missing++;
  }
  log.info({ priced, missing }, "model prices refreshed");
  return { priced, missing };
}

/** Prices for the given models (models not looked up yet come back as unknown). */
export function pricesFor(db: Db, models: string[]): ModelPriceRow[] {
  const rows = models.length ? db.select().from(modelPrices).where(inArray(modelPrices.model, models)).all() : [];
  const byModel = new Map(rows.map((r) => [r.model, r]));
  return models.map((model) => {
    const r = byModel.get(model);
    return { model, input: r?.input ?? null, output: r?.output ?? null, source: r?.source ?? null, checkedAt: r?.checkedAt.getTime() ?? null };
  });
}

export interface PriceRefresher {
  /** Starts a lookup in the background unless one is running. */
  refresh(): void;
  readonly running: boolean;
}

export function createPriceRefresher(deps: { db: Db; box: SecretBox; log: FastifyBaseLogger }): PriceRefresher {
  let running = false;
  return {
    refresh() {
      if (running) return;
      running = true;
      void refreshPrices(deps)
        .catch((e: unknown) => deps.log.warn({ err: String(e) }, "price lookup failed"))
        .finally(() => {
          running = false;
        });
    },
    get running() {
      return running;
    },
  };
}
