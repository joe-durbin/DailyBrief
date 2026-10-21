import { and, desc, eq, gte, inArray, notInArray, or } from "drizzle-orm";
import type { AgentsSettings, BriefFill } from "@dailybrief/shared";
import type { FastifyBaseLogger } from "fastify";
import type { Db } from "../db/index.ts";
import { leadPublisher } from "../db/sql.ts";
import { articles, BRIEF_TRIGGERS, briefs, feedItems, feeds, feedTopics, seenUrls, settings, sources, topics } from "../db/schema.ts";
import type { EventBus } from "../events.ts";
import { AiError, AiTimeoutError } from "../llm/errors.ts";
import type { LlmRouter } from "../llm/router.ts";
import { readAgentSettings } from "../settings.ts";
import { canonicalUrl, cveIds, preCluster } from "./candidates.ts";
import { bestDate, formatHint, latestPossible, parseLooseDate, type DateHint } from "./dates.ts";
import { extractArticle } from "./extract.ts";
import { pollFeeds } from "./feeds.ts";
import { applyFeedPicks } from "./feed-suggest.ts";
import { balancedEvidence, deepShortlist, deepSummaries } from "./research-depth.ts";
import { mapLimit } from "./util.ts";
import {
  type ArticleDraft,
  articleSchema,
  type Cluster,
  clusterPrompt,
  type Preferences,
  clusterSchema,
  queryPlanPrompt,
  queryPlanSchema,
  reviewPrompt,
  reviewSchema,
  selectionPrompt,
  selectionSchema,
  writerPrompt,
} from "./prompts.ts";
import type { SearchFn } from "./search.ts";

export const BRIEF_SIZE = 15;
const DAY = 86_400_000;
/** First pass looks at the last few days; if that can't fill the grid, one wider pass up to the cutoff. */
const WINDOWS = [
  { days: 3, searxRange: "week" },
  { days: 7, searxRange: "month" },
] as const;
/** Stories older than this are dropped, whatever their score (undated sources are dated by the researcher). */
const FRESH_DAYS = 7;
const MAX_RSS_FETCH = 35;
const MAX_SEARCH_FETCH = 35;
const FETCH_CONCURRENCY = 8;
const WRITE_CONCURRENCY = 1;
const SOURCES_PER_ARTICLE = 4;
const SOURCE_CHARS = 3_500;
const CLUSTER_BATCH_SIZE = 18;
const CLUSTER_EXTRACT_CHARS = 400;
const WRITER_TOKENS: Record<AgentsSettings["writer"], number> = { concise: 3_600, standard: 6_000, detailed: 9_000 };
const EDITOR_SHORTLIST = 30;
const RECENT_STORY_DAYS = 14;
/** Ignored stories are remembered much longer and never resurface, even with new developments. */
const IGNORED_STORY_DAYS = 90;
const FEED_MAX_AGE_MS = 30 * 60_000;
const WEIGHTS = { relevance: 3, significance: 3, substance: 2, sourceQuality: 2, freshness: 1, preferenceFit: 1 } as const;
const PREFERENCE_SAMPLE = 25;

export type Trigger = (typeof BRIEF_TRIGGERS)[number];
export type PipelineDeps = { db: Db; llm: LlmRouter; events: EventBus; log: FastifyBaseLogger; search: SearchFn };
export type GenerateOptions = { maxArticles?: number };
type PipelineContext = { briefId: number; signal: AbortSignal; agents: AgentsSettings };

type Candidate = {
  id: number;
  url: string;
  canonical: string;
  title: string;
  text: string;
  publisher: string;
  /** Publication date as precise as the source allows (some only give a month). */
  published: DateHint | null;
  origin: "search" | "rss";
};
type Story = Cluster & { id: number; score: number; members: Candidate[]; date: Date | null };
type Card = { slot: number; articleId: number; story: Story; headline: string; summary: string };

/** Local calendar date (process TZ) as YYYY-MM-DD. */
export function localDate(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}


