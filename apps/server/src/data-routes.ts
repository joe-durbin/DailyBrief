import type { StorageStats, UsageReport } from "@dailybrief/shared";
import { and, asc, count, desc, eq, gte, isNotNull, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Db } from "./db/index.ts";
import { articles, briefs, chatMessages, feedItems, feeds, llmCalls, sources } from "./db/schema.ts";

const usageQuery = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) });
const exportQuery = z.object({ format: z.enum(["md", "json"]).default("md") });

export function registerDataRoutes(app: FastifyInstance, db: Db) {
  app.get("/api/usage", async (req): Promise<UsageReport> => {
    const { days } = usageQuery.parse(req.query);
    const since = new Date(Date.now() - days * 86_400_000);
    const day = sql<string>`strftime('%Y-%m-%d', ${llmCalls.createdAt} / 1000, 'unixepoch', 'localtime')`;
    // sum() over only-null costs is null: "no price known", distinct from $0.
    const cost = sql<number | null>`sum(${llmCalls.costUsd})`;
    const perDay = db
      .select({ date: day, calls: count(), tokensIn: sql<number>`sum(${llmCalls.tokensIn})`, tokensOut: sql<number>`sum(${llmCalls.tokensOut})`, costUsd: cost })
      .from(llmCalls)
      .where(gte(llmCalls.createdAt, since))
      .groupBy(day)
      .orderBy(asc(day))
      .all();
    const byModel = db
      .select({
        role: llmCalls.role,
        model: llmCalls.model,
        calls: count(),
        tokensIn: sql<number>`sum(${llmCalls.tokensIn})`,
        tokensOut: sql<number>`sum(${llmCalls.tokensOut})`,
        failed: sql<number>`sum(case when ${llmCalls.ok} then 0 else 1 end)`,
        costUsd: cost,
      })
      .from(llmCalls)
      .where(gte(llmCalls.createdAt, since))
      .groupBy(llmCalls.role, llmCalls.model)
      .orderBy(desc(sql`sum(${llmCalls.tokensIn}) + sum(${llmCalls.tokensOut})`))
      .all();
    const brief = db
      .select({ briefs: sql<number>`count(distinct ${llmCalls.briefId})`, tokens: sql<number>`coalesce(sum(${llmCalls.tokensIn} + ${llmCalls.tokensOut}), 0)`, costUsd: cost })
      .from(llmCalls)
      .where(and(gte(llmCalls.createdAt, since), isNotNull(llmCalls.briefId)))
      .get();
    return {
      days: perDay,
      byModel,
      perBrief: {
        briefs: brief?.briefs ?? 0,
        avgTokens: brief?.briefs ? Math.round(brief.tokens / brief.briefs) : 0,
        avgCostUsd: brief?.briefs && brief.costUsd !== null ? brief.costUsd / brief.briefs : null,
      },
      totalCostUsd: db.select({ costUsd: cost }).from(llmCalls).where(gte(llmCalls.createdAt, since)).get()?.costUsd ?? null,
    };
  });

  app.get("/api/stats", async (): Promise<StorageStats> => {
    const n = (q: { get(): { n: number } | undefined }) => q.get()?.n ?? 0;
    return {
      briefs: n(db.select({ n: count() }).from(briefs)),
      articles: n(db.select({ n: count() }).from(articles)),
      saved: n(db.select({ n: count() }).from(articles).where(eq(articles.state, "saved"))) + n(db.select({ n: count() }).from(feedItems).where(isNotNull(feedItems.savedAt))),
      feedItems: n(db.select({ n: count() }).from(feedItems)),
      chats: n(db.select({ n: sql<number>`count(distinct ${chatMessages.subjectType} || ${chatMessages.subjectId})` }).from(chatMessages)),
      dbBytes: db.get<{ n: number }>(sql`select page_count * page_size as n from pragma_page_count(), pragma_page_size()`)?.n ?? 0,
    };
  });

  /** Download everything saved, as Markdown (readable) or JSON (machine-readable). */
  app.get("/api/export/saved", async (req, reply) => {
    const { format } = exportQuery.parse(req.query);
    const saved = db.select().from(articles).where(eq(articles.state, "saved")).orderBy(desc(articles.savedAt)).all();
    const srcs = db.select().from(sources).all();
    const items = db
      .select({ title: feedItems.title, url: feedItems.url, feed: feeds.name, savedAt: feedItems.savedAt, publishedAt: feedItems.publishedAt, summary: feedItems.summary })
      .from(feedItems)
      .innerJoin(feeds, eq(feeds.id, feedItems.feedId))
      .where(isNotNull(feedItems.savedAt))
      .orderBy(desc(feedItems.savedAt))
      .all();
    const stamp = new Date().toISOString().slice(0, 10);
    const sourcesOf = (id: number) => srcs.filter((s) => s.articleId === id).sort((a, b) => a.position - b.position);
    if (format === "json") {
      const data = {
        exportedAt: new Date().toISOString(),
        articles: saved.map((a) => ({
          topic: a.topicName,
          headline: a.headline,
          summary: a.summary,
          body: a.bodyMd,
          savedAt: a.savedAt,
          rating: a.rating,
          sources: sourcesOf(a.id).map((s) => ({ n: s.position, title: s.title, publisher: s.publisher, url: s.url })),
        })),
        rss: items,
      };
      return reply.header("content-disposition", `attachment; filename="dailybrief-saved-${stamp}.json"`).type("application/json").send(JSON.stringify(data, null, 2));
    }
    const md = [
      `# DailyBrief — saved articles (${stamp})`,
      ...saved.map((a) =>
        [`\n---\n\n## ${a.headline}`, `*${a.topicName} · saved ${a.savedAt?.toISOString().slice(0, 10) ?? ""}*`, `> ${a.summary}`, a.bodyMd, "**Sources**", ...sourcesOf(a.id).map((s) => `${s.position}. [${s.title}](${s.url}) — ${s.publisher}`)].join("\n\n"),
      ),
      ...(items.length ? ["\n---\n\n# Saved from RSS", ...items.map((i) => `- [${i.title}](${i.url}) — ${i.feed}${i.summary ? `\n  ${i.summary.slice(0, 280)}` : ""}`)] : []),
    ].join("\n");
    return reply.header("content-disposition", `attachment; filename="dailybrief-saved-${stamp}.md"`).type("text/markdown; charset=utf-8").send(md);
  });
}
