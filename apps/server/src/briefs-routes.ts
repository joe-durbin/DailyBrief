import { ratingSchema, type ArticleCard, type ArticleDetail, type BriefInfo, type BriefView, type Topic } from "@dailybrief/shared";
import { and, asc, count, desc, eq, inArray, isNull } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Db } from "./db/index.ts";
import { articles, briefs, chatMessages, sources, topics } from "./db/schema.ts";
import type { EventBus } from "./events.ts";
import { BRIEF_SIZE, localDate } from "./pipeline/generate.ts";
import type { BriefQueue } from "./pipeline/queue.ts";

const idParams = z.object({ id: z.coerce.number().int().positive() });
const briefQuery = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() });
const IN_FLIGHT = new Set(["queued", "gathering", "selecting", "writing"]);
const SSE_KEEPALIVE_MS = 25_000;

function toInfo(b: typeof briefs.$inferSelect): BriefInfo {
  return { id: b.id, briefDate: b.briefDate, status: b.status, detail: b.detail, progress: b.progress, error: b.error, completedAt: b.completedAt?.getTime() ?? null };
}

/** Which of a topic's briefs for a date is on screen, and whether a newer run is in progress. */
export function pickBriefs(rows: (typeof briefs.$inferSelect)[]) {
  const running = rows.find((b) => IN_FLIGHT.has(b.status)) ?? null;
  const finished = rows.find((b) => b.status === "complete" || b.status === "partial") ?? null;
  // A regenerate keeps the old grid visible until the new run starts writing.
  const shown = (running?.status === "writing" ? running : null) ?? finished ?? running ?? rows[0] ?? null;
  // The newest run that ended decides the warning: a later successful run clears an earlier failure.
  const ended = rows.find((b) => !IN_FLIGHT.has(b.status) && b.status !== "superseded");
  const warning = running === null && ended && (ended.status === "failed" || ended.status === "partial") ? ended.error : null;
  return { running, shown, warning };
}