/** Whole calendar days (local time) between `d` and today. */
const daysAgo = (d: Date) => Math.round((Date.parse(localDate()) - Date.parse(localDate(d))) / DAY);
/** The day a candidate was published, when known to the day. */
const dayOf = (c: Candidate) => (c.published?.precision === "day" ? c.published.at : null);

/** Generate (or regenerate) today's brief for a topic. Returns the brief id. */
export async function generateBrief(deps: PipelineDeps, topicId: number, trigger: Trigger, opts: GenerateOptions = {}): Promise<number> {
  const { db, llm, events, log } = deps;
  const topic = db.select().from(topics).where(eq(topics.id, topicId)).get();
  if (!topic) throw new Error(`Topic ${topicId} not found`);
  const want = Math.min(opts.maxArticles ?? BRIEF_SIZE, BRIEF_SIZE);
  const briefDate = localDate();
  const brief = db.insert(briefs).values({ topicId, briefDate, trigger, status: "gathering", detail: "Planning searches…" }).returning().get();
  // A timed-out AI call ends the whole brief: `stop` cancels the calls still running and no new ones start.
  const stop = new AbortController();
  const ctx: PipelineContext = { briefId: brief.id, signal: stop.signal, agents: readAgentSettings(db) };
  const halted: { by: AiTimeoutError | null } = { by: null };
  const halt = (e: AiTimeoutError) => {
    halted.by ??= e;
    stop.abort(e);
  };
  const update = (patch: Partial<typeof briefs.$inferInsert>) => {
    const row = db.update(briefs).set(patch).where(eq(briefs.id, brief.id)).returning().get();
    if (row) events.emit({ type: "brief.status", topicId, briefId: brief.id, status: row.status, detail: row.detail, progress: row.progress });
  };
  update({ detail: "Planning searches…" });
  const blog = log.child({ topic: topic.name, briefId: brief.id });

  try {
    if (topic.autoFeeds) {
      update({ detail: "Finding feeds…" });
      // Feed picking failing (e.g. search down) shouldn't stop the brief: web search still finds stories.
      await applyFeedPicks(deps, topicId).catch((e: unknown) => {
        if (e instanceof AiTimeoutError) throw e;
        blog.warn({ err: String(e) }, "feed picking failed");
      });
      update({ detail: "Planning searches…" });
    }
    const prefs = readPreferences(db, topicId);
    const plan = await llm.call("researcher", { ...queryPlanPrompt(topic, briefDate, prefs), toolName: "submit_queries", toolDescription: "Submit the search queries", schema: queryPlanSchema }, ctx);
    blog.info({ queries: plan.queries.length }, "queries planned");
    await pollFeeds(db, blog, { topicId, maxAgeMs: FEED_MAX_AGE_MS });

    const pool: Candidate[] = [];
    let stories: Story[] = [];
    for (const window of WINDOWS) {
      update({ detail: `Gathering sources (last ${window.days} days)…` });
      pool.push(...(await gather(deps, topicId, plan.queries, window, pool)));
      update({ candidatesFound: pool.length, status: "selecting", detail: `Reading ${pool.length} sources…` });
      if (!pool.length) continue;
      stories = await clusterStories(deps, topic, pool, ctx, prefs);
      update({ clustersFound: stories.length });
      blog.info({ window: window.days, candidates: pool.length, stories: stories.length }, "clustered");
      if (stories.length >= want) break;
    }
    if (!stories.length) throw new Error("No relevant stories found");

    const fill = readBriefFill(db) === "fill";
    update({ detail: "Selecting the best stories…" });
    const shortlist = stories.slice(0, EDITOR_SHORTLIST);
    const sel = await llm.call(
      "editor",
      {
        ...selectionPrompt(topic, shortlist.map((s) => ({ id: s.id, score: s.score, date: s.date ? localDate(s.date) : "unknown", canonical: s.canonical, sources: s.members.slice(0, 4).map((m) => `${m.publisher}: ${m.title}`) })), want, fill, prefs),
        toolName: "submit_selection",
        toolDescription: "Submit the selected story ids in order",
        schema: selectionSchema,
      },
      ctx,
    );
    const byId = new Map(shortlist.map((s) => [s.id, s]));
    // Belt and braces: never two cards for the same story in one brief, whatever the editor returns.
    const inUse: Story[] = [];
    const tryAdd = (s: Story) => {
      if (inUse.length < want && !inUse.some((u) => u === s || sameStory(u, s))) inUse.push(s);
    };
    for (const id of sel.selected) {
      const s = byId.get(id);
      if (s) tryAdd(s);
    }
    // "Always fill" tops up with the next-best ranked stories; spares also replace failed or duplicate cards.
    if (fill) for (const s of stories) tryAdd(s);
    const chosen = [...inUse];
    if (!chosen.length) throw new Error("Editor selected no stories");
    const spares = fill ? stories.filter((s) => !inUse.includes(s)) : [];
    const takeSpare = (): Story | undefined => {
      for (let s = spares.shift(); s; s = spares.shift()) {
        if (!inUse.some((u) => sameStory(u, s))) {
          inUse.push(s);
          return s;
        }
      }
      return undefined;
    };

    if (trigger === "manual") discardUntriaged(db, topicId, briefDate, brief.id);
    update({ status: "writing", detail: `Writing 0 / ${chosen.length}`, progress: 0 });

    const cards = new Map<number, Card>();
    /** Provider failures while writing; the last one is reported if the brief ends up short. */
    const aiFailures: AiError[] = [];
    const progress = () => update({ progress: cards.size, detail: `Writing ${cards.size} / ${chosen.length}` });
    /** Write `story` into `slot`; in fill mode fall back to spare stories until one succeeds. */
    const fillSlot = async (first: Story, slot: number): Promise<void> => {
      for (let story: Story | undefined = first; story && stop.signal.aborted === false; story = fill ? takeSpare() : undefined) {
        try {
          const draft = await writeStory(deps, topic, story, ctx);
          const articleId = persistArticle(db, { briefId: brief.id, topic, slot, story, draft });
          cards.set(slot, { slot, articleId, story, headline: draft.headline, summary: draft.summary });
          events.emit({ type: "article.ready", topicId, briefId: brief.id, articleId, slot });
          return;
        } catch (e) {
          if (e instanceof AiTimeoutError) return halt(e);
          // Cancelled because another call timed out: stop quietly.
          if (stop.signal.aborted) return;
          blog.warn({ slot, story: story.canonical, err: String(e) }, "article failed");
          if (e instanceof AiError) {
            aiFailures.push(e);
            // Out of tokens, signed out or unreachable: every further attempt would fail the same way.
            if (e.reason) return;
          }
        }
      }
    };
    await mapLimit(chosen, WRITE_CONCURRENCY, async (story, slot) => {
      await fillSlot(story, slot);
      progress();
    });

    if (cards.size > 1 && halted.by === null) {
      update({ detail: "Final editorial review…" });
      const removeDuplicate = async (card: Card) => {
        db.delete(articles).where(eq(articles.id, card.articleId)).run();
        cards.delete(card.slot);
        events.emit({ type: "article.removed", topicId, briefId: brief.id, articleId: card.articleId, slot: card.slot });
        const spare = fill ? takeSpare() : undefined;
        if (spare) await fillSlot(spare, card.slot);
        progress();
      };
      await reviewAndRevise(deps, topic, [...cards.values()].sort((a, b) => a.slot - b.slot), ctx, removeDuplicate).catch((e: unknown) => {
        if (e instanceof AiTimeoutError) halt(e);
        blog.warn({ err: String(e) }, "review failed");
      });
    }

    const written = cards.size;
    const status = written === 0 ? "failed" : written >= want && halted.by === null ? "complete" : "partial";
    db.update(briefs)
      .set({ status: "superseded" })
      .where(and(eq(briefs.topicId, topicId), eq(briefs.briefDate, briefDate), inArray(briefs.status, ["complete", "partial"]), notInArray(briefs.id, [brief.id])))
      .run();
    const failure = halted.by ?? aiFailures.at(-1);
    const error =
      status === "complete" ? null : failure ? (written ? `Stopped after ${written} of ${chosen.length}: ${failure.message}` : failure.message) : written === 0 ? "No articles could be written" : null;
    update({ status, progress: written, completedAt: new Date(), detail: null, error });
    blog.info({ written, status, fill, ...(halted.by ? { timedOut: halted.by.message } : {}) }, "brief finished");
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    blog.error({ err: message }, "brief failed");
    update({ status: "failed", error: message, completedAt: new Date(), detail: null });
  }
  return brief.id;
}

