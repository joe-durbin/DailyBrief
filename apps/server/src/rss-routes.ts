import { feedCreateSchema, feedPatchSchema, type Feed, type FeedItemDetail, type FeedItemPage, type FeedItemRow, type FeedPreview } from "@dailybrief/shared";
import { and, asc, count, desc, eq, inArray, isNotNull, isNull, sql, type SQL } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Db } from "./db/index.ts";
import { chatMessages, feedItems, feeds, feedTopics } from "./db/schema.ts";
import { createFeed, extractItem, pollFeed, preExtract, previewFeed } from "./pipeline/feeds.ts";

const idParams = z.object({ id: z.coerce.number().int().positive() });
const PAGE = 50;
const listQuery = z.object({
  feed: z.coerce.number().int().optional(),
  /** Comma-separated topic ids: items from feeds linked to any of them. Omitted = every feed. */
  topics: z
    .string()
    .regex(/^\d+(,\d+)*$/)
    .transform((s) => s.split(",").map(Number))
    .optional(),
  unread: z.enum(["1"]).optional(),
  q: z.string().trim().max(200).optional(),
  /** "<sortKey>:<id>" when browsing by date; "o<offset>" when paging ranked search results. */
  cursor: z.string().regex(/^(\d+:\d+|o\d+)$/).optional(),
});
const filterBody = z.object({ feed: z.number().int().optional(), topics: z.array(z.number().int()).min(1).optional() });

/** Undated items sort by when we first saw them. */
const sortKey = sql<number>`coalesce(${feedItems.publishedAt}, ${feedItems.createdAt})`;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Most matches considered for one search; ranking happens inside SQLite, pagination over this list. */
const SEARCH_LIMIT = 1_000;

/**
 * User text → FTS5 query: every word must match (porter stemming covers word forms), the last word
 * also as a prefix so results appear while typing. Quoting each word neutralises FTS syntax.
 */
function ftsQuery(text: string): string | null {
  const words = text.match(/[\p{L}\p{N}]+/gu);
  if (!words) return null;
  return words.map((w, i) => `"${w}"${i === words.length - 1 ? "*" : ""}`).join(" ");
}

/** Feed name for display; removed feeds keep the snapshot taken at removal. */
const feedNameSql = sql<string>`coalesce(${feeds.name}, ${feedItems.feedName}, '')`;

