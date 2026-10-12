import { feedSuggestSchema, topicCreateSchema, topicOrderSchema, topicPatchSchema, type BriefDate, type FeedSuggestions, type ChatEntry, type ChatsPage, type SavedEntry, type SavedPage } from "@dailybrief/shared";
import { and, count, desc, eq, inArray, isNotNull, isNull, like, max, ne, or, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Db } from "./db/index.ts";
import { leadPublisher, noChat } from "./db/sql.ts";
import { articles, briefs, chatMessages, feedItems, feeds, feedTopics, topics } from "./db/schema.ts";
import type { LlmRouter } from "./llm/router.ts";
import { suggestFeeds } from "./pipeline/feed-suggest.ts";
import type { BriefQueue } from "./pipeline/queue.ts";
import type { SearchFn } from "./pipeline/search.ts";

const idParams = z.object({ id: z.coerce.number().int().positive() });
/**
 * Saved / Chats filter. Neither given = everything. Otherwise `topics` (comma-separated ids, "" = none) picks brief
 * articles from those topics and `rss` ("1"/"0") includes RSS items.
 */
const savedQuery = z.object({
  topics: z
    .string()
    .regex(/^(\d+(,\d+)*)?$/)
    .transform((s) => (s ? s.split(",").map(Number) : []))
    .optional(),
  rss: z.enum(["0", "1"]).optional(),
  q: z.string().trim().max(200).optional(),
  sort: z.enum(["saved", "published"]).default("saved"),
  offset: z.coerce.number().int().min(0).default(0),
});
const SAVED_PAGE = 40;

/** Which kinds of entry a Saved / Chats filter includes, and the topic restriction for brief articles. */
function scopeOf(q: { topics?: number[]; rss?: "0" | "1" }) {
  const filtered = q.topics !== undefined || q.rss !== undefined;
  return { articles: !filtered || (q.topics?.length ?? 0) > 0, topicIds: q.topics, items: !filtered || q.rss === "1" };
}

