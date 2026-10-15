import type { Dashboard, DashboardKept, DashboardTopic, Mention } from "@dailybrief/shared";
import { and, asc, count, desc, eq, gte, isNotNull, isNull, ne, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { pickBriefs } from "./briefs-routes.ts";
import type { Db } from "./db/index.ts";
import { leadPublisher, noChat } from "./db/sql.ts";
import { articles, briefs, chatMessages, dailyThemes, feedItems, feeds, feedTopics, llmCalls, providers, topics } from "./db/schema.ts";
import { localDate } from "./pipeline/generate.ts";
import { readAppSettings, readRssSettings } from "./settings.ts";
import type { BriefQueue } from "./pipeline/queue.ts";
import { articlesForDate, type Themes } from "./pipeline/themes.ts";

const DAY = 86_400_000;
const MENTIONS = 14;
const KEPT = 4;

/** Local calendar date of a timestamp, matching how brief dates are stored. */
const dayOf = (d: Date) => localDate(d);

export function registerDashboardRoutes(app: FastifyInstance, db: Db, queue: BriefQueue, themes: Themes) {
  app.get("/api/dashboard", async (): Promise<Dashboard> => {
    const today = localDate();
    const now = Date.now();
    const weekAgo = new Date(now - 7 * DAY);

    // ---------- topics ----------
    const topicRows = db.select().from(topics).where(isNull(topics.deletedAt)).orderBy(asc(topics.sortOrder), asc(topics.id)).all();
    const runs: Dashboard["health"]["runs"] = [];
    const topicCards: DashboardTopic[] = topicRows.map((t) => {
      const rows = db.select().from(briefs).where(and(eq(briefs.topicId, t.id), eq(briefs.briefDate, today))).orderBy(desc(briefs.id)).all();
      const { running, shown, warning } = pickBriefs(rows);
      const remaining = shown ? (db.select({ n: count() }).from(articles).where(and(eq(articles.briefId, shown.id), eq(articles.state, "active"))).get()?.n ?? 0) : 0;
      const latest = rows[0];
      if (latest) {
        runs.push({
          topicId: t.id,
          topicName: t.name,
          status: latest.status,
          startedAt: latest.startedAt.getTime(),
          durationMs: latest.completedAt ? latest.completedAt.getTime() - latest.startedAt.getTime() : null,
          cards: latest.progress,
        });
      }
      const generating = running !== null || queue.isBusy(t.id);
      return {
        id: t.id,
        name: t.name,
        accent: t.accent,
        status: generating ? "generating" : warning ? "warning" : shown ? "ready" : "none",
        warning,
        remaining,
      };
    });

    // ---------- themes ----------
    const todays = articlesForDate(db, today);
    const themeState = themes.status(today);
    const stored = db.select().from(dailyThemes).where(eq(dailyThemes.date, today)).get();
    const byId = new Map(todays.map((a) => [a.id, a]));
    const themeItems = (stored?.themes ?? []).map((t) => {
      // Two topics can carry the same story: list each headline once.
      const seen = new Set<string>();
      return {
        title: t.title,
        summary: t.summary,
        articles: t.articleIds.flatMap((id) => {
          const a = byId.get(id);
          if (!a || seen.has(a.headline.toLowerCase())) return [];
          seen.add(a.headline.toLowerCase());
          return [{ id: a.id, headline: a.headline, topicId: a.topicId }];
        }),
      };
    });

    // ---------- most mentioned: this week vs the week before ----------
    const recent = db
      .select({ entities: articles.entities, createdAt: articles.createdAt })
      .from(articles)
      .where(gte(articles.createdAt, new Date(now - 14 * DAY)))
      .all();
    const tally = new Map<string, { name: string; week: number; prev: number }>();
    for (const r of recent) {
      const thisWeek = r.createdAt.getTime() >= weekAgo.getTime();
      for (const e of new Set(r.entities.map((x) => x.trim()).filter(Boolean))) {
        const key = e.toLowerCase();
        const entry = tally.get(key) ?? { name: e, week: 0, prev: 0 };
        if (thisWeek) entry.week++;
        else entry.prev++;
        tally.set(key, entry);
      }
    }
    const mentions: Mention[] = [...tally.values()]
      .filter((m) => m.week >= 2)
      .sort((a, b) => b.week - a.week || a.name.localeCompare(b.name))
      .slice(0, MENTIONS)
      .map((m) => ({ name: m.name, count: m.week, trend: m.prev === 0 ? "new" : m.week > m.prev ? "up" : "steady" }));

    // ---------- continue where you left off ----------
    const lastChat = db
      .select({ type: chatMessages.subjectType, id: chatMessages.subjectId, content: chatMessages.content, at: chatMessages.createdAt })
      .from(chatMessages)
      .where(eq(chatMessages.role, "user"))
      .orderBy(desc(chatMessages.id))
      .limit(1)
      .get();
    let chat: Dashboard["continue"]["chat"] = null;
    if (lastChat?.type === "article") {
      const a = db.select({ title: articles.headline }).from(articles).where(eq(articles.id, lastChat.id)).get();
      if (a) chat = { kind: "article", id: lastChat.id, title: a.title, lastQuestion: lastChat.content, at: lastChat.at.getTime() };
    } else if (lastChat) {
      const i = db.select({ title: feedItems.title }).from(feedItems).where(eq(feedItems.id, lastChat.id)).get();
      if (i) chat = { kind: "feed-item", id: lastChat.id, title: i.title, lastQuestion: lastChat.content, at: lastChat.at.getTime() };
    }
    const lastRead = db
      .select({ id: feedItems.id, title: feedItems.title, feedName: sql<string>`coalesce(${feeds.name}, ${feedItems.feedName}, '')`, at: feedItems.openedAt })
      .from(feedItems)
      .leftJoin(feeds, eq(feeds.id, feedItems.feedId))
      .where(isNotNull(feedItems.openedAt))
      .orderBy(desc(feedItems.openedAt))
      .limit(1)
      .get();
    const unopenedSince = (opened: typeof articles.openedAt | typeof feedItems.openedAt, saved: typeof articles.savedAt | typeof feedItems.savedAt) =>
      sql`(${opened} is null or ${opened} < ${saved})`;
    const kept: DashboardKept[] = [
      ...db
        .select({
          id: articles.id,
          title: articles.headline,
          source: articles.topicName,
          savedAt: articles.savedAt,
        })
        .from(articles)
        .where(and(eq(articles.state, "saved"), noChat("article"), unopenedSince(articles.openedAt, articles.savedAt)))
        .orderBy(desc(articles.savedAt))
        .limit(KEPT)
        .all()
        .map((r) => ({ kind: "article" as const, ...r, savedAt: r.savedAt?.getTime() ?? 0 })),
      ...db
        .select({ id: feedItems.id, title: feedItems.title, source: sql<string>`coalesce(${feeds.name}, ${feedItems.feedName}, '')`, savedAt: feedItems.savedAt })
        .from(feedItems)
        .leftJoin(feeds, eq(feeds.id, feedItems.feedId))
        .where(and(isNotNull(feedItems.savedAt), noChat("feed_item"), unopenedSince(feedItems.openedAt, feedItems.savedAt)))
        .orderBy(desc(feedItems.savedAt))
        .limit(KEPT)
        .all()
        .map((r) => ({ kind: "feed-item" as const, ...r, savedAt: r.savedAt?.getTime() ?? 0 })),
    ]
      .sort((a, b) => b.savedAt - a.savedAt)
      .slice(0, KEPT);

    // ---------- your week ----------
    const days = Array.from({ length: 7 }, (_, i) => ({ date: dayOf(new Date(now - (6 - i) * DAY)), opened: 0, saved: 0, ignored: 0, rssRead: 0 }));
    const bump = (d: Date | null, field: "opened" | "saved" | "ignored" | "rssRead") => {
      const day = d && days.find((x) => x.date === dayOf(d));
      if (day) day[field]++;
    };
    const since = new Date(now - 8 * DAY);
    for (const a of db.select({ openedAt: articles.openedAt, savedAt: articles.savedAt, ignoredAt: articles.ignoredAt }).from(articles).where(sql`max(coalesce(${articles.openedAt}, 0), coalesce(${articles.savedAt}, 0), coalesce(${articles.ignoredAt}, 0)) >= ${since.getTime()}`).all()) {
      bump(a.openedAt, "opened");
      bump(a.savedAt, "saved");
      bump(a.ignoredAt, "ignored");
    }
    for (const r of db.select({ readAt: feedItems.readAt }).from(feedItems).where(gte(feedItems.readAt, since)).all()) bump(r.readAt, "rssRead");

    const ratings = db
      .select({ rating: articles.rating, n: count() })
      .from(articles)
      .where(and(isNotNull(articles.rating), gte(articles.ratedAt, weekAgo)))
      .groupBy(articles.rating)
      .all();
    const publisher = leadPublisher;
    const topPublishers = db
      .select({ name: publisher, up: count() })
      .from(articles)
      .where(and(eq(articles.rating, "up"), gte(articles.ratedAt, new Date(now - 30 * DAY))))
      .groupBy(publisher)
      .orderBy(desc(count()))
      .limit(3)
      .all()
      .flatMap((p) => (p.name ? [{ name: p.name, up: p.up }] : []));
    const chats = db.get<{ n: number }>(
      sql`select count(*) as n from (select 1 from ${chatMessages} where ${chatMessages.createdAt} >= ${weekAgo.getTime()} group by ${chatMessages.subjectType}, ${chatMessages.subjectId})`,
    )?.n ?? 0;
    const savedTotal =
      (db.select({ n: count() }).from(articles).where(eq(articles.state, "saved")).get()?.n ?? 0) +
      (db.select({ n: count() }).from(feedItems).where(isNotNull(feedItems.savedAt)).get()?.n ?? 0);

    // ---------- health ----------
    const failingFeeds = db
      .select({ id: feeds.id, name: feeds.name, error: feeds.lastError })
      .from(feeds)
      .where(and(eq(feeds.enabled, true), isNotNull(feeds.lastError), ne(feeds.lastError, "")))
      .all()
      .map((f) => ({ id: f.id, name: f.name, error: f.error ?? "" }));
    const rssUnread =
      db
        .select({ n: count() })
        .from(feedItems)
        .innerJoin(feeds, eq(feeds.id, feedItems.feedId))
        .where(and(eq(feeds.enabled, true), isNull(feedItems.readAt)))
        .get()?.n ?? 0;

    // ---------- inactive feeds ----------
    // Newest post per feed (undated items count from when they were first seen). Only feeds that fetch fine:
    // a failing feed is reported under health instead, and a just-added one hasn't been read yet.
    // (A join, not a correlated subquery: drizzle leaves columns unqualified inside sql``, so "id" would bind to feed_items.)
    const latestPost = sql<number | null>`max(coalesce(${feedItems.publishedAt}, ${feedItems.createdAt}))`;
    const { inactiveDays } = readRssSettings(db);
    const cutoff = now - inactiveDays * DAY;
    const inactiveFeeds = db
      .select({ id: feeds.id, name: feeds.name, lastPostAt: latestPost, dismissedAt: feeds.inactiveDismissedAt })
      .from(feeds)
      .leftJoin(feedItems, eq(feedItems.feedId, feeds.id))
      .where(and(eq(feeds.enabled, true), isNotNull(feeds.lastFetchedAt), isNull(feeds.lastError)))
      .groupBy(feeds.id)
      .orderBy(asc(feeds.name))
      .all()
      .filter((f) => (f.lastPostAt ?? 0) < cutoff && (!f.dismissedAt || f.dismissedAt.getTime() < (f.lastPostAt ?? 0)))
      .map((f) => ({
        id: f.id,
        name: f.name,
        lastPostAt: f.lastPostAt,
        topics: db.select({ name: topics.name }).from(feedTopics).innerJoin(topics, eq(topics.id, feedTopics.topicId)).where(eq(feedTopics.feedId, f.id)).all().map((t) => t.name),
      }));

    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    const aiToday = db
      .select({
        provider: sql<string>`coalesce(${providers.name}, 'Removed provider')`,
        model: llmCalls.model,
        calls: count(),
        tokensIn: sql<number>`sum(${llmCalls.tokensIn})`,
        tokensOut: sql<number>`sum(${llmCalls.tokensOut})`,
        costUsd: sql<number | null>`sum(${llmCalls.costUsd})`,
      })
      .from(llmCalls)
      .leftJoin(providers, eq(providers.id, llmCalls.providerId))
      .where(gte(llmCalls.createdAt, midnight))
      .groupBy(llmCalls.providerId, llmCalls.model)
      .orderBy(desc(sql`sum(${llmCalls.tokensIn} + ${llmCalls.tokensOut})`))
      .all();

    // ---------- first run ----------
    const none = (q: { get(): unknown }) => q.get() === undefined;
    const empty =
      topicRows.length === 0 &&
      none(db.select({ id: feeds.id }).from(feeds).limit(1)) &&
      none(db.select({ id: articles.id }).from(articles).where(eq(articles.state, "saved")).limit(1)) &&
      none(db.select({ id: feedItems.id }).from(feedItems).where(isNotNull(feedItems.savedAt)).limit(1)) &&
      none(db.select({ id: chatMessages.id }).from(chatMessages).limit(1));
    const ai = readAppSettings(db).ai.default;
    const aiReady = ai !== null && !none(db.select({ id: providers.id }).from(providers).where(and(eq(providers.id, ai.providerId), eq(providers.enabled, true))));

    return {
      date: today,
      empty,
      aiReady,
      topics: topicCards,
      rssUnread,
      themes: { status: themeState === "pending" ? "pending" : themeState === "failed" ? "failed" : themeItems.length ? "ready" : "none", items: themeItems },
      mentions,
      continue: {
        chat,
        read: lastRead?.at ? { id: lastRead.id, title: lastRead.title, feedName: lastRead.feedName, at: lastRead.at.getTime() } : null,
        saved: kept,
      },
      inactiveDays,
      inactiveFeeds,
      week: {
        days,
        ratings: { up: ratings.find((r) => r.rating === "up")?.n ?? 0, down: ratings.find((r) => r.rating === "down")?.n ?? 0 },
        topPublishers,
        chats,
        savedTotal,
      },
      health: { runs, aiToday, failingFeeds },
    };
  });

  app.post("/api/dashboard/themes/refresh", async (_req, reply) => {
    const today = localDate();
    if (articlesForDate(db, today).length < 4) return reply.code(409).send({ error: "At least four articles from today's briefs are needed to find themes." });
    themes.refresh(today, true);
    return { status: "pending" };
  });
}