async function gather(deps: PipelineDeps, topicId: number, queries: string[], window: (typeof WINDOWS)[number], existing: Candidate[]): Promise<Candidate[]> {
  const { db, log } = deps;
  const since = new Date(Date.now() - window.days * DAY);
  const known = new Set(existing.map((c) => c.canonical));
  for (const r of db.select({ url: seenUrls.canonicalUrl }).from(seenUrls).where(eq(seenUrls.topicId, topicId)).all()) known.add(r.url);
  const canon = (url: string) => {
    try {
      return canonicalUrl(url);
    } catch {
      return null;
    }
  };

  // RSS items for this topic (trusted, primary sources).
  const rssRows = db
    .select({ id: feedItems.id, url: feedItems.url, title: feedItems.title, summary: feedItems.summary, contentText: feedItems.contentText, publishedAt: feedItems.publishedAt, feed: feeds.name })
    .from(feedItems)
    .innerJoin(feeds, eq(feeds.id, feedItems.feedId))
    .innerJoin(feedTopics, and(eq(feedTopics.feedId, feedItems.feedId), eq(feedTopics.topicId, topicId)))
    .where(and(eq(feeds.enabled, true), gte(feedItems.publishedAt, since)))
    .orderBy(desc(feedItems.publishedAt))
    .all();
  const rss = rssRows.flatMap((r) => {
    const c = canon(r.url);
    if (!c || known.has(c)) return [];
    known.add(c);
    return [{ ...r, canonical: c }];
  }).slice(0, MAX_RSS_FETCH);

  // Web search results, best rank across queries first.
  const searchResults = await mapLimit(queries, 4, (q) => deps.search(q, window.searxRange));
  const bestHit = new Map<string, { url: string; title: string; publishedAt: Date | null; rank: number }>();
  searchResults.forEach((r, i) => {
    if (r.status === "rejected") return void log.warn({ query: queries[i], err: String(r.reason) }, "search failed");
    for (const h of r.value) {
      const c = canon(h.url);
      if (!c || known.has(c) || (h.publishedAt && h.publishedAt < since)) continue;
      const prev = bestHit.get(c);
      if (!prev || h.rank < prev.rank) bestHit.set(c, h);
    }
  });
  const search = [...bestHit.entries()].sort((a, b) => a[1].rank - b[1].rank).slice(0, MAX_SEARCH_FETCH);

  let nextId = existing.reduce((m, c) => Math.max(m, c.id), 0) + 1;
  const fromRss = await mapLimit(rss, FETCH_CONCURRENCY, async (r): Promise<Candidate | null> => {
    let text = r.contentText ?? "";
    let publisher = r.feed;
    if (text.length < 400) {
      try {
        const ex = await extractArticle(r.url);
        text = ex.text;
        db.update(feedItems).set({ contentHtml: ex.html, contentText: ex.text, extraction: "ok" }).where(eq(feedItems.id, r.id)).run();
      } catch {
        text = r.summary ?? "";
        db.update(feedItems).set({ extraction: text ? "fallback" : "failed" }).where(eq(feedItems.id, r.id)).run();
      }
    }
    if (text.length < 150) return null;
    return { id: 0, url: r.url, canonical: r.canonical, title: r.title, text, publisher, published: r.publishedAt && { at: r.publishedAt, precision: "day" }, origin: "rss" };
  });
  const fromSearch = await mapLimit(search, FETCH_CONCURRENCY, async ([c, h]): Promise<Candidate> => {
    const ex = await extractArticle(h.url);
    // The page's own date (metadata, URL) beats the search engine's, and a day beats a month; drop anything provably
    // older than the window.
    const published = bestDate([ex.published, h.publishedAt && { at: h.publishedAt, precision: "day" }]);
    if (published && latestPossible(published) < since) throw new Error(`Stale (${formatHint(published)})`);
    return { id: 0, url: h.url, canonical: c, title: ex.title || h.title, text: ex.text, publisher: ex.siteName, published, origin: "search" };
  });
  return [...fromRss, ...fromSearch].flatMap((r) => (r.status === "fulfilled" && r.value ? [{ ...r.value, id: nextId++ }] : []));
}