export function registerBriefRoutes(app: FastifyInstance, db: Db, queue: BriefQueue, events: EventBus) {
  const briefsFor = (topicId: number, date: string) =>
    db.select().from(briefs).where(and(eq(briefs.topicId, topicId), eq(briefs.briefDate, date))).orderBy(desc(briefs.id)).all();

  /** Topics with today's sidebar state: cards still to triage and whether a brief is being generated. */
  app.get("/api/topics", async (): Promise<Topic[]> => {
    const today = localDate();
    return db
      .select({ id: topics.id, name: topics.name, description: topics.description, accent: topics.accent, sortOrder: topics.sortOrder })
      .from(topics)
      .where(isNull(topics.deletedAt))
      .orderBy(asc(topics.sortOrder), asc(topics.id))
      .all()
      .map((t) => {
        const { running, shown, warning } = pickBriefs(briefsFor(t.id, today));
        const remaining = shown
          ? (db.select({ n: count() }).from(articles).where(and(eq(articles.briefId, shown.id), eq(articles.state, "active"))).get()?.n ?? 0)
          : 0;
        return { ...t, remaining, generating: running !== null || queue.isBusy(t.id), warning };
      });
  });

  app.get("/api/topics/:id/brief", async (req, reply): Promise<BriefView | undefined> => {
    const { id } = idParams.parse(req.params);
    const { date = localDate() } = briefQuery.parse(req.query);
    if (!db.select({ id: topics.id }).from(topics).where(and(eq(topics.id, id), isNull(topics.deletedAt))).get()) {
      return reply.code(404).send({ error: "Topic not found" });
    }
    const { running, shown, warning } = pickBriefs(briefsFor(id, date));

    const slots: (ArticleCard | null)[] = Array.from({ length: BRIEF_SIZE }, () => null);
    if (shown) {
      const cards = db
        .select({ id: articles.id, slot: articles.slot, headline: articles.headline, summary: articles.summary, publishedAt: articles.publishedAt, state: articles.state, rating: articles.rating })
        .from(articles)
        .where(eq(articles.briefId, shown.id))
        .orderBy(asc(articles.slot))
        .all();
      const ids = cards.filter((c) => c.state === "active").map((c) => c.id);
      const srcRows = ids.length
        ? db.select({ articleId: sources.articleId, publisher: sources.publisher, position: sources.position }).from(sources).where(inArray(sources.articleId, ids)).orderBy(asc(sources.position)).all()
        : [];
      for (const [order, c] of cards.entries()) {
        if (c.state !== "active") continue;
        // A finished brief closes gaps left by failed/removed stories; saved and ignored cards still reserve their cells.
        // While writing, keep original slots so streamed cards do not jump around.
        const slot = shown.status === "complete" || shown.status === "partial" ? order : c.slot;
        if (slot >= 0 && slot < BRIEF_SIZE) {
          const own = srcRows.filter((s) => s.articleId === c.id);
          slots[slot] = { ...c, slot, publishedAt: c.publishedAt?.getTime() ?? null, publisher: own[0]?.publisher ?? "", sourceCount: own.length };
        }
      }
    }
    return { brief: shown ? toInfo(shown) : null, running: running && running.id !== shown?.id ? toInfo(running) : null, slots, warning };
  });

  app.post("/api/topics/:id/refresh", async (req, reply) => {
    const { id } = idParams.parse(req.params);
    if (!db.select({ n: count() }).from(topics).where(and(eq(topics.id, id), isNull(topics.deletedAt))).get()?.n) {
      return reply.code(404).send({ error: "Topic not found" });
    }
    if (!queue.enqueue(id, "manual")) return reply.code(409).send({ error: "A brief is already being generated for this topic" });
    return reply.code(202).send({ ok: true });
  });

  app.get("/api/articles/:id", async (req, reply): Promise<ArticleDetail | undefined> => {
    const { id } = idParams.parse(req.params);
    const row = db
      .select({ a: articles, briefDate: briefs.briefDate })
      .from(articles)
      .innerJoin(briefs, eq(briefs.id, articles.briefId))
      .where(eq(articles.id, id))
      .get();
    if (!row) return reply.code(404).send({ error: "Article not found" });
    db.update(articles).set({ openedAt: new Date() }).where(eq(articles.id, id)).run();
    const a = row.a;
    const srcs = db
      .select({ position: sources.position, url: sources.url, title: sources.title, publisher: sources.publisher, publishedAt: sources.publishedAt })
      .from(sources)
      .where(eq(sources.articleId, id))
      .orderBy(asc(sources.position))
      .all();
    return {
      id: a.id,
      briefId: a.briefId,
      briefDate: row.briefDate,
      topicId: a.topicId,
      topicName: a.topicName,
      headline: a.headline,
      summary: a.summary,
      bodyMd: a.bodyMd,
      publishedAt: a.publishedAt?.getTime() ?? null,
      dateApprox: a.dateApprox,
      createdAt: a.createdAt.getTime(),
      state: a.state,
      rating: a.rating,
      sources: srcs.map((s) => ({ ...s, publishedAt: s.publishedAt?.getTime() ?? null })),
      hasChat: hasChat(id),
    };
  });

  const chatOf = (id: number) => and(eq(chatMessages.subjectType, "article"), eq(chatMessages.subjectId, id));
  const hasChat = (id: number) => db.select({ id: chatMessages.id }).from(chatMessages).where(chatOf(id)).limit(1).get() !== undefined;

  const setState = (state: "active" | "saved" | "ignored") => async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = idParams.parse(req.params);
    const now = new Date();
    const patch = state === "saved" ? { state, savedAt: now } : state === "ignored" ? { state, ignoredAt: now } : { state, savedAt: null };
    const r = db.update(articles).set(patch).where(eq(articles.id, id)).run();
    if (!r.changes) return reply.code(404).send({ error: "Article not found" });
    return { ok: true };
  };
  app.post("/api/articles/:id/ignore", setState("ignored"));
  app.post("/api/articles/:id/save", setState("saved"));
  app.post("/api/articles/:id/unsave", setState("active"));

  /** Permanent delete: the article, its sources (cascade) and its conversation. seen_urls stay, so the same pages aren't reused. */
  app.delete("/api/articles/:id", async (req, reply) => {
    const { id } = idParams.parse(req.params);
    const r = db.transaction((tx) => {
      tx.delete(chatMessages).where(chatOf(id)).run();
      return tx.delete(articles).where(eq(articles.id, id)).run();
    });
    if (!r.changes) return reply.code(404).send({ error: "Article not found" });
    return { ok: true };
  });

  app.put("/api/articles/:id/rating", async (req, reply) => {
    const { id } = idParams.parse(req.params);
    const body = ratingSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "Invalid rating" });
    const r = db.update(articles).set({ rating: body.data.rating, ratedAt: body.data.rating ? new Date() : null }).where(eq(articles.id, id)).run();
    if (!r.changes) return reply.code(404).send({ error: "Article not found" });
    return { ok: true };
  });

  app.get("/api/events", (req, reply) => {
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive", "x-accel-buffering": "no" });
    res.write("retry: 3000\n\n");
    const unsubscribe = events.subscribe((e) => res.write(`data: ${JSON.stringify(e)}\n\n`));
    const keepalive = setInterval(() => res.write(": keepalive\n\n"), SSE_KEEPALIVE_MS);
    res.on("close", () => {
      clearInterval(keepalive);
      unsubscribe();
    });
  });
}
