import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.ts";
import type { Db } from "../src/db/index.ts";
import { articles, briefs, chatMessages, feedItems, feeds, modelPrices, providers, settings, sources, topics } from "../src/db/schema.ts";
import { refreshPrices } from "../src/pipeline/prices.ts";
import { makeSecretBox } from "../src/crypto.ts";
import { loadConfig } from "../src/config.ts";
import { AiTimeoutError, toAiError } from "../src/llm/errors.ts";
import { createLlmRouter } from "../src/llm/router.ts";
import { createServer } from "node:http";
import { once } from "node:events";
import { z } from "zod";

let app: FastifyInstance;
let db: Db;
let dataDir: string;
let cookie = "";

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "dailybrief-test-"));
  ({ app, db } = await buildApp(loadConfig({ DATA_DIR: dataDir, DAILYBRIEF_SECRET: "x".repeat(40), LOGIN_DELAY_BASE_MS: "0" }), { logger: false }));
  const res = await app.inject({ method: "POST", url: "/api/auth/setup", payload: { username: "reader", password: "correct horse battery" } });
  cookie = String(res.headers["set-cookie"]).split(";")[0] ?? "";
});
after(async () => {
  await app.close();
  rmSync(dataDir, { recursive: true, force: true });
});

describe("removing a feed", () => {
  it("keeps saved and chatted items under the feed's name and drops the rest; search matches word forms", async () => {
    const feed = db.insert(feeds).values({ name: "Noisy Blog", url: "https://noisy.example/feed" }).returning().get();
    const item = (guid: string, title: string, savedAt: Date | null) =>
      db.insert(feedItems).values({ feedId: feed.id, guid, url: `https://noisy.example/${guid}`, title, summary: "", savedAt }).returning().get();
    const saved = item("a", "Attackers exploited the gateway", new Date());
    const chatted = item("b", "Notes on gateway exploitation", new Date());
    const plain = item("c", "Gateway exploit roundup", null);
    db.insert(chatMessages).values({ subjectType: "feed_item", subjectId: chatted.id, role: "user", content: "What changed?" }).run();
    // Porter stemming: "exploit" finds "exploited" and "exploitation".
    const search = await app.inject({ url: "/api/feed-items?q=exploit", headers: { cookie } });
    assert.deepEqual(new Set(search.json().items.map((i: { id: number }) => i.id)), new Set([saved.id, chatted.id, plain.id]));

    const res = await app.inject({ method: "DELETE", url: `/api/feeds/${feed.id}`, headers: { cookie } });
    assert.equal(res.json().kept, 2);
    assert.equal(db.select().from(feedItems).where(eq(feedItems.id, plain.id)).get(), undefined, "unsaved items go with the feed");

    const savedList = await app.inject({ url: "/api/saved", headers: { cookie } });
    assert.deepEqual(savedList.json().items.map((e: { id: number; source: string }) => [e.id, e.source]), [[saved.id, "Noisy Blog"]], "chatted items live in Chats, not Saved");
    const chats = await app.inject({ url: "/api/chats", headers: { cookie } });
    assert.deepEqual(chats.json().items.map((e: { id: number; source: string; lastQuestion: string }) => [e.id, e.source, e.lastQuestion]), [[chatted.id, "Noisy Blog", "What changed?"]]);

    // With the feed gone, deleting from Chats erases the item and its chat for good.
    await app.inject({ method: "DELETE", url: `/api/feed-items/${chatted.id}`, headers: { cookie } });
    assert.equal(db.select().from(feedItems).where(eq(feedItems.id, chatted.id)).get(), undefined);
    assert.equal(db.select().from(chatMessages).where(eq(chatMessages.subjectId, chatted.id)).all().length, 0);
  });
});