export function registerTopicRoutes(app: FastifyInstance, db: Db, queue: BriefQueue, ai: { llm: LlmRouter; search: SearchFn }) {
  /** "Let AI pick" in the topic dialog: suggestions only; the dialog creates chosen feeds and saves the topic. */
  app.post("/api/topics/suggest-feeds", async (req, reply): Promise<FeedSuggestions | undefined> => {
    const body = feedSuggestSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "Give the topic a name and a description (at least 20 characters) first" });
    try {
      return await suggestFeeds({ db, ...ai }, body.data);
    } catch (e) {
      req.log.warn({ err: String(e) }, "feed suggestions failed");
      return reply.code(502).send({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  const nameTaken = (name: string, exceptId?: number) =>
    db
      .select({ id: topics.id })
      .from(topics)
      .where(and(sql`lower(${topics.name}) = lower(${name})`, isNull(topics.deletedAt), exceptId ? ne(topics.id, exceptId) : undefined))
      .get() !== undefined;

  const setFeeds = (topicId: number, feedIds: number[]) =>
    db.transaction((tx) => {
      tx.delete(feedTopics).where(eq(feedTopics.topicId, topicId)).run();
      if (feedIds.length) tx.insert(feedTopics).values(feedIds.map((feedId) => ({ feedId, topicId }))).onConflictDoNothing().run();
    });

  app.get("/api/topics/:id", async (req, reply) => {
    const { id } = idParams.parse(req.params);
    const t = db.select().from(topics).where(and(eq(topics.id, id), isNull(topics.deletedAt))).get();
    if (!t) return reply.code(404).send({ error: "Topic not found" });
    const feedIds = db.select({ id: feedTopics.feedId }).from(feedTopics).where(eq(feedTopics.topicId, id)).all().map((r) => r.id);
    return { id: t.id, name: t.name, description: t.description, accent: t.accent, sortOrder: t.sortOrder, feedIds };
  });

  app.post("/api/topics", async (req, reply) => {
    const body = topicCreateSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues[0]?.message ?? "Invalid topic" });
    if (nameTaken(body.data.name)) return reply.code(409).send({ error: "You already have a topic with that name" });
    const maxOrder = db.select({ m: sql<number>`coalesce(max(${topics.sortOrder}), -1)` }).from(topics).get()?.m ?? -1;
    const row = db
      .insert(topics)
      .values({ name: body.data.name, description: body.data.description, accent: body.data.accent, autoFeeds: body.data.autoFeeds, sortOrder: maxOrder + 1 })
      .returning({ id: topics.id })
      .get();
    setFeeds(row.id, body.data.feedIds);
    queue.enqueue(row.id, "created");
    return reply.code(201).send({ id: row.id });
  });

  app.patch("/api/topics/:id", async (req, reply) => {
    const { id } = idParams.parse(req.params);
    const body = topicPatchSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues[0]?.message ?? "Invalid topic" });
    const { feedIds, regenerate, ...fields } = body.data;
    if (fields.name && nameTaken(fields.name, id)) return reply.code(409).send({ error: "You already have a topic with that name" });
    const r = db.update(topics).set({ ...fields, updatedAt: new Date() }).where(and(eq(topics.id, id), isNull(topics.deletedAt))).run();
    if (!r.changes) return reply.code(404).send({ error: "Topic not found" });
    if (feedIds) setFeeds(id, feedIds);
    if (regenerate && !queue.enqueue(id, "manual")) return { ok: true, regenerating: false };
    return { ok: true, regenerating: !!regenerate };
  });

  /** Soft delete: the topic disappears; saved articles keep their topic name snapshot. */
  app.delete("/api/topics/:id", async (req) => {
    const { id } = idParams.parse(req.params);
    db.transaction((tx) => {
      // Names are unique in the table; suffix the deleted one so the name can be reused.
      tx.update(topics).set({ deletedAt: new Date(), name: sql`${topics.name} || ' [deleted ' || ${topics.id} || ']'` }).where(and(eq(topics.id, id), isNull(topics.deletedAt))).run();
      tx.delete(feedTopics).where(eq(feedTopics.topicId, id)).run();
    });
    return { ok: true };
  });

  app.put("/api/topics/order", async (req, reply) => {
    const body = topicOrderSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "Invalid order" });
    db.transaction((tx) => body.data.ids.forEach((id, i) => tx.update(topics).set({ sortOrder: i }).where(eq(topics.id, id)).run()));
    return { ok: true };
  });

  /** Dates that have a finished brief for this topic, newest first (previous-briefs navigator). */
  app.get("/api/topics/:id/briefs", async (req): Promise<BriefDate[]> => {
    const { id } = idParams.parse(req.params);
    const rows = db
      .select({ date: briefs.briefDate, status: briefs.status })
      .from(briefs)
      .where(and(eq(briefs.topicId, id), inArray(briefs.status, ["complete", "partial"])))
      .orderBy(desc(briefs.briefDate), desc(briefs.id))
      .all();
    const seen = new Set<string>();
    return rows.filter((r) => !seen.has(r.date) && seen.add(r.date)).slice(0, 400);
  });

  /** Saved brief articles and saved RSS items, merged. */
  app.get("/api/saved", async (req): Promise<SavedPage> => {
    const q = savedQuery.parse(req.query);
    const term = q.q ? `%${q.q.replace(/[%_]/g, "")}%` : null;
    const entries: SavedEntry[] = [];
    const scope = scopeOf(q);
    if (scope.articles) {
      const rows = db
        .select({
          id: articles.id,
          title: articles.headline,
          summary: articles.summary,
          topicName: articles.topicName,
          topicId: articles.topicId,
          savedAt: articles.savedAt,
          publishedAt: articles.publishedAt,
          rating: articles.rating,
          source: leadPublisher,
        })
        .from(articles)
        .where(
          and(
            eq(articles.state, "saved"),
            noChat("article"),
            scope.topicIds ? inArray(articles.topicId, scope.topicIds) : undefined,
            term ? or(like(articles.headline, term), like(articles.summary, term), like(articles.bodyMd, term)) : undefined,
          ),
        )
        .all();
      for (const r of rows) entries.push({ kind: "article", ...r, source: r.source ?? "", savedAt: r.savedAt?.getTime() ?? 0, publishedAt: r.publishedAt?.getTime() ?? null });
    }
    if (scope.items) {
      const rows = db
        .select({ id: feedItems.id, title: feedItems.title, summary: feedItems.summary, source: sql<string>`coalesce(${feeds.name}, ${feedItems.feedName}, '')`, savedAt: feedItems.savedAt, publishedAt: feedItems.publishedAt })
        .from(feedItems)
        .leftJoin(feeds, eq(feeds.id, feedItems.feedId))
        .where(and(isNotNull(feedItems.savedAt), noChat("feed_item"), term ? or(like(feedItems.title, term), like(feedItems.summary, term)) : undefined))
        .all();
      for (const r of rows) entries.push({ kind: "feed-item", ...r, savedAt: r.savedAt?.getTime() ?? 0, publishedAt: r.publishedAt?.getTime() ?? null });
    }
    const key = (e: SavedEntry) => (q.sort === "published" ? (e.publishedAt ?? 0) : e.savedAt);
    entries.sort((a, b) => key(b) - key(a));
    const page = entries.slice(q.offset, q.offset + SAVED_PAGE);
    return { items: page, nextCursor: q.offset + SAVED_PAGE < entries.length ? String(q.offset + SAVED_PAGE) : null };
  });

  /** Articles and RSS items with a conversation, most recent conversation first. */
  app.get("/api/chats", async (req): Promise<ChatsPage> => {
    const q = savedQuery.parse(req.query);
    const threads = db
      .select({ type: chatMessages.subjectType, id: chatMessages.subjectId, lastAt: max(chatMessages.createdAt), messages: count() })
      .from(chatMessages)
      .groupBy(chatMessages.subjectType, chatMessages.subjectId)
      .all();
    const lastQuestion = new Map(
      db
        .all<{ type: string; id: number; content: string }>(
          sql`select subject_type as type, subject_id as id, content from ${chatMessages} m where role = 'user'
              and id = (select max(id) from ${chatMessages} where subject_type = m.subject_type and subject_id = m.subject_id and role = 'user')`,
        )
        .map((r) => [`${r.type}:${r.id}`, r.content]),
    );
    const idsOf = (type: "article" | "feed_item") => threads.filter((t) => t.type === type).map((t) => t.id);
    const scope = scopeOf(q);
    const articleIds = scope.articles ? idsOf("article") : [];
    const itemIds = scope.items ? idsOf("feed_item") : [];
    const subjects = new Map<string, Pick<ChatEntry, "kind" | "id" | "title" | "source" | "topicId">>();
    if (articleIds.length) {
      for (const a of db
        .select({ id: articles.id, title: articles.headline, source: articles.topicName, topicId: articles.topicId })
        .from(articles)
        .where(and(inArray(articles.id, articleIds), scope.topicIds ? inArray(articles.topicId, scope.topicIds) : undefined))
        .all()) {
        subjects.set(`article:${a.id}`, { kind: "article", ...a });
      }
    }
    if (itemIds.length) {
      for (const i of db
        .select({ id: feedItems.id, title: feedItems.title, source: sql<string>`coalesce(${feeds.name}, ${feedItems.feedName}, '')` })
        .from(feedItems)
        .leftJoin(feeds, eq(feeds.id, feedItems.feedId))
        .where(inArray(feedItems.id, itemIds))
        .all()) {
        subjects.set(`feed_item:${i.id}`, { kind: "feed-item", topicId: null, ...i });
      }
    }
    const needle = q.q?.toLowerCase();
    const entries: ChatEntry[] = threads
      .flatMap((t) => {
        const subject = subjects.get(`${t.type}:${t.id}`);
        if (!subject) return [];
        return [{ ...subject, lastQuestion: lastQuestion.get(`${t.type}:${t.id}`) ?? "", lastAt: t.lastAt?.getTime() ?? 0, messages: t.messages }];
      })
      .filter((e) => !needle || e.title.toLowerCase().includes(needle) || e.lastQuestion.toLowerCase().includes(needle))
      .sort((a, b) => b.lastAt - a.lastAt);
    const page = entries.slice(q.offset, q.offset + SAVED_PAGE);
    return { items: page, nextCursor: q.offset + SAVED_PAGE < entries.length ? String(q.offset + SAVED_PAGE) : null };
  });
}