async function clusterStories(deps: PipelineDeps, topic: typeof topics.$inferSelect, pool: Candidate[], ctx: PipelineContext, prefs: Preferences): Promise<Story[]> {
  const { db, llm } = deps;
  const groups = preCluster(pool);
  // Recently covered stories (any state) plus anything the reader ignored over a longer horizon.
  const recent = db
    .select({ id: articles.id, canonical: articles.storyKey, state: articles.state })
    .from(articles)
    .where(
      and(
        eq(articles.topicId, topic.id),
        or(gte(articles.createdAt, new Date(Date.now() - RECENT_STORY_DAYS * DAY)), and(eq(articles.state, "ignored"), gte(articles.createdAt, new Date(Date.now() - IGNORED_STORY_DAYS * DAY)))),
      ),
    )
    .all();
  const ignored = new Set(recent.filter((r) => r.state === "ignored").map((r) => r.id));
  const evidence = ctx.agents.researcher === "quick" ? null : new Map(pool.map((source) => [source.id, balancedEvidence(source, topic)]));
  if (ctx.agents.researcher === "deep" && evidence) {
    const summaries = await deepSummaries(deepShortlist(pool, evidence), topic, llm, ctx, deps.log);
    for (const [id, summary] of summaries) {
      const item = evidence.get(id);
      if (item) item.extract += `\n[Researcher summary of selected excerpts, not full source] ${summary}`;
    }
  }
  const allClusters: Cluster[] = [];
  for (let offset = 0; offset < pool.length; offset += CLUSTER_BATCH_SIZE) {
    const slice = pool.slice(offset, offset + CLUSTER_BATCH_SIZE);
    const out = await llm.call(
      "researcher",
      {
        ...clusterPrompt(
          topic,
          slice.map((c, i) => ({
            id: c.id,
            group: groups[offset + i] ?? offset + i,
            title: c.title,
            url: c.url,
            date: formatHint(c.published),
            extract: (evidence?.get(c.id)?.extract ?? c.text).slice(0, CLUSTER_EXTRACT_CHARS),
          })),
          recent,
          prefs,
          localDate(),
        ),
        toolName: "submit_stories",
        toolDescription: "Submit the clustered and scored stories",
        schema: clusterSchema,
        maxTokens: 6_000,
      },
      ctx,
    );
    allClusters.push(...out.clusters);
  }
  const byId = new Map(pool.map((c) => [c.id, c]));
  const used = new Set<number>();
  const weightSum = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
  const stale: string[] = [];
  const stories = allClusters
    .flatMap((cl, i): Story[] => {
      const members = cl.candidateIds.filter((id) => !used.has(id) && byId.has(id)).flatMap((id) => byId.get(id) ?? []);
      members.forEach((m) => used.add(m.id));
      // Ignored stories never come back, even with a new development.
      const isRepeat = cl.recentMatch !== null && (ignored.has(cl.recentMatch) || !cl.materiallyNew);
      if (!members.length || cl.exclude || isRepeat) return [];
      const date = storyDate(cl.eventDate, members);
      const age = date ? daysAgo(date) : 0;
      if (age > FRESH_DAYS) {
        stale.push(`${date ? localDate(date) : "?"} ${cl.canonical.slice(0, 80)}`);
        return [];
      }
      const score = (Object.keys(WEIGHTS) as (keyof typeof WEIGHTS)[]).reduce((s, k) => s + cl[k] * WEIGHTS[k], 0) / weightSum;
      return [{ ...cl, entities: cl.entities.slice(0, 8), id: i + 1, score, members, date }];
    })
    .sort((a, b) => b.score - a.score);
  if (stale.length) deps.log.info({ briefId: ctx.briefId, dropped: stale }, "story dates checked");
  return stories;
}

