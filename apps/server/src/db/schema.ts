import { sql } from "drizzle-orm";
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const now = sql`(unixepoch() * 1000)`;
const createdAt = () => integer("created_at", { mode: "timestamp_ms" }).notNull().default(now);

export const users = sqliteTable(
  "users",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** Stored as entered (for display); matched case-insensitively. */
    username: text("username").notNull(),
    passwordHash: text("password_hash").notNull(),
    createdAt: createdAt(),
    passwordChangedAt: integer("password_changed_at", { mode: "timestamp_ms" }).notNull().default(now),
  },
  (t) => [uniqueIndex("users_username_nocase_idx").on(sql`lower(${t.username})`)],
);

export const sessions = sqliteTable(
  "sessions",
  {
    /** sha256(token), never the token itself. */
    id: text("id").primaryKey(),
    userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" }).notNull().default(now),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    remember: integer("remember", { mode: "boolean" }).notNull(),
    userAgent: text("user_agent"),
    ip: text("ip"),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const loginAttempts = sqliteTable(
  "login_attempts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    ip: text("ip").notNull(),
    attemptedAt: integer("attempted_at", { mode: "timestamp_ms" }).notNull(),
    success: integer("success", { mode: "boolean" }).notNull(),
  },
  (t) => [index("login_attempts_ip_idx").on(t.ip, t.attemptedAt)],
);

export const topics = sqliteTable("topics", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  description: text("description").notNull(),
  accent: text("accent").notNull(),
  icon: text("icon"),
  sortOrder: integer("sort_order").notNull().default(0),
  /** "Let AI pick" chosen without previewing: the next brief first picks and links feeds, then clears this. */
  autoFeeds: integer("auto_feeds", { mode: "boolean" }).notNull().default(false),
  createdAt: createdAt(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(now),
  deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
});

export const feeds = sqliteTable("feeds", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  url: text("url").notNull().unique(),
  siteUrl: text("site_url"),
  iconUrl: text("icon_url"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  lastFetchedAt: integer("last_fetched_at", { mode: "timestamp_ms" }),
  lastStatus: integer("last_status"),
  lastError: text("last_error"),
  etag: text("etag"),
  lastModified: text("last_modified"),
  /** Dashboard "hasn't posted in 30 days" warning dismissed; it returns only after the feed posts again and goes quiet again. */
  inactiveDismissedAt: integer("inactive_dismissed_at", { mode: "timestamp_ms" }),
  createdAt: createdAt(),
});

export const feedTopics = sqliteTable(
  "feed_topics",
  {
    feedId: integer("feed_id").notNull().references(() => feeds.id, { onDelete: "cascade" }),
    topicId: integer("topic_id").notNull().references(() => topics.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.feedId, t.topicId] })],
);

export const providers = sqliteTable("providers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  kind: text("kind", { enum: ["anthropic", "openai", "gemini", "openrouter", "openai_compatible"] }).notNull(),
  baseUrl: text("base_url").notNull(),
  /** AES-256-GCM sealed (see crypto.ts). */
  apiKeyEnc: text("api_key_enc"),
  headersEnc: text("headers_enc"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  modelsCache: text("models_cache", { mode: "json" }).$type<string[]>(),
  capabilities: text("capabilities", { mode: "json" }).$type<Record<string, boolean>>(),
  lastTestedAt: integer("last_tested_at", { mode: "timestamp_ms" }),
  lastTestOk: integer("last_test_ok", { mode: "boolean" }),
  createdAt: createdAt(),
});

const PRICE_SOURCES = ["catalogue", "openrouter", "provider", "manual"] as const;

/**
 * Model prices (USD per million tokens), keyed by model name — names are unique across providers. Filled by the
 * price lookup (pipeline/prices.ts); `manual` rows are the reader's own and never overwritten. A row with no prices
 * means "looked, not found". The price at the time of each call is copied into llm_calls.cost_usd.
 */
export const modelPrices = sqliteTable("model_prices", {
  model: text("model").primaryKey(),
  input: real("input"),
  output: real("output"),
  source: text("source", { enum: PRICE_SOURCES }),
  checkedAt: integer("checked_at", { mode: "timestamp_ms" }).notNull().default(now),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value", { mode: "json" }).notNull(),
});

export const BRIEF_TRIGGERS = ["created", "scheduled", "manual", "catch_up"] as const;
const BRIEF_STATUSES = ["queued", "gathering", "selecting", "writing", "complete", "partial", "failed", "superseded"] as const;

export const briefs = sqliteTable(
  "briefs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    topicId: integer("topic_id").notNull().references(() => topics.id, { onDelete: "cascade" }),
    /** Local (TZ) calendar date, YYYY-MM-DD. */
    briefDate: text("brief_date").notNull(),
    trigger: text("trigger", { enum: BRIEF_TRIGGERS }).notNull(),
    status: text("status", { enum: BRIEF_STATUSES }).notNull().default("queued"),
    /** Human-readable progress line, e.g. "Writing 6 / 15". */
    detail: text("detail"),
    progress: integer("progress").notNull().default(0),
    candidatesFound: integer("candidates_found"),
    clustersFound: integer("clusters_found"),
    error: text("error"),
    startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull().default(now),
    completedAt: integer("completed_at", { mode: "timestamp_ms" }),
  },
  (t) => [index("briefs_topic_date_idx").on(t.topicId, t.briefDate)],
);

