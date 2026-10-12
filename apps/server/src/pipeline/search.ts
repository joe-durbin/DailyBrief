import type { SearchProvider } from "@dailybrief/shared";
import { z } from "zod";
import type { SecretBox } from "../crypto.ts";
import type { Db } from "../db/index.ts";
import { readSearch } from "../settings.ts";

type SearchHit = { url: string; title: string; snippet: string; publishedAt: Date | null; rank: number };
type SearchRange = "week" | "month";
export type SearchFn = (query: string, range: SearchRange) => Promise<SearchHit[]>;

const TIMEOUT_MS = 20_000;
const RANGE_DAYS: Record<SearchRange, number> = { week: 7, month: 31 };

const toDate = (s: string | null | undefined) => {
  const d = s ? new Date(s) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
};

const searxSchema = z.object({ results: z.array(z.object({ url: z.string(), title: z.string().default(""), content: z.string().nullish(), publishedDate: z.string().nullish() })) });
/**
 * Query the SearXNG sidecar (trusted internal service — deliberately not routed through safeFetch,
 * which blocks private addresses).
 */
async function searxSearch(baseUrl: string, query: string, range: SearchRange): Promise<SearchHit[]> {
  const params = new URLSearchParams({ q: query, format: "json", categories: "general,news", time_range: range, language: "en" });
  const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/search?${params}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`SearXNG HTTP ${res.status}`);
  return searxSchema.parse(await res.json()).results.map((r, rank) => ({ url: r.url, title: r.title, snippet: r.content ?? "", publishedAt: toDate(r.publishedDate), rank }));
}

const braveSchema = z.object({ web: z.object({ results: z.array(z.object({ url: z.string(), title: z.string().default(""), description: z.string().nullish(), page_age: z.string().nullish() })) }).optional() });
async function braveSearch(apiKey: string, query: string, range: SearchRange): Promise<SearchHit[]> {
  const params = new URLSearchParams({ q: query, freshness: range === "week" ? "pw" : "pm", count: "20" });
  const res = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, { headers: { "X-Subscription-Token": apiKey, accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Brave HTTP ${res.status}`);
  return (braveSchema.parse(await res.json()).web?.results ?? []).map((r, rank) => ({ url: r.url, title: r.title, snippet: r.description ?? "", publishedAt: toDate(r.page_age), rank }));
}

const tavilySchema = z.object({ results: z.array(z.object({ url: z.string(), title: z.string().default(""), content: z.string().nullish(), published_date: z.string().nullish() })) });
async function tavilySearch(apiKey: string, query: string, range: SearchRange): Promise<SearchHit[]> {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ query, topic: "news", days: RANGE_DAYS[range], max_results: 20 }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Tavily HTTP ${res.status}`);
  return tavilySchema.parse(await res.json()).results.map((r, rank) => ({ url: r.url, title: r.title, snippet: r.content ?? "", publishedAt: toDate(r.published_date), rank }));
}

const exaSchema = z.object({ results: z.array(z.object({ url: z.string(), title: z.string().nullish(), text: z.string().nullish(), publishedDate: z.string().nullish() })) });
async function exaSearch(apiKey: string, query: string, range: SearchRange): Promise<SearchHit[]> {
  const res = await fetch("https://api.exa.ai/search", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey },
    body: JSON.stringify({ query, numResults: 20, startPublishedDate: new Date(Date.now() - RANGE_DAYS[range] * 86_400_000).toISOString(), contents: { text: { maxCharacters: 300 } } }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Exa HTTP ${res.status}`);
  return exaSchema.parse(await res.json()).results.map((r, rank) => ({ url: r.url, title: r.title ?? "", snippet: r.text ?? "", publishedAt: toDate(r.publishedDate), rank }));
}

/** One search call against an explicit provider (used by the settings Test button too). */
export async function runSearch(provider: SearchProvider, apiKey: string, searxngUrl: string, query: string, range: SearchRange): Promise<SearchHit[]> {
  if (provider !== "searxng" && !apiKey) throw new Error(`No API key set for ${provider}`);
  const once = () =>
    provider === "brave" ? braveSearch(apiKey, query, range) : provider === "tavily" ? tavilySearch(apiKey, query, range) : provider === "exa" ? exaSearch(apiKey, query, range) : searxSearch(searxngUrl, query, range);
  try {
    return await once();
  } catch {
    // One retry: search APIs and SearXNG's upstream engines fail transiently.
    return once();
  }
}

/** Search using whichever provider is configured in Settings at call time. */
export function createSearch(db: Db, box: SecretBox, searxngUrl: string): SearchFn {
  return (query, range) => {
    const { provider, apiKey } = readSearch(db, box);
    return runSearch(provider, apiKey, searxngUrl, query, range);
  };
}