/**
 * When a story happened: the researcher's estimate, but never fresher than its newest source proves (a page dated
 * last month can't be today's news). Null when there's no clue at all; such stories are kept.
 */
function storyDate(eventDate: string, members: Candidate[]): Date | null {
  const estimate = parseLooseDate(eventDate);
  const newest = members.reduce<Date | null>((max, m) => {
    const d = m.published && latestPossible(m.published);
    return d && (!max || d > max) ? d : max;
  }, null);
  const est = estimate && estimate.at.getTime() <= Date.now() ? estimate.at : null;
  if (est && newest) return est < newest ? est : newest;
  return est ?? newest;
}

/** The topic's most recent thumbs up / down, as "headline (publisher)". */
function readPreferences(db: Db, topicId: number): Preferences {
  const rated = (rating: "up" | "down") =>
    db
      .select({ headline: articles.headline, publisher: leadPublisher })
      .from(articles)
      .where(and(eq(articles.topicId, topicId), eq(articles.rating, rating)))
      .orderBy(desc(articles.ratedAt))
      .limit(PREFERENCE_SAMPLE)
      .all()
      .map((r) => `${r.headline} (${r.publisher ?? "unknown"})`);
  return { liked: rated("up"), disliked: rated("down") };
}

/** Primary/longer sources first; RSS (trusted feeds) before search results. */
function pickSources(story: Story): Candidate[] {
  return [...story.members].sort((a, b) => Number(b.origin === "rss") - Number(a.origin === "rss") || b.text.length - a.text.length).slice(0, SOURCES_PER_ARTICLE);
}