describe("saved list and dashboard lookups", () => {
  it("names each article's own publisher and moves chatted articles out of Saved", async () => {
    const topic = db.insert(topics).values({ name: "Test topic", description: "A topic for testing lookups", accent: "#7C8CFF" }).returning().get();
    const brief = db.insert(briefs).values({ topicId: topic.id, briefDate: "2026-10-01", trigger: "manual", status: "complete" }).returning().get();
    const article = (slot: number, headline: string, publisher: string) => {
      const a = db
        .insert(articles)
        .values({ briefId: brief.id, topicId: topic.id, topicName: topic.name, slot, headline, summary: "s", bodyMd: "b", storyKey: headline, entities: [], state: "saved", savedAt: new Date() })
        .returning()
        .get();
      db.insert(sources).values({ articleId: a.id, position: 1, url: `https://x.example/${slot}`, title: "t", publisher, origin: "search", contentText: "x" }).run();
      return a;
    };
    // Spare rows so source ids, chat ids and article ids differ (a mis-bound "id" would then pick the wrong row).
    for (let i = 0; i < 3; i++) db.insert(chatMessages).values({ subjectType: "feed_item", subjectId: 9_000 + i, role: "user", content: "x" }).run();
    const spare = article(9, "Spare", "Spare publisher");
    for (let i = 2; i < 6; i++) db.insert(sources).values({ articleId: spare.id, position: i, url: `https://x.example/s${i}`, title: "t", publisher: "Spare publisher", origin: "search", contentText: "x" }).run();
    db.update(articles).set({ state: "active", savedAt: null }).where(eq(articles.id, spare.id)).run();
    const plain = article(0, "Saved only", "Publisher A");
    const chatted = article(1, "Saved and chatted", "Publisher B");
    db.insert(chatMessages).values({ subjectType: "article", subjectId: chatted.id, role: "user", content: "Why?" }).run();

    const saved = (await app.inject({ url: `/api/saved?topics=${topic.id}&rss=0`, headers: { cookie } })).json().items;
    assert.deepEqual(saved.map((e: { id: number; source: string }) => [e.id, e.source]), [[plain.id, "Publisher A"]]);
  });

  it("warns about feeds quiet for the configured number of days until dismissed", async () => {
    const feed = (name: string, daysAgo: number) => {
      const f = db.insert(feeds).values({ name, url: `https://${name}.example/feed`, lastFetchedAt: new Date() }).returning().get();
      db.insert(feedItems).values({ feedId: f.id, guid: name, url: `https://${name}.example/1`, title: name, publishedAt: new Date(Date.now() - daysAgo * 86_400_000) }).run();
      return f;
    };
    const quiet = feed("quiet", 40);
    feed("busy", 2);
    const warned = async () => (await app.inject({ url: "/api/dashboard", headers: { cookie } })).json().inactiveFeeds.map((f: { name: string }) => f.name);
    assert.deepEqual(await warned(), ["quiet"]);
    const setDays = (inactiveDays: number) => app.inject({ method: "PUT", url: "/api/settings", headers: { cookie }, payload: { rss: { inactiveDays } } });
    assert.equal((await setDays(3)).statusCode, 400, "below the 7-day minimum");
    await setDays(60);
    assert.deepEqual(await warned(), [], "40 days is no longer quiet with a 60-day threshold");
    await setDays(30);
    await app.inject({ method: "POST", url: `/api/feeds/${quiet.id}/dismiss-inactive`, headers: { cookie } });
    assert.deepEqual(await warned(), []);
  });
});

describe("model price lookup", () => {
  it("prices models from the catalogue or OpenRouter, ignores $0 provider figures and never overwrites manual prices", async () => {
    db.update(providers).set({ enabled: false }).run();
    db.insert(providers).values({ name: "Proxy", kind: "openai_compatible", baseUrl: "http://proxy.test/v1" }).run();
    db.insert(modelPrices).values({ model: "mine", input: 7, output: 7, source: "manual" }).run();
    const responses: Record<string, unknown> = {
      "http://proxy.test/v1/models": { data: ["gpt-6-sol", "claude-haiku-4-5-20251001", "claude-opus-5-5", "local-llama", "mine"].map((id) => ({ id })) },
      // A subscription route: the proxy reports $0, which must not count as a price.
      "http://proxy.test/v1/model/info": { data: [{ model_name: "gpt-6-sol", litellm_params: { model: "chatgpt/gpt-6-sol" }, model_info: { input_cost_per_token: 0, output_cost_per_token: 0 } }] },
      "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json": {
        "gpt-6-sol": { input_cost_per_token: 2e-6, output_cost_per_token: 1e-5 },
        "claude-haiku-4-5": { input_cost_per_token: 1e-6, output_cost_per_token: 5e-6 },
      },
      "https://openrouter.ai/api/v1/models": { data: [{ id: "anthropic/claude-opus-5.5:batch", pricing: { prompt: "0.000002", completion: "0.00001" } }, { id: "anthropic/claude-opus-5.5", pricing: { prompt: "0.000004", completion: "0.00002" } }] },
    };
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input instanceof Request ? input.url : input);
      return url in responses ? Response.json(responses[url]) : new Response("not found", { status: 404 });
    }) as typeof fetch;
    try {
      await refreshPrices({ db, box: makeSecretBox("x".repeat(40)), log: app.log });
    } finally {
      globalThis.fetch = realFetch;
    }
    const price = (model: string) => {
      const r = db.select().from(modelPrices).where(eq(modelPrices.model, model)).get();
      return r && [r.input, r.output, r.source];
    };
    assert.deepEqual(price("gpt-6-sol"), [2, 10, "catalogue"]);
    assert.deepEqual(price("claude-haiku-4-5-20251001"), [1, 5, "catalogue"], "date suffix dropped to match");
    assert.deepEqual(price("claude-opus-5-5"), [4, 20, "openrouter"], "dots vs dashes, :batch variant skipped");
    assert.deepEqual(price("local-llama"), [null, null, null], "unmatched stays unknown");
    assert.deepEqual(price("mine"), [7, 7, "manual"]);
  });
});

