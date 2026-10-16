import { connectionTestSchema, modelPriceResetSchema, modelPriceSetSchema, providerCreateSchema, providerPatchSchema, SEARCH_PROVIDERS, settingsPatchSchema, type AppSettings, type ConnectionTest, type ModelPricesReport, type ProviderSummary } from "@dailybrief/shared";
import { asc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { SecretBox } from "./crypto.ts";
import type { Db } from "./db/index.ts";
import { modelPrices, providers, topics } from "./db/schema.ts";
import { createProvider } from "./llm/provider.ts";
import { getProvider } from "./llm/router.ts";
import { pricesFor, type PriceRefresher } from "./pipeline/prices.ts";
import type { BriefQueue } from "./pipeline/queue.ts";
import { runSearch } from "./pipeline/search.ts";
import { readAppSettings, readSearch, writeSearch, writeSetting } from "./settings.ts";

const idParams = z.object({ id: z.coerce.number().int().positive() });
const searchTestSchema = z.object({ provider: z.enum(SEARCH_PROVIDERS), apiKey: z.string().max(500).optional() });

export type SettingsHooks = { onScheduleChange: () => void };

export function registerRoutes(app: FastifyInstance, db: Db, box: SecretBox, queue: BriefQueue, searxngUrl: string, hooks: SettingsHooks, prices: PriceRefresher) {
  const providerFor = (id: number) => getProvider(db, box, id);

  app.get("/api/settings", async (): Promise<AppSettings> => readAppSettings(db));

  app.put("/api/settings", async (req, reply): Promise<AppSettings | undefined> => {
    const patch = settingsPatchSchema.safeParse(req.body);
    if (!patch.success) return reply.code(400).send({ error: patch.error.issues[0]?.message ?? "Invalid settings" });
    const { briefFill, ai, agents, search, schedule, rss, onboarded } = patch.data;
    if (schedule && !Intl.supportedValuesOf("timeZone").includes(schedule.timezone)) return reply.code(400).send({ error: "Unknown timezone" });
    for (const choice of [ai?.default, ...Object.values(ai?.roles ?? {})]) {
      if (choice && !db.select({ id: providers.id }).from(providers).where(eq(providers.id, choice.providerId)).get()) {
        return reply.code(400).send({ error: "That AI provider no longer exists" });
      }
    }
    if (briefFill) writeSetting(db, "brief.fill", briefFill);
    if (ai?.default) writeSetting(db, "ai.default", ai.default);
    if (ai?.roles) writeSetting(db, "ai.roles", ai.roles);
    if (agents) writeSetting(db, "agents", agents);
    if (search) writeSearch(db, box, search);
    if (rss) writeSetting(db, "rss", rss);
    if (onboarded) writeSetting(db, "onboarding.done", true);
    if (schedule) {
      writeSetting(db, "schedule", schedule);
      hooks.onScheduleChange();
    }
    return readAppSettings(db);
  });

  /** Try a search provider (with a candidate key, or the stored one) before saving it. */
  app.post("/api/settings/search/test", async (req, reply) => {
    const body = searchTestSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "Invalid request" });
    const stored = readSearch(db, box);
    const apiKey = body.data.apiKey ?? (stored.provider === body.data.provider ? stored.apiKey : "");
    try {
      const hits = await runSearch(body.data.provider, apiKey, searxngUrl, "cloud security vulnerability", "week");
      return { ok: hits.length > 0, results: hits.length, sample: hits[0]?.title ?? null };
    } catch (e) {
      return { ok: false, results: 0, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /** "Run all now": regenerate every topic's brief today (untriaged cards are replaced). */
  app.post("/api/settings/run-all", async () => {
    const queued = db.select({ id: topics.id }).from(topics).all().filter((t) => queue.enqueue(t.id, "manual")).length;
    return { queued };
  });

  // ---------- AI providers ----------
  const inUse = (id: number) => {
    const ai = readAppSettings(db).ai;
    return [ai.default, ...Object.values(ai.roles)].some((c) => c?.providerId === id);
  };

  app.get("/api/providers", async (): Promise<ProviderSummary[]> =>
    db
      .select()
      .from(providers)
      .orderBy(asc(providers.id))
      .all()
      .map((p) => ({ id: p.id, name: p.name, kind: p.kind, baseUrl: p.baseUrl, enabled: p.enabled, hasKey: p.apiKeyEnc !== null })),
  );

  app.post("/api/providers", async (req, reply) => {
    const body = providerCreateSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues[0]?.message ?? "Invalid provider" });
    const { apiKey, ...fields } = body.data;
    const row = db.insert(providers).values({ ...fields, apiKeyEnc: apiKey ? box.seal(apiKey) : null }).returning({ id: providers.id }).get();
    prices.refresh();
    return reply.code(201).send({ id: row.id });
  });

  app.patch("/api/providers/:id", async (req, reply) => {
    const { id } = idParams.parse(req.params);
    const body = providerPatchSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues[0]?.message ?? "Invalid provider" });
    const { apiKey, ...fields } = body.data;
    const patch = { ...fields, ...(apiKey === undefined ? {} : { apiKeyEnc: apiKey ? box.seal(apiKey) : null }) };
    if (!Object.keys(patch).length) return { ok: true };
    const r = db.update(providers).set(patch).where(eq(providers.id, id)).run();
    if (!r.changes) return reply.code(404).send({ error: "Provider not found" });
    // A new address, key or re-enabled provider can mean different models.
    prices.refresh();
    return { ok: true };
  });

  app.delete("/api/providers/:id", async (req, reply) => {
    const { id } = idParams.parse(req.params);
    const row = db.select({ kind: providers.kind }).from(providers).where(eq(providers.id, id)).get();
    if (!row) return reply.code(404).send({ error: "Provider not found" });
    if (inUse(id)) return reply.code(409).send({ error: "This provider is selected for a model — choose another model first" });
    db.delete(providers).where(eq(providers.id, id)).run();
    return { ok: true };
  });

  app.get("/api/providers/:id/models", async (req, reply) => {
    const { id } = idParams.parse(req.params);
    const provider = providerFor(id);
    if (!provider) return reply.code(404).send({ error: "Provider not found" });
    try {
      return await provider.listModels();
    } catch (e) {
      return reply.code(502).send({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.post("/api/providers/:id/test", async (req, reply) => {
    const { id } = idParams.parse(req.params);
    const provider = providerFor(id);
    if (!provider) return reply.code(404).send({ error: "Provider not found or disabled" });
    const result = await provider.check();
    db.update(providers).set({ lastTestedAt: new Date(), lastTestOk: result.ok }).where(eq(providers.id, id)).run();
    return result;
  });

  /** Try a connection without saving it (first-run "Connect your AI"): reachable, and which models it offers. */
  app.post("/api/providers/test-connection", async (req, reply): Promise<ConnectionTest | undefined> => {
    const body = connectionTestSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues[0]?.message ?? "Check the address" });
    const stored = body.data.providerId ? db.select({ apiKeyEnc: providers.apiKeyEnc }).from(providers).where(eq(providers.id, body.data.providerId)).get() : undefined;
    const apiKey = body.data.apiKey || (stored?.apiKeyEnc ? box.open(stored.apiKeyEnc) : "");
    const provider = createProvider({ kind: body.data.kind, baseUrl: body.data.baseUrl, apiKey });
    const check = await provider.check();
    if (!check.ok) return { ok: false, models: [], error: check.error ?? "No models listed" };
    return { ok: true, models: await provider.listModels() };
  });

  // ---------- model prices ----------
  /** Prices for every model this provider offers (models are listed live, prices come from model_prices). */
  app.get("/api/providers/:id/prices", async (req, reply): Promise<ModelPricesReport | undefined> => {
    const { id } = idParams.parse(req.params);
    const provider = providerFor(id);
    if (!provider) return reply.code(404).send({ error: "Provider not found or disabled" });
    try {
      return { prices: pricesFor(db, await provider.listModels()), refreshing: prices.running };
    } catch (e) {
      return reply.code(502).send({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.post("/api/model-prices/refresh", async () => {
    prices.refresh();
    return { refreshing: true };
  });

  /** A hand-entered price: kept as `manual`, never replaced by the lookup. */
  app.put("/api/model-prices", async (req, reply) => {
    const body = modelPriceSetSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues[0]?.message ?? "Invalid price" });
    const row = { input: body.data.input, output: body.data.output, source: "manual" as const, checkedAt: new Date() };
    db.insert(modelPrices).values({ model: body.data.model, ...row }).onConflictDoUpdate({ target: modelPrices.model, set: row }).run();
    return { ok: true };
  });

  /** Back to automatic: forget the manual price and look it up again. */
  app.post("/api/model-prices/reset", async (req, reply) => {
    const body = modelPriceResetSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "Invalid model" });
    db.delete(modelPrices).where(eq(modelPrices.model, body.data.model)).run();
    prices.refresh();
    return { ok: true };
  });
}