function validateDraft(draft: ArticleDraft, ids: Set<number>): string | null {
  const cited = [...draft.body_md.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
  const bad = [...new Set([...draft.source_ids, ...cited])].filter((id) => !ids.has(id));
  if (bad.length) return `Cited source ids that do not exist: ${bad.join(", ")}. Only use ids ${[...ids].join(", ")}.`;
  if (!cited.length) return "The body has no [n] citations.";
  const words = (s: string) => s.trim().split(/\s+/).length;
  if (words(draft.headline) > 14) return `Headline is ${words(draft.headline)} words; keep it to 12 or fewer.`;
  const sw = words(draft.summary);
  if (sw < 25 || sw > 65) return `Summary is ${sw} words; it must be 35–50 words.`;
  return null;
}

async function writeStory(deps: PipelineDeps, topic: typeof topics.$inferSelect, story: Story, ctx: PipelineContext, feedback?: string): Promise<ArticleDraft & { used: Candidate[] }> {
  const srcs = pickSources(story);
  const ids = new Set(srcs.map((_, i) => i + 1));
  let fix = feedback;
  for (let attempt = 0; attempt < 2; attempt++) {
    let draft: ArticleDraft;
    try {
      draft = await deps.llm.call(
        "writer",
        {
          ...writerPrompt(topic, story.canonical, srcs.map((s, i) => ({ id: i + 1, title: s.title, publisher: s.publisher, date: formatHint(s.published), text: s.text.slice(0, SOURCE_CHARS) })), localDate(), fix, ctx.agents.writer),
          toolName: "submit_article",
          toolDescription: "Submit the finished article",
          schema: articleSchema,
          maxTokens: WRITER_TOKENS[ctx.agents.writer],
        },
        ctx,
      );
    } catch (e) {
      if (attempt !== 0 || !(e instanceof Error) || !("invalidOutput" in e) || e.invalidOutput !== true) throw e;
      fix = [feedback, e.message].filter(Boolean).join("\n");
      continue;
    }
    const problem = validateDraft(draft, ids);
    if (!problem) {
      const usedIds = [...new Set([...draft.source_ids, ...[...draft.body_md.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]))])].sort((a, b) => a - b);
      return { ...draft, used: usedIds.flatMap((id) => srcs[id - 1] ?? []) };
    }
    fix = [feedback, problem].filter(Boolean).join("\n");
  }
  throw new Error(`Draft failed validation twice: ${fix}`);
}