export function registerRssRoutes(app: FastifyInstance, db: Db) {
  const scope = (f: { feed?: number; topics?: number[] }): SQL[] => {
    const conds: SQL[] = [eq(feeds.enabled, true)];
    if (f.feed) conds.push(eq(feedItems.feedId, f.feed));
    if (f.topics?.length) conds.push(inArray(feedItems.feedId, db.select({ id: feedTopics.feedId }).from(feedTopics).where(inArray(feedTopics.topicId, f.topics))));
    return conds;
  };
  const rowColumns = { id: feedItems.id, feedId: feedItems.feedId, feedName: feedNameSql, title: feedItems.title, url: feedItems.url, publishedAt: feedItems.publishedAt, createdAt: feedItems.createdAt, readAt: feedItems.readAt, savedAt: feedItems.savedAt };
  const toRow = (r: { id: number; feedId: number | null; feedName: string; title: string; url: string; publishedAt: Date | null; createdAt: Date; readAt: Date | null; savedAt: Date | null }): FeedItemRow => ({
    id: r.id,
    feedId: r.feedId,
    feedName: r.feedName,
    title: r.title,
    url: r.url,
    publishedAt: r.publishedAt?.getTime() ?? null,
    listedAt: (r.publishedAt ?? r.createdAt).getTime(),
    read: r.readAt !== null,
    saved: r.savedAt !== null,
  });

  // ---------- reader ----------
  app.get("/api/feed-items", async (req): Promise<FeedItemPage> => {
    const q = listQuery.parse(req.query);
    const conds = scope(q);
    if (q.unread) conds.push(isNull(feedItems.readAt));
    const fts = q.q ? ftsQuery(q.q) : null;
    if (q.q) {
      // Ranked full-text search: title matches weigh most, then the feed summary, then the article text.
      const ranked = fts
        ? db.all<{ id: number }>(
            sql`select rowid as id from feed_items_fts where feed_items_fts match ${fts} order by bm25(feed_items_fts, 10, 4, 1) limit ${SEARCH_LIMIT}`,
          )
        : [];
      const order = new Map(ranked.map((r, i) => [r.id, i]));
      const rows = ranked.length
        ? db
            .select(rowColumns)
            .from(feedItems)
            .innerJoin(feeds, eq(feeds.id, feedItems.feedId))
            .where(and(...conds, inArray(feedItems.id, [...order.keys()])))
            .all()
            .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
        : [];
      const offset = q.cursor?.startsWith("o") ? Number(q.cursor.slice(1)) : 0;
      return { items: rows.slice(offset, offset + PAGE).map(toRow), nextCursor: offset + PAGE < rows.length ? `o${offset + PAGE}` : null };
    }
    if (q.cursor) {
      const [ts, id] = q.cursor.split(":").map(Number);
      conds.push(sql`(${sortKey} < ${ts} or (${sortKey} = ${ts} and ${feedItems.id} < ${id}))`);
    }
    const rows = db
      .select({ ...rowColumns, sort: sortKey })
      .from(feedItems)
      .innerJoin(feeds, eq(feeds.id, feedItems.feedId))
      .where(and(...conds))
      .orderBy(desc(sortKey), desc(feedItems.id))
      .limit(PAGE + 1)
      .all();
    const page = rows.slice(0, PAGE);
    const last = page.at(-1);
    return { items: page.map(toRow), nextCursor: rows.length > PAGE && last ? `${last.sort}:${last.id}` : null };
  });

  app.get("/api/feed-items/:id", async (req, reply): Promise<FeedItemDetail | undefined> => {
    const { id } = idParams.parse(req.params);
    let item = db.select().from(feedItems).where(eq(feedItems.id, id)).get();
    if (!item) return reply.code(404).send({ error: "Item not found" });
    // Not pre-extracted yet: do it now (the reader shows a skeleton meanwhile).
    if (item.extraction === "pending") item = await extractItem(db, item);
    db.update(feedItems).set({ openedAt: new Date() }).where(eq(feedItems.id, id)).run();
    const feed = item.feedId === null ? undefined : db.select({ name: feeds.name }).from(feeds).where(eq(feeds.id, item.feedId)).get();
    return {
      ...toRow({ ...item, feedName: feed?.name ?? item.feedName ?? "" }),
      hasChat: item.hasChat,
      author: item.author,
      summary: item.summary,
      contentHtml: item.contentHtml,
      extraction: item.extraction,
      words: item.contentText ? item.contentText.split(/\s+/).length : 0,
    };
  });

  const stamp = (column: "readAt" | "savedAt", value: Date | null) => async (req: { params: unknown }) => {
    const { id } = idParams.parse(req.params);
    db.update(feedItems).set({ [column]: value ?? null }).where(eq(feedItems.id, id)).run();
    return { ok: true };
  };
  app.post("/api/feed-items/:id/read", async (req) => {
    const { id } = idParams.parse(req.params);
    db.update(feedItems).set({ readAt: new Date() }).where(and(eq(feedItems.id, id), isNull(feedItems.readAt))).run();
    return { ok: true };
  });
  app.post("/api/feed-items/:id/unread", stamp("readAt", null));
  app.post("/api/feed-items/:id/save", async (req) => stamp("savedAt", new Date())(req));
  app.post("/api/feed-items/:id/unsave", stamp("savedAt", null));

  /**
   * "Delete" from Saved/Chats: the conversation is erased and the item stops being kept. It stays in the
   * reader as an ordinary item (deleting the row would just bring it back on the next poll), unless its
   * feed has been removed, in which case nothing else needs it and the row goes too.
   */
  app.delete("/api/feed-items/:id", async (req, reply) => {
    const { id } = idParams.parse(req.params);
    const item = db.select({ feedId: feedItems.feedId }).from(feedItems).where(eq(feedItems.id, id)).get();
    if (!item) return reply.code(404).send({ error: "Item not found" });
    db.transaction((tx) => {
      tx.delete(chatMessages).where(and(eq(chatMessages.subjectType, "feed_item"), eq(chatMessages.subjectId, id))).run();
      if (item.feedId === null) tx.delete(feedItems).where(eq(feedItems.id, id)).run();
      else tx.update(feedItems).set({ savedAt: null, hasChat: false }).where(eq(feedItems.id, id)).run();
    });
    return { ok: true };
  });

  app.post("/api/feed-items/read-all", async (req, reply) => {
    const f = filterBody.safeParse(req.body ?? {});
    if (!f.success) return reply.code(400).send({ error: "Invalid filter" });
    const ids = db.select({ id: feedItems.id }).from(feedItems).innerJoin(feeds, eq(feeds.id, feedItems.feedId)).where(and(...scope(f.data), isNull(feedItems.readAt)));
    const r = db.update(feedItems).set({ readAt: new Date() }).where(inArray(feedItems.id, ids)).run();
    return { marked: r.changes };
  });

  // ---------- feed management ----------
  app.get("/api/feeds", async (): Promise<Feed[]> => {
    const links = db.select().from(feedTopics).all();
    const countBy = (cond: SQL) => new Map(db.select({ feedId: feedItems.feedId, n: count() }).from(feedItems).where(cond).groupBy(feedItems.feedId).all().map((r) => [r.feedId, r.n]));
    const unread = countBy(isNull(feedItems.readAt));
    const kept = countBy(isNotNull(feedItems.savedAt));
    return db
      .select()
      .from(feeds)
      .orderBy(asc(feeds.name))
      .all()
      .map((f) => ({
        id: f.id,
        name: f.name,
        url: f.url,
        enabled: f.enabled,
        topicIds: links.filter((l) => l.feedId === f.id).map((l) => l.topicId),
        lastFetchedAt: f.lastFetchedAt?.getTime() ?? null,
        lastError: f.lastError,
        unread: unread.get(f.id) ?? 0,
        kept: kept.get(f.id) ?? 0,
      }));
  });

  app.post("/api/feeds/preview", async (req, reply): Promise<FeedPreview | undefined> => {
    const body = z.object({ url: z.string().trim().min(4).max(2000) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "Enter a web address" });
    try {
      const p = await previewFeed(body.data.url);
      return { ...p, latest: p.latest?.getTime() ?? null };
    } catch (e) {
      return reply.code(422).send({ error: message(e) });
    }
  });

  app.post("/api/feeds", async (req, reply) => {
    const body = feedCreateSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "Invalid feed" });
    let added;
    try {
      added = await createFeed(db, body.data);
    } catch (e) {
      return reply.code(422).send({ error: `Couldn't read that feed: ${message(e)}` });
    }
    if (added.existing) return reply.code(409).send({ error: "That feed is already in your list", id: added.id });
    void preExtract(db, req.log, 20);
    return reply.code(201).send({ id: added.id });
  });

  app.patch("/api/feeds/:id", async (req, reply) => {
    const { id } = idParams.parse(req.params);
    const body = feedPatchSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "Invalid feed" });
    if (Object.keys(body.data).length) db.update(feeds).set(body.data).where(eq(feeds.id, id)).run();
    return { ok: true };
  });

  /** Removes the feed and its items, except saved ones (chatted items are saved too), which keep the feed's name. */
  app.delete("/api/feeds/:id", async (req) => {
    const { id } = idParams.parse(req.params);
    const kept = db.transaction((tx) => {
      const feed = tx.select({ name: feeds.name }).from(feeds).where(eq(feeds.id, id)).get();
      if (!feed) return 0;
      tx.delete(feedItems).where(and(eq(feedItems.feedId, id), isNull(feedItems.savedAt))).run();
      const r = tx.update(feedItems).set({ feedName: feed.name }).where(eq(feedItems.feedId, id)).run();
      tx.delete(feeds).where(eq(feeds.id, id)).run();
      return r.changes;
    });
    return { ok: true, kept };
  });

  /** Hide the dashboard's inactive-feed warning (it returns if the feed posts again, then goes quiet again). */
  app.post("/api/feeds/:id/dismiss-inactive", async (req, reply) => {
    const { id } = idParams.parse(req.params);
    const r = db.update(feeds).set({ inactiveDismissedAt: new Date() }).where(eq(feeds.id, id)).run();
    if (!r.changes) return reply.code(404).send({ error: "Feed not found" });
    return { ok: true };
  });

  app.post("/api/feeds/:id/fetch", async (req, reply) => {
    const { id } = idParams.parse(req.params);
    const feed = db.select().from(feeds).where(eq(feeds.id, id)).get();
    if (!feed) return reply.code(404).send({ error: "Feed not found" });
    try {
      const added = await pollFeed(db, { ...feed, etag: null, lastModified: null });
      void preExtract(db, req.log, 20);
      return { added };
    } catch (e) {
      return reply.code(502).send({ error: message(e) });
    }
  });
}
