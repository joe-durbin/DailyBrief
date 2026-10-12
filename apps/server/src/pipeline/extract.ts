import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { safeFetch } from "../net/safe-fetch.ts";
import { bestDate, pageDate, parseLooseDate, urlDate, type DateHint } from "./dates.ts";

type Extracted = { url: string; title: string; text: string; html: string; siteName: string; published: DateHint | null };

const MIN_TEXT = 400;

export function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Strip tags from feed-provided HTML snippets (summaries, content:encoded). */
export function htmlToText(html: string): string {
  const { document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`);
  return collapseWhitespace(document.body.textContent ?? "");
}

/** Fetch a page and extract its main article with Readability. Throws when nothing article-like is found. */
export async function extractArticle(url: string): Promise<Extracted> {
  const res = await safeFetch(url);
  if (res.status >= 400) throw new Error(`HTTP ${res.status}`);
  const type = res.headers.get("content-type") ?? "";
  if (type && !type.includes("html")) throw new Error(`Not HTML (${type})`);
  const { document } = parseHTML(res.body);
  // Read the metadata first: Readability rewrites the document.
  const meta = pageDate(document);
  // Readability's types expect a DOM Document; linkedom's is structurally compatible for its needs.
  const article = new Readability(document as unknown as ConstructorParameters<typeof Readability>[0]).parse();
  const text = collapseWhitespace(article?.textContent ?? "");
  if (!article || text.length < MIN_TEXT) throw new Error("No article content found");
  return {
    url: res.url,
    title: collapseWhitespace(article.title ?? ""),
    text,
    html: article.content ?? "",
    siteName: collapseWhitespace(article.siteName ?? "") || new URL(res.url).hostname.replace(/^www\./, ""),
    // Readability's date, then the page's metadata, then the URL; a day beats a month.
    published: bestDate([parseLooseDate(article.publishedTime), meta, urlDate(res.url)]),
  };
}