/** The writer's YYYY-MM-DD estimate as a date (noon local time), unless missing or in the future. */
function estimatedDate(day: string | null): { publishedAt: Date | null; dateApprox: boolean } {
  const d = day ? new Date(`${day}T12:00:00`) : null;
  return d && !Number.isNaN(d.getTime()) && day && day <= localDate() ? { publishedAt: d, dateApprox: true } : { publishedAt: null, dateApprox: false };
}

function persistArticle(db: Db, a: { briefId: number; topic: typeof topics.$inferSelect; slot: number; story: Story; draft: ArticleDraft & { used: Candidate[] } }): number {
  const dates = a.story.members.flatMap((m) => dayOf(m)?.getTime() ?? []);
  // Citation numbers in the body refer to the writer's source ids; renumber to positions in the stored list.
  const allIds = pickSources(a.story);
  const renumber = new Map(a.draft.used.map((s, i) => [allIds.indexOf(s) + 1, i + 1]));
  const body = a.draft.body_md.replace(/\[(\d+)\]/g, (m, n: string) => (renumber.has(Number(n)) ? `[${renumber.get(Number(n))}]` : m));
  return db.transaction((tx) => {
    const row = tx
      .insert(articles)
      .values({
        briefId: a.briefId,
        topicId: a.topic.id,
        topicName: a.topic.name,
        slot: a.slot,
        headline: a.draft.headline.trim(),
        summary: a.draft.summary.trim(),
        bodyMd: body,
        storyKey: a.story.canonical,
        entities: [...new Set([...a.story.entities, ...cveIds(a.story.canonical)])],
        // Newest coverage date: how fresh the story is, not when it first broke. With no dated source, the writer's
        // estimate, else the researcher's.
        ...(dates.length ? { publishedAt: new Date(Math.max(...dates)) } : estimatedDate(a.draft.event_date ?? a.story.eventDate)),
      })
      .returning({ id: articles.id })
      .get();
    tx.insert(sources)
      .values(a.draft.used.map((s, i) => ({ articleId: row.id, position: i + 1, url: s.url, title: s.title, publisher: s.publisher, publishedAt: dayOf(s), origin: s.origin, contentText: s.text })))
      .run();
    tx.insert(seenUrls)
      .values(a.story.members.map((m) => ({ topicId: a.topic.id, canonicalUrl: m.canonical })))
      .onConflictDoNothing()
      .run();
    return row.id;
  });
}

