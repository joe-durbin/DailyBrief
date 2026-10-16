import { z } from "zod";

export const PASSWORD_MIN_LENGTH = 12;

const credentialsSchema = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(1024),
});

export const loginSchema = credentialsSchema.extend({ remember: z.boolean().default(true) });
export const setupSchema = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`).max(1024),
});
export type AuthState = {
  setupRequired: boolean;
  authenticated: boolean;
  username?: string;
};

export type Topic = {
  id: number;
  name: string;
  description: string;
  accent: string;
  sortOrder: number;
  /** Today's cards still to triage. */
  remaining: number;
  generating: boolean;
  /** Today's brief hit an AI failure (failed, or stopped part-way): the reason shown to the reader. */
  warning: string | null;
};

export type Feed = {
  id: number;
  name: string;
  url: string;
  enabled: boolean;
  topicIds: number[];
  lastFetchedAt: number | null;
  lastError: string | null;
  unread: number;
  /** Saved items (incl. chatted ones) that survive removing this feed. */
  kept: number;
};

export type FeedPreview = { feedUrl: string; title: string | null; siteUrl: string | null; itemCount: number; latest: number | null };

export const feedCreateSchema = z.object({
  url: z.url(),
  name: z.string().trim().min(1).max(80),
});
export const feedPatchSchema = z.object({
  name: z.string().trim().min(1).max(80),
  enabled: z.boolean(),
}).partial();

export type FeedItemRow = {
  id: number;
  /** Null when the feed has been removed (the item was kept because it's saved). */
  feedId: number | null;
  feedName: string;
  title: string;
  url: string;
  publishedAt: number | null;
  /** Where the item sits in the list: its publication time, or when DailyBrief first saw it if the feed gave no date. */
  listedAt: number;
  read: boolean;
  saved: boolean;
};

export type FeedItemPage = { items: FeedItemRow[]; nextCursor: string | null };

export type FeedItemDetail = FeedItemRow & {
  author: string | null;
  summary: string | null;
  /** Untrusted third-party HTML: always sanitise before rendering. */
  contentHtml: string | null;
  extraction: "pending" | "ok" | "fallback" | "failed";
  words: number;
  hasChat: boolean;
};

export type ProviderKind = "anthropic" | "openai" | "gemini" | "openrouter" | "openai_compatible";

export const providerCreateSchema = z.object({
  name: z.string().trim().min(1).max(60),
  kind: z.enum(["anthropic", "openai", "gemini", "openrouter", "openai_compatible"]),
  baseUrl: z.url(),
  apiKey: z.string().max(500).default(""),
});
/** First-run "Connect your AI": try a connection before saving it. providerId + no apiKey = use that provider's stored key. */
export const connectionTestSchema = z.object({
  providerId: z.number().int().optional(),
  kind: z.enum(["anthropic", "openai", "gemini", "openrouter", "openai_compatible"]),
  baseUrl: z.url(),
  apiKey: z.string().max(500).optional(),
});
export type ConnectionTest = { ok: boolean; models: string[]; error?: string };

/** apiKey: omitted = keep; "" = clear. */
export const providerPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    baseUrl: z.url(),
    apiKey: z.string().max(500),
    enabled: z.boolean(),
  })
  .partial();

export type ProviderSummary = {
  id: number;
  name: string;
  kind: ProviderKind;
  baseUrl: string;
  enabled: boolean;
  hasKey: boolean;
};

// ---------- Model prices (Settings → AI) ----------
/** catalogue = LiteLLM's public price list; openrouter = OpenRouter's model list; provider = the provider's own figure; manual = entered by the reader. */
export type PriceSource = "catalogue" | "openrouter" | "provider" | "manual";

/** USD per million tokens; null = not known. */
export type ModelPriceRow = { model: string; input: number | null; output: number | null; source: PriceSource | null; checkedAt: number | null };
export type ModelPricesReport = { prices: ModelPriceRow[]; refreshing: boolean };

/** Set a price by hand (it becomes `manual` and is never overwritten by the lookup). */
export const modelPriceSetSchema = z.object({ model: z.string().min(1).max(200), input: z.number().min(0).max(10_000), output: z.number().min(0).max(10_000) });
export const modelPriceResetSchema = z.object({ model: z.string().min(1).max(200) });

export type ProviderCheck = {
  ok: boolean;
  /** Number of models the provider lists. */
  models: number;
  error?: string;
};

type BriefStatus = "queued" | "gathering" | "selecting" | "writing" | "complete" | "partial" | "failed" | "superseded";

export type ArticleCard = {
  id: number;
  slot: number;
  headline: string;
  summary: string;
  publisher: string;
  sourceCount: number;
  publishedAt: number | null;
  state: "active" | "saved" | "ignored";
  rating: "up" | "down" | null;
};

export type BriefInfo = {
  id: number;
  briefDate: string;
  status: BriefStatus;
  detail: string | null;
  progress: number;
  error: string | null;
  completedAt: number | null;
};

export type BriefView = {
  /** The brief whose cards are shown (latest finished, or the run currently writing). */
  brief: BriefInfo | null;
  /** A newer run in progress for this topic/date, if any. */
  running: BriefInfo | null;
  /** Always 15 entries; null = empty cell (not generated, ignored or saved). */
  slots: (ArticleCard | null)[];
  /** The latest run for this day hit an AI failure: reason + the provider's own message. */
  warning: string | null;
};

/** Settings → Briefs. "fill": always fill all 15 cards; "standout": only stories that stand out (may be fewer). */
const BRIEF_FILL_MODES = ["fill", "standout"] as const;
export type BriefFill = (typeof BRIEF_FILL_MODES)[number];

export const AI_ROLES = ["researcher", "editor", "writer", "chat"] as const;
export type AiRole = (typeof AI_ROLES)[number];

export const modelChoiceSchema = z.object({ providerId: z.number().int(), model: z.string().min(1) });
export type ModelChoice = z.infer<typeof modelChoiceSchema>;
export const roleChoicesSchema = z.partialRecord(z.enum(AI_ROLES), modelChoiceSchema);
/** Behaviour settings for the AI roles; model selection remains in Settings → AI. */
export const agentsSettingsSchema = z.object({
  researcher: z.enum(["quick", "balanced", "deep"]),
  writer: z.enum(["concise", "standard", "detailed"]),
  chat: z.enum(["brief", "standard", "detailed"]),
});
export type AgentsSettings = z.infer<typeof agentsSettingsSchema>;
export const DEFAULT_AGENTS_SETTINGS: AgentsSettings = { researcher: "balanced", writer: "standard", chat: "standard" };

export const SEARCH_PROVIDERS = ["searxng", "brave", "tavily", "exa"] as const;
export type SearchProvider = (typeof SEARCH_PROVIDERS)[number];

export const FEED_INTERVALS = [15, 30, 60] as const;

/** Settings → RSS. inactiveDays: a feed with no post for this long gets a "quiet feed" warning on the dashboard. */
export const rssSettingsSchema = z.object({ inactiveDays: z.number().int().min(7, "At least 7 days").max(365, "At most 365 days") });
export type RssSettings = z.infer<typeof rssSettingsSchema>;
export const DEFAULT_RSS_SETTINGS: RssSettings = { inactiveDays: 30 };

export const scheduleSchema = z.object({
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  timezone: z.string().min(1),
  feedMinutes: z.union([z.literal(15), z.literal(30), z.literal(60)]),
});
export type Schedule = z.infer<typeof scheduleSchema>;

export type AppSettings = {
  briefFill: BriefFill;
  ai: { default: ModelChoice | null; roles: Partial<Record<AiRole, ModelChoice>> };
  agents: AgentsSettings;
  search: { provider: SearchProvider; hasKey: boolean };
  schedule: Schedule;
  rss: RssSettings;
  /** First-run setup (look & feel, AI connection) has been completed or skipped. */
  onboarded: boolean;
};

export const settingsPatchSchema = z
  .object({
    briefFill: z.enum(BRIEF_FILL_MODES),
    ai: z.object({ default: modelChoiceSchema, roles: roleChoicesSchema }).partial(),
    agents: agentsSettingsSchema,
    /** apiKey: omitted = keep the stored key; "" = remove it. */
    search: z.object({ provider: z.enum(SEARCH_PROVIDERS), apiKey: z.string().max(500).optional() }),
    schedule: scheduleSchema,
    rss: rssSettingsSchema,
    onboarded: z.literal(true),
  })
  .partial();

type ArticleSource = { position: number; url: string; title: string; publisher: string; publishedAt: number | null };

export type ArticleDetail = {
  id: number;
  briefId: number;
  briefDate: string;
  topicId: number;
  topicName: string;
  headline: string;
  summary: string;
  bodyMd: string;
  publishedAt: number | null;
  /** publishedAt is estimated by the writer (no source carried a date). */
  dateApprox: boolean;
  createdAt: number;
  state: ArticleCard["state"];
  rating: ArticleCard["rating"];
  sources: ArticleSource[];
  /** Has a conversation, so it lives in Chats. */
  hasChat: boolean;
};

export const ratingSchema = z.object({ rating: z.enum(["up", "down"]).nullable() });

/** Server-sent events on /api/events. */
export type AppEvent =
  | { type: "brief.status"; topicId: number; briefId: number; status: string; detail: string | null; progress: number }
  | { type: "article.ready" | "article.updated" | "article.removed"; topicId: number; briefId: number; articleId: number; slot: number }
  | { type: "themes.ready" | "themes.failed"; date: string };

export const TOPIC_ACCENTS = ["#7C8CFF", "#2DD4BF", "#F59E0B", "#F472B6", "#38BDF8", "#A78BFA", "#34D399", "#FB7185"] as const;

export const topicCreateSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(40, "Keep the name to 40 characters"),
  description: z.string().trim().min(20, "Describe the topic in at least 20 characters").max(1000, "Keep the description under 1000 characters"),
  accent: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  feedIds: z.array(z.number().int()).default([]),
  /** Pick feeds with AI in the background before the next brief (instead of previewing in the dialog). */
  autoFeeds: z.boolean().default(false),
});
export const topicPatchSchema = topicCreateSchema.partial().extend({ regenerate: z.boolean().optional() });
export const topicOrderSchema = z.object({ ids: z.array(z.number().int()).min(1) });

export type TopicDetail = Topic & { feedIds: number[] };

/** "Let AI pick" in the topic dialog: the topic as typed so far (it may not be saved yet). */
export const feedSuggestSchema = z.object({ name: z.string().trim().min(1).max(40), description: z.string().trim().min(20).max(1000) });

export type FeedSuggestions = {
  /** Already-configured feeds the AI judged relevant. quiet = newest post older than the RSS quiet threshold (flagged, not pre-ticked). */
  existing: { feedId: number; name: string; reason: string; lastPostAt: number | null; quiet: boolean }[];
  /** New feeds found and checked: they parse, aren't already configured and posted within the quiet threshold. */
  discovered: { feedUrl: string; siteUrl: string | null; name: string; reason: string; lastPostAt: number; itemCount: number }[];
  /** Candidates dropped after checking (no feed, unreachable, quiet, duplicate). */
  rejected: { name: string; url: string; why: string }[];
  inactiveDays: number;
};

export type SavedEntry =
  | { kind: "article"; id: number; title: string; summary: string; source: string; topicName: string; topicId: number; savedAt: number; publishedAt: number | null; rating: "up" | "down" | null }
  | { kind: "feed-item"; id: number; title: string; summary: string | null; source: string; savedAt: number; publishedAt: number | null };

export type SavedPage = { items: SavedEntry[]; nextCursor: string | null };

export type BriefDate = { date: string; status: BriefStatus };

/** An article with a conversation (Chats mode). */
export type ChatEntry = {
  kind: "article" | "feed-item";
  id: number;
  title: string;
  /** Topic name for brief articles, feed name for RSS items. */
  source: string;
  topicId: number | null;
  lastQuestion: string;
  lastAt: number;
  messages: number;
};

export type ChatsPage = { items: ChatEntry[]; nextCursor: string | null };

export type ChatMessage = { id: number; role: "user" | "assistant"; content: string; createdAt: number };

export const chatPostSchema = z.object({
  message: z.string().trim().min(1).max(4000),
  /** Also search the web for this question and use the results as extra sources. */
  lookFurther: z.boolean().default(false),
});

/** Appended (in italics) to a Look further answer when the web search found nothing relevant; the UI shows it as a note. */
export const LOOK_FURTHER_NONE = "Look further: no additional sources found — this answer uses the article and its sources only.";

/** Events on the POST …/chat response stream. */
export type ChatStreamEvent = { type: "delta"; text: string } | { type: "done"; message: ChatMessage } | { type: "error"; error: string };

export const passwordChangeSchema = z.object({
  current: z.string().min(1, "Enter your current password"),
  next: z.string().min(PASSWORD_MIN_LENGTH, `New password must be at least ${PASSWORD_MIN_LENGTH} characters`).max(1024),
});

export type SessionSummary = { id: string; device: string; ip: string | null; lastSeenAt: number; current: boolean };

/** costUsd is null when none of the calls had a price set (the model is unpriced, or the calls predate its price). */
export type UsageReport = {
  days: { date: string; calls: number; tokensIn: number; tokensOut: number; costUsd: number | null }[];
  byModel: { role: string; model: string; calls: number; tokensIn: number; tokensOut: number; failed: number; costUsd: number | null }[];
  perBrief: { briefs: number; avgTokens: number; avgCostUsd: number | null };
  totalCostUsd: number | null;
};

export type StorageStats = { briefs: number; articles: number; saved: number; feedItems: number; chats: number; dbBytes: number };

// ---------- Dashboard ----------

export type DashboardTopic = {
  id: number;
  name: string;
  accent: string;
  status: "ready" | "generating" | "warning" | "none";
  warning: string | null;
  remaining: number;
};

type DashboardTheme = { title: string; summary: string; articles: { id: number; headline: string; topicId: number }[] };
export type Mention = { name: string; count: number; trend: "new" | "up" | "steady" };
export type DashboardKept = { kind: "article" | "feed-item"; id: number; title: string; source: string; savedAt: number };

export type Dashboard = {
  date: string;
  /** Nothing yet (no topics, feeds, saved articles or chats): show the welcome page. */
  empty: boolean;
  /** A default AI model is set on an enabled provider. */
  aiReady: boolean;
  topics: DashboardTopic[];
  rssUnread: number;
  themes: { status: "ready" | "pending" | "failed" | "none"; items: DashboardTheme[] };
  mentions: Mention[];
  continue: {
    chat: { kind: "article" | "feed-item"; id: number; title: string; lastQuestion: string; at: number } | null;
    read: { id: number; title: string; feedName: string; at: number } | null;
    /** Saved (not chatted) and not opened since saving, newest first. */
    saved: DashboardKept[];
  };
  week: {
    days: { date: string; opened: number; saved: number; ignored: number; rssRead: number }[];
    ratings: { up: number; down: number };
    topPublishers: { name: string; up: number }[];
    chats: number;
    savedTotal: number;
  };
  /** Settings → RSS: days without a post before a feed counts as quiet. */
  inactiveDays: number;
  /** Enabled feeds whose newest post is older than `inactiveDays` (and not dismissed since). */
  inactiveFeeds: { id: number; name: string; lastPostAt: number | null; topics: string[] }[];
  health: {
    runs: { topicId: number; topicName: string; status: BriefStatus; startedAt: number; durationMs: number | null; cards: number }[];
    /** Today's AI use per model actually called. */
    aiToday: { provider: string; model: string; calls: number; tokensIn: number; tokensOut: number; costUsd: number | null }[];
    failingFeeds: { id: number; name: string; error: string }[];
  };
};