describe("AI provider errors", () => {
  const sdkError = (status: number | undefined, message: string, name = "APIError") =>
    Object.assign(new Error(`${status ?? ""} ${message}`.trim()), { name, status, error: { error: { message } } });

  it("explains quota, sign-in and connectivity failures, and always keeps the provider's own words", () => {
    const quota = toAiError(sdkError(429, "You've reached your usage limit."), "LiteLLM (openai)");
    assert.equal(quota.message, 'Out of tokens / rate limited — LiteLLM (openai) said: "You\'ve reached your usage limit."');
    assert.equal(toAiError(sdkError(400, "insufficient_quota for this account"), "X").reason, "Out of tokens / rate limited");
    assert.equal(toAiError(sdkError(401, "invalid token"), "X").reason, "Sign-in to the provider failed (check Settings → AI)");
    assert.equal(toAiError(sdkError(undefined, "Connection error.", "APIConnectionError"), "X").reason, "Can't reach the AI provider");

    const odd = toAiError(sdkError(500, "model overloaded"), "LiteLLM (anthropic)");
    assert.equal(odd.reason, null);
    assert.equal(odd.message, 'LiteLLM (anthropic) said: "model overloaded"');
  });
});

describe("AI call limits", () => {
  it("lets a slow answer that keeps streaming finish, and stops stalled or endless calls", async () => {
    // Fake OpenAI-compatible endpoint streaming a tool call in pieces, `gapMs` apart.
    let plan: { pieces: number; gapMs: number; silentFirstMs: number } = { pieces: 5, gapMs: 0, silentFirstMs: 0 };
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const server = createServer(async (_req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      const send = (o: unknown) => res.write(`data: ${JSON.stringify(o)}\n\n`);
      const chunk = (args: string, finish: string | null = null) =>
        send({ id: "c", object: "chat.completion.chunk", created: 0, model: "m", choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "t", type: "function", function: { name: "submit", arguments: args } }] }, finish_reason: finish }] });
      await sleep(plan.silentFirstMs);
      const json = JSON.stringify({ answer: "done" });
      for (let i = 0; i < plan.pieces && !res.destroyed; i++) {
        chunk(i === plan.pieces - 1 ? json : "");
        await sleep(plan.gapMs);
      }
      if (res.destroyed) return;
      chunk("", "tool_calls");
      send({ id: "c", object: "chat.completion.chunk", created: 0, model: "m", choices: [], usage: { prompt_tokens: 10, completion_tokens: 5 } });
      res.end("data: [DONE]\n\n");
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    db.update(providers).set({ enabled: false }).run();
    const p = db.insert(providers).values({ name: "Fake", kind: "openai_compatible", baseUrl: `http://127.0.0.1:${port}/v1` }).returning().get();
    db.insert(settings).values({ key: "ai.default", value: { providerId: p.id, model: "m" } }).onConflictDoUpdate({ target: settings.key, set: { value: { providerId: p.id, model: "m" } } }).run();
    const llm = createLlmRouter(db, makeSecretBox("x".repeat(40)), { silenceMs: 400, maxCallMs: 2_000 });
    const ask = () => llm.call("researcher", { system: "s", user: "u", toolName: "submit", toolDescription: "d", schema: z.object({ answer: z.string() }) });
    try {
      // 1.2 s in total — three times the silence limit — but never 400 ms without data: it finishes.
      plan = { pieces: 6, gapMs: 200, silentFirstMs: 0 };
      assert.deepEqual(await ask(), { answer: "done" });
      // Nothing for longer than the silence limit: stopped as stalled.
      plan = { pieces: 2, gapMs: 0, silentFirstMs: 1_000 };
      await assert.rejects(ask(), (e: unknown) => e instanceof AiTimeoutError && /No response for 0.4 seconds/.test(e.message));
      // Keeps trickling past the hard cap: stopped anyway.
      plan = { pieces: 100, gapMs: 150, silentFirstMs: 0 };
      await assert.rejects(ask(), (e: unknown) => e instanceof AiTimeoutError && /Still running after 2 seconds/.test(e.message));
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });
});
