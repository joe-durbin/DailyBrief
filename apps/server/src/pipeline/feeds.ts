import { and, desc, eq, inArray, isNull, lt, or } from "drizzle-orm";
import { XMLParser } from "fast-xml-parser";
import type { FastifyBaseLogger } from "fastify";
import type { Db } from "../db/index.ts";
import { feedItems, feeds, feedTopics } from "../db/schema.ts";
import { safeFetch } from "../net/safe-fetch.ts";
import { parseHTML } from "linkedom";
import { collapseWhitespace, extractArticle, htmlToText } from "./extract.ts";

type ParsedItem = { guid: string; url: string; title: string; author: string | null; publishedAt: Date | null; summary: string | null; contentHtml: string | null };

type XmlNode = Record<string, unknown>;
const isNode = (v: unknown): v is XmlNode => typeof v === "object" && v !== null && !Array.isArray(v);
const asArray = (v: unknown): unknown[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

/** Text content of a parsed XML value: plain string, CDATA/#text node, or nothing. */
function textOf(v: unknown): string {
  if (typeof v === "string" || typeof v === "number") return String(v);
  if (isNode(v)) return textOf(v["#text"] ?? v["__cdata"]);
  return "";
}

function linkOf(item: XmlNode): string {
  for (const l of asArray(item.link)) {
    if (typeof l === "string" && l.trim()) return l.trim();
    if (isNode(l) && (!l["@_rel"] || l["@_rel"] === "alternate") && typeof l["@_href"] === "string") return l["@_href"];
  }
  return textOf(item.guid).startsWith("http") ? textOf(item.guid) : "";
}

function dateOf(item: XmlNode): Date | null {
  const raw = textOf(item.pubDate ?? item.published ?? item.updated ?? item["dc:date"]);
  const d = raw ? new Date(raw) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
}

const parser = new XMLParser({ ignoreAttributes: false, cdataPropName: "__cdata", processEntities: true, htmlEntities: true });

/** Feed-level title (RSS channel / Atom feed). */
export function parseFeedTitle(xml: string): string | null {
  const doc: unknown = parser.parse(xml);
  if (!isNode(doc)) return null;
  const node = isNode(doc.rss) && isNode(doc.rss.channel) ? doc.rss.channel : isNode(doc.feed) ? doc.feed : isNode(doc["rdf:RDF"]) && isNode(doc["rdf:RDF"].channel) ? doc["rdf:RDF"].channel : null;
  return node ? collapseWhitespace(htmlToText(textOf(node.title))) || null : null;
}

/**
 * A feed cut off at the size cap (full-text feeds can run to tens of MB): keep every complete item and close the
 * document, so the newest posts still parse. Feeds list newest first, so what's lost is the oldest.
 */
export function feedBody(res: { body: string; truncated: boolean }): string {
  if (!res.truncated) return res.body;
  const atom = /<feed\b/i.test(res.body.slice(0, 2_000));
  const end = res.body.lastIndexOf(atom ? "</entry>" : "</item>");
  if (end < 0) return res.body;
  return `${res.body.slice(0, end + (atom ? 8 : 7))}${atom ? "</feed>" : /<rdf:RDF\b/i.test(res.body.slice(0, 2_000)) ? "</rdf:RDF>" : "</channel></rss>"}`;
}

/** How far into a document to look for its root element (after declarations and comments). */
const ROOT_SCAN = 64_000;

/**
 * Whether a document is an RSS / Atom / RDF feed: its first element, after any `<?…?>` declarations and `<!-- -->`
 * comments, is rss / feed / rdf:RDF. A step-by-step scan, not one regex: a pattern combining those optional parts
 * backtracked exponentially on comment-heavy HTML and froze the server.
 */
export function isFeedDocument(text: string): boolean {
  const head = text.slice(0, ROOT_SCAN);
  let i = head.charCodeAt(0) === 0xfeff ? 1 : 0;
  for (;;) {
    while (i < head.length && /\s/.test(head.charAt(i))) i++;
    const end = head.startsWith("<?", i) ? head.indexOf("?>", i + 2) : head.startsWith("<!--", i) ? head.indexOf("-->", i + 4) : -2;
    if (end === -2) break;
    if (end === -1) return false;
    i = end + (head.startsWith("<?", i) ? 2 : 3);
  }
  return /^<(?:rss|feed|rdf:RDF)\b/i.test(head.slice(i, i + 12));
}

/** Parse RSS 2.0, Atom or RDF into normalised items; anything else (e.g. an HTML page) gives no items. */
export function parseFeed(xml: string): ParsedItem[] {
  if (!isFeedDocument(xml)) return [];
  const doc: unknown = parser.parse(xml);
  if (!isNode(doc)) return [];
  const rss = isNode(doc.rss) && isNode(doc.rss.channel) ? doc.rss.channel.item : undefined;
  const atom = isNode(doc.feed) ? doc.feed.entry : undefined;
  const rdf = isNode(doc["rdf:RDF"]) ? doc["rdf:RDF"].item : undefined;
  return asArray(rss ?? atom ?? rdf).flatMap((raw) => {
    if (!isNode(raw)) return [];
    const url = linkOf(raw);
    const title = collapseWhitespace(htmlToText(textOf(raw.title)));
    if (!url || !title) return [];
    const contentHtml = textOf(raw["content:encoded"] ?? raw.content) || null;
    const summaryHtml = textOf(raw.description ?? raw.summary);
    const author = textOf(raw["dc:creator"] ?? (isNode(raw.author) ? raw.author.name : raw.author)) || null;
    return [{
      guid: textOf(raw.guid ?? raw.id) || url,
      url,
      title,
      author,
      publishedAt: dateOf(raw),
      summary: summaryHtml ? htmlToText(summaryHtml).slice(0, 1000) : null,
      contentHtml,
    }];
  });
}

/** Conditional GET of one feed; new items are inserted, existing ones left untouched. */
export async function pollFeed(db: Db, feed: typeof feeds.$inferSelect): Promise<number> {
  const headers: Record<string, string> = { accept: "application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.8" };
  if (feed.etag) headers["if-none-match"] = feed.etag;
  if (feed.lastModified) headers["if-modified-since"] = feed.lastModified;
  try {
    const res = await safeFetch(feed.url, { headers, timeoutMs: 20_000, maxBytes: 8_000_000 });
    if (res.status === 304) {
      db.update(feeds).set({ lastFetchedAt: new Date(), lastStatus: 304, lastError: null }).where(eq(feeds.id, feed.id)).run();
      return 0;
    }
    if (res.status >= 400) throw new Error(`HTTP ${res.status}`);
    const items = parseFeed(feedBody(res));
    if (!items.length) throw new Error("No items found in feed");
    let added = 0;
    db.transaction((tx) => {
      for (const it of items) {
        const r = tx
          .insert(feedItems)
          // Undated items stay undated: stamping "now" would make old posts look fresh to the pipeline.
          .values({ feedId: feed.id, guid: it.guid, url: it.url, title: it.title, author: it.author, publishedAt: it.publishedAt, summary: it.summary, contentHtml: it.contentHtml, contentText: it.contentHtml ? htmlToText(it.contentHtml) : null })
          .onConflictDoNothing()
          .run();
        added += r.changes;
      }
      tx.update(feeds)
        .set({ lastFetchedAt: new Date(), lastStatus: res.status, lastError: null, etag: res.headers.get("etag"), lastModified: res.headers.get("last-modified") })
        .where(eq(feeds.id, feed.id))
        .run();
    });
    return added;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    db.update(feeds).set({ lastFetchedAt: new Date(), lastError: message }).where(eq(feeds.id, feed.id)).run();
    throw e;
  }
}

/** Poll enabled feeds (optionally only those linked to one topic) not fetched within `maxAgeMs`. */
export async function pollFeeds(db: Db, log: FastifyBaseLogger, opts: { topicId?: number; maxAgeMs?: number } = {}): Promise<void> {
  const cutoff = new Date(Date.now() - (opts.maxAgeMs ?? 0));
  const topicFeedIds = opts.topicId === undefined ? undefined : db.select({ id: feedTopics.feedId }).from(feedTopics).where(eq(feedTopics.topicId, opts.topicId)).all().map((r) => r.id);
  const due = db
    .select()
    .from(feeds)
    .where(and(eq(feeds.enabled, true), or(isNull(feeds.lastFetchedAt), lt(feeds.lastFetchedAt, cutoff)), topicFeedIds ? inArray(feeds.id, topicFeedIds) : undefined))
    .all();
  const results = await Promise.allSettled(due.map((f) => pollFeed(db, f)));
  results.forEach((r, i) => {
    if (r.status === "rejected") log.warn({ feed: due[i]?.name, err: String(r.reason) }, "feed poll failed");
  });
  const added = results.reduce((n, r) => n + (r.status === "fulfilled" ? r.value : 0), 0);
  if (due.length) log.info({ feeds: due.length, added }, "feeds polled");
}

type FeedPreview = { feedUrl: string; title: string | null; siteUrl: string | null; itemCount: number; latest: Date | null };

const FEED_TYPES = /(rss|atom|xml)/i;

/**
 * Resolve what the user typed into a feed: either a feed URL, or a web page that advertises one via
 * <link rel="alternate" type="application/rss+xml|atom+xml">. Validates by parsing items.
 */
export async function previewFeed(input: string): Promise<FeedPreview> {
  const url = /^https?:\/\//i.test(input) ? input : `https://${input}`;
  const res = await safeFetch(url, { timeoutMs: 20_000, maxBytes: 8_000_000 });
  if (res.status >= 400) throw new Error(`The site returned HTTP ${res.status}`);
  let feedUrl = res.url;
  let body = feedBody(res);
  let items = parseFeed(body);
  let siteUrl: string | null = null;
  if (!items.length) {
    const { document } = parseHTML(body);
    const link = [...document.querySelectorAll('link[rel~="alternate"]')].find((l) => FEED_TYPES.test(l.getAttribute("type") ?? "") && l.getAttribute("href"));
    const href = link?.getAttribute("href");
    if (!href) throw new Error("No RSS or Atom feed found at that address");
    siteUrl = res.url;
    feedUrl = new URL(href, res.url).toString();
    const feedRes = await safeFetch(feedUrl, { timeoutMs: 20_000, maxBytes: 8_000_000 });
    if (feedRes.status >= 400) throw new Error(`The feed returned HTTP ${feedRes.status}`);
    body = feedBody(feedRes);
    items = parseFeed(body);
    if (!items.length) throw new Error("The feed has no readable items");
  }
  const dates = items.flatMap((i) => (i.publishedAt ? [i.publishedAt.getTime()] : []));
  return { feedUrl, title: parseFeedTitle(body), siteUrl, itemCount: items.length, latest: dates.length ? new Date(Math.max(...dates)) : null };
}

/**
 * Add a feed and fetch it once. A feed already in the list (same URL) is returned as is; one that can't be read is
 * removed again and the error thrown.
 */
export async function createFeed(db: Db, input: { url: string; name: string }): Promise<{ id: number; existing: boolean }> {
  const known = db.select({ id: feeds.id }).from(feeds).where(eq(feeds.url, input.url)).get();
  if (known) return { id: known.id, existing: true };
  const row = db.insert(feeds).values({ name: input.name, url: input.url }).returning().get();
  try {
    await pollFeed(db, row);
  } catch (e) {
    db.delete(feeds).where(eq(feeds.id, row.id)).run();
    throw e;
  }
  return { id: row.id, existing: false };
}

const PREEXTRACT_BATCH = 50;
const FEED_CONTENT_IS_FULL = 1_500;

/**
 * Prepare reader-pane content ahead of time so opening an item is instant. Items whose feed already carries
 * the full text use it; others are fetched and run through Readability. Newest first.
 */
export async function preExtract(db: Db, log: FastifyBaseLogger, limit = PREEXTRACT_BATCH): Promise<number> {
  const pending = db.select().from(feedItems).where(eq(feedItems.extraction, "pending")).orderBy(desc(feedItems.publishedAt), desc(feedItems.id)).limit(limit).all();
  let done = 0;
  const queue = [...pending];
  const worker = async () => {
    for (let item = queue.shift(); item; item = queue.shift()) {
      await extractItem(db, item);
      done++;
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  if (done) log.info({ items: done }, "feed items pre-extracted");
  return done;
}

/** Extract one item's readable content (or fall back to feed-provided content/summary) and store it. */
export async function extractItem(db: Db, item: typeof feedItems.$inferSelect): Promise<typeof feedItems.$inferSelect> {
  let patch: Partial<typeof feedItems.$inferInsert>;
  if ((item.contentText?.length ?? 0) >= FEED_CONTENT_IS_FULL) {
    patch = { extraction: "ok" };
  } else {
    try {
      const ex = await extractArticle(item.url);
      patch = { contentHtml: ex.html, contentText: ex.text, extraction: "ok" };
    } catch {
      patch = { extraction: item.contentHtml || item.summary ? "fallback" : "failed" };
    }
  }
  return db.update(feedItems).set(patch).where(eq(feedItems.id, item.id)).returning().get() ?? item;
}