async function reviewAndRevise(deps: PipelineDeps, topic: typeof topics.$inferSelect, cards: Card[], ctx: PipelineContext, removeDuplicate: (card: Card) => Promise<void>): Promise<void> {
  const { db, llm, events } = deps;
  const review = await llm.call("editor", { ...reviewPrompt(cards), toolName: "submit_review", toolDescription: "Submit requested revisions", schema: reviewSchema }, ctx);
  const bySlot = new Map(cards.map((c) => [c.slot, c]));
  await mapLimit(review.revisions, WRITE_CONCURRENCY, async (rev) => {
    const card = bySlot.get(rev.slot);
    if (!card) return;
    if (rev.duplicateOfSlot !== null && rev.duplicateOfSlot !== rev.slot && bySlot.has(rev.duplicateOfSlot)) return removeDuplicate(card);
    const draft = await writeStory(deps, topic, card.story, ctx, `Editor: ${rev.instruction}\nPrevious headline: ${card.headline}\nPrevious summary: ${card.summary}`);
    const allIds = pickSources(card.story);
    const renumber = new Map(draft.used.map((s, i) => [allIds.indexOf(s) + 1, i + 1]));
    const body = draft.body_md.replace(/\[(\d+)\]/g, (m, n: string) => (renumber.has(Number(n)) ? `[${renumber.get(Number(n))}]` : m));
    db.transaction((tx) => {
      tx.update(articles).set({ headline: draft.headline.trim(), summary: draft.summary.trim(), bodyMd: body }).where(eq(articles.id, card.articleId)).run();
      tx.delete(sources).where(eq(sources.articleId, card.articleId)).run();
      tx.insert(sources)
        .values(draft.used.map((s, i) => ({ articleId: card.articleId, position: i + 1, url: s.url, title: s.title, publisher: s.publisher, publishedAt: dayOf(s), origin: s.origin, contentText: s.text })))
        .run();
    });
    events.emit({ type: "article.updated", topicId: topic.id, briefId: ctx.briefId, articleId: card.articleId, slot: card.slot });
  });
}

/** Two stories are the same if they share a CVE ID (the LLM clusters everything else). */
function sameStory(a: Story, b: Story): boolean {
  const ids = (s: Story) => cveIds([s.canonical, ...s.entities].join(" "));
  const bIds = new Set(ids(b));
  return ids(a).some((id) => bIds.has(id));
}



/** Settings → Briefs: always fill all 15 cards (default) or only include standout stories. */
export function readBriefFill(db: Db): BriefFill {
  const v = db.select({ value: settings.value }).from(settings).where(eq(settings.key, "brief.fill")).get()?.value;
  return v === "standout" ? "standout" : "fill";
}

/**
 * Regenerate: drop today's untriaged articles (saved/ignored stay) and release the URLs those runs recorded,
 * so strong stories can be picked and rewritten.
 */
function discardUntriaged(db: Db, topicId: number, briefDate: string, newBriefId: number): void {
  db.transaction((tx) => {
    const old = tx
      .select({ id: briefs.id, startedAt: briefs.startedAt })
      .from(briefs)
      .where(and(eq(briefs.topicId, topicId), eq(briefs.briefDate, briefDate), notInArray(briefs.id, [newBriefId])))
      .all();
    if (!old.length) return;
    const oldIds = old.map((b) => b.id);
    tx.delete(articles).where(and(inArray(articles.briefId, oldIds), eq(articles.state, "active"))).run();
    const kept = new Set(
      tx
        .select({ url: sources.url })
        .from(sources)
        .innerJoin(articles, eq(articles.id, sources.articleId))
        .where(eq(articles.topicId, topicId))
        .all()
        .flatMap((r) => {
          try {
            return [canonicalUrl(r.url)];
          } catch {
            return [];
          }
        }),
    );
    const earliest = new Date(Math.min(...old.map((b) => b.startedAt.getTime())));
    const released = tx
      .select({ url: seenUrls.canonicalUrl })
      .from(seenUrls)
      .where(and(eq(seenUrls.topicId, topicId), gte(seenUrls.firstSeenAt, earliest)))
      .all()
      .map((r) => r.url)
      .filter((u) => !kept.has(u));
    if (released.length) tx.delete(seenUrls).where(and(eq(seenUrls.topicId, topicId), inArray(seenUrls.canonicalUrl, released))).run();
    tx.update(briefs).set({ status: "superseded" }).where(and(inArray(briefs.id, oldIds), inArray(briefs.status, ["complete", "partial"]))).run();
  });
}