export const articles = sqliteTable(
  "articles",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    briefId: integer("brief_id").notNull().references(() => briefs.id, { onDelete: "cascade" }),
    topicId: integer("topic_id").notNull().references(() => topics.id, { onDelete: "cascade" }),
    /** Snapshot so saved items keep context if the topic is renamed or deleted. */
    topicName: text("topic_name").notNull(),
    slot: integer("slot").notNull(),
    headline: text("headline").notNull(),
    summary: text("summary").notNull(),
    bodyMd: text("body_md").notNull(),
    /** One-line canonical description of the story; used for cross-day dedupe. */
    storyKey: text("story_key").notNull(),
    entities: text("entities", { mode: "json" }).$type<string[]>().notNull(),
    publishedAt: integer("published_at", { mode: "timestamp_ms" }),
    /** publishedAt is the writer's estimate of when the news happened (no source carried a date). */
    dateApprox: integer("date_approx", { mode: "boolean" }).notNull().default(false),
    state: text("state", { enum: ["active", "saved", "ignored"] }).notNull().default("active"),
    rating: text("rating", { enum: ["up", "down"] }),
    savedAt: integer("saved_at", { mode: "timestamp_ms" }),
    ignoredAt: integer("ignored_at", { mode: "timestamp_ms" }),
    ratedAt: integer("rated_at", { mode: "timestamp_ms" }),
    /** Last time the reader opened the full article (dashboard: "saved, not opened since"). */
    openedAt: integer("opened_at", { mode: "timestamp_ms" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("articles_brief_slot_idx").on(t.briefId, t.slot), index("articles_topic_created_idx").on(t.topicId, t.createdAt)],
);

export const sources = sqliteTable(
  "sources",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    articleId: integer("article_id").notNull().references(() => articles.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    url: text("url").notNull(),
    title: text("title").notNull(),
    publisher: text("publisher").notNull(),
    publishedAt: integer("published_at", { mode: "timestamp_ms" }),
    origin: text("origin", { enum: ["search", "rss"] }).notNull(),
    /** Extracted text; grounding for article chat. */
    contentText: text("content_text").notNull(),
  },
  (t) => [index("sources_article_idx").on(t.articleId)],
);

export const seenUrls = sqliteTable(
  "seen_urls",
  {
    topicId: integer("topic_id").notNull().references(() => topics.id, { onDelete: "cascade" }),
    canonicalUrl: text("canonical_url").notNull(),
    firstSeenAt: integer("first_seen_at", { mode: "timestamp_ms" }).notNull().default(now),
  },
  (t) => [primaryKey({ columns: [t.topicId, t.canonicalUrl] })],
);

export const feedItems = sqliteTable(
  "feed_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** Null once the feed is removed; only saved items (incl. chatted ones) survive that. */
    feedId: integer("feed_id").references(() => feeds.id, { onDelete: "set null" }),
    /** Feed name snapshot, written when the feed is removed. */
    feedName: text("feed_name"),
    guid: text("guid").notNull(),
    url: text("url").notNull(),
    title: text("title").notNull(),
    author: text("author"),
    publishedAt: integer("published_at", { mode: "timestamp_ms" }),
    /** Feed-provided summary, plain text. */
    summary: text("summary"),
    contentHtml: text("content_html"),
    contentText: text("content_text"),
    extraction: text("extraction", { enum: ["pending", "ok", "fallback", "failed"] }).notNull().default("pending"),
    readAt: integer("read_at", { mode: "timestamp_ms" }),
    savedAt: integer("saved_at", { mode: "timestamp_ms" }),
    openedAt: integer("opened_at", { mode: "timestamp_ms" }),
    hasChat: integer("has_chat", { mode: "boolean" }).notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("feed_items_feed_guid_idx").on(t.feedId, t.guid), index("feed_items_published_idx").on(t.publishedAt)],
);

export const llmCalls = sqliteTable(
  "llm_calls",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    briefId: integer("brief_id").references(() => briefs.id, { onDelete: "set null" }),
    articleId: integer("article_id").references(() => articles.id, { onDelete: "set null" }),
    feedItemId: integer("feed_item_id").references(() => feedItems.id, { onDelete: "set null" }),
    role: text("role").notNull(),
    providerId: integer("provider_id"),
    model: text("model").notNull(),
    tokensIn: integer("tokens_in").notNull().default(0),
    tokensOut: integer("tokens_out").notNull().default(0),
    costUsd: real("cost_usd"),
    durationMs: integer("duration_ms").notNull(),
    ok: integer("ok", { mode: "boolean" }).notNull(),
    error: text("error"),
    createdAt: createdAt(),
  },
  (t) => [index("llm_calls_created_idx").on(t.createdAt)],
);

/** Chat history for "Chat with this article" — brief articles and RSS items. */
export const chatMessages = sqliteTable(
  "chat_messages",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    subjectType: text("subject_type", { enum: ["article", "feed_item"] }).notNull(),
    subjectId: integer("subject_id").notNull(),
    role: text("role", { enum: ["user", "assistant"] }).notNull(),
    content: text("content").notNull(),
    providerId: integer("provider_id"),
    model: text("model"),
    createdAt: createdAt(),
  },
  (t) => [index("chat_subject_idx").on(t.subjectType, t.subjectId, t.createdAt)],
);

/** Dashboard "Today's themes": one AI summary per day across all topics, regenerated when the day's articles change. */
export const dailyThemes = sqliteTable("daily_themes", {
  date: text("date").primaryKey(),
  /** Sorted article ids the themes were written from. */
  signature: text("signature").notNull(),
  themes: text("themes", { mode: "json" }).$type<{ title: string; summary: string; articleIds: number[] }[]>().notNull(),
  createdAt: createdAt(),
});
