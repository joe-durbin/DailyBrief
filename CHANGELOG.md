# Changelog

All notable changes to DailyBrief. Versions follow [Semantic Versioning](https://semver.org/); the version shown in the app and the manual comes from the root `package.json`.

## 1.0.0-beta.6 — 2026-10-16

### Fixed
- When the AI returns malformed or truncated article JSON, retry only that article once. Other articles and pipeline steps are not repeated; token usage for malformed responses is recorded when supplied by the provider. A second failure remains visible as a warning.

## 1.0.0-beta.5 — 2026-10-15

### Fixed
- **Most mentioned this week:** articles from deleted topics no longer contribute tags on the dashboard. The articles themselves are kept.

## 1.0.0-beta.4 — 2026-10-15

### Changed
- **Today's themes:** the dashboard panel now has a refresh icon to regenerate themes without touching briefs, including after a failed attempt. A pending run disables the icon, and failures show a retry message.
- Theme titles and summaries no longer have arbitrary character ceilings; empty text is still rejected. Opening the dashboard no longer starts a theme run on its own — scheduled or manually generated briefs still trigger the automatic update.

## 1.0.0-beta.3 — 2026-10-10

### Changed
- **AI time limits:** every AI call is now streamed and only stopped when it stalls — no data for 3 minutes — or when it is still running after 10 minutes (a guard against a stuck model running up costs). Long answers that keep arriving are no longer cut off (the old fixed 2-minute limit stopped large brief steps that were still producing). A timeout ends the whole brief straight away — calls in progress are cancelled and no further ones start — with the usual message and *Regenerate* / *Try again*.
- **Licence:** DailyBrief is published under the MIT licence.
- **Freshness:** a hard 7-day cutoff — the wider search pass looks back 7 days (was 14) and the "exceptional story up to 14 days old" rule is gone. Fewer sources per brief, so the AI's grouping step is shorter.

## 1.0.0-beta.2 — 2026-10-09

### Changed
- **Freshness:** briefs only include stories from the last 7 days; the researcher may keep a story up to 14 days old when it's exceptionally important or an exceptional match for your ratings. Every story is dated (the researcher estimates when no source gives a date) and the editor sees the dates. Previously undated search results could bring months-old research into a brief.
- **Better dates:** publication dates are now read from page metadata used by journals and news sites (`citation_*`, Dublin Core, `article:published_time`, JSON-LD) and from URLs (`/2026/10/07/`, arXiv ids); month-only dates are understood.
- Articles with no known date no longer show "Reported by <brief date>" (the brief date is shown in the calendar, Saved and Chats).
- **Times keep up:** "8 hours ago", "Today"/"Yesterday" headers, the brief's "Today" date and the dashboard greeting now update while a page stays open (every minute, and on returning to the tab); after midnight today's brief is fetched afresh.
- **RSS list:** each item shows its publication time (e.g. `14:32`) instead of "2 days ago", which repeated the day headers. Posts whose feed gives no time, or no date at all, show no time; undated posts are grouped under the day they were first found instead of a separate "Undated" heading.
- Brief size options renamed, in setup and Settings → Daily brief: *Full grid* → **Maximum coverage**, *Standouts only* → **Highlights only**, with plainer descriptions (stories, not cards). Your choice is kept.
- User manual: trimmed to the app itself — removed *Getting started* (first-run setup guides you instead), *Using an iPad* and *Upcoming features*.
- Dashboard: *Continue where you left off* now reads RSS, Saved, Chats — the same order as the top bar.
- *Connect your AI*: the example address for OpenAI-compatible providers is now a generic `https://ai.provider.com:1234/v1`.

### Fixed
- A topic waiting for another brief to finish (briefs are generated one at a time) showed "No brief yet" with a *Generate now* button; it now shows **Brief queued** — "pending generation, starts as soon as the brief ahead of it finishes" — and the header says it's waiting.
- An article saved from a brief or the RSS reader could be missing from Saved (and the dashboard's *Saved for later*) until the page was reloaded, if Saved had been opened in the previous 30 seconds.

## 1.0.0-beta.1 — 2026-10-09

First beta. A self-hosted, Dockerised app that reads the news for you: every morning each topic gets up to 15 deduplicated stories, each written up as a short sourced article.

### Features
- **Daily briefs** — per-topic 5×3 card grid, written by an AI research pipeline (query planning, SearXNG/RSS gathering, clustering, editorial selection, writing with validated citations, set review). Full grid or Standouts only; scheduled daily, with catch-up after downtime and manual Regenerate.
- **Triage** — save, ignore (never resurfaces) and thumbs up/down ratings that steer future selection; previous briefs via a calendar.
- **Article view** — sourced article with dated sources and an event date; chat with the AI about any article, including "Look further" web research.
- **RSS reader** — two-pane reader with full-text search, readable-text extraction, quiet-feed warnings and multi-select topic filters; manage feeds, with feed discovery from a site address.
- **Topics** — free-text description that steers searching, selection and writing; optional RSS feeds, or *Let AI pick*: preview suggested feeds, or let the brief pick them in the background as its first step.
- **Saved and Chats** — everything you saved or discussed, searchable and filterable by source.
- **Dashboard** — today's status, continue reading, AI-written themes of the day, mentions, the week at a glance and feed health.
- **AI providers** — Anthropic, OpenAI, Google Gemini, OpenRouter and any OpenAI-compatible endpoint (LiteLLM, Ollama…); default and per-step models; automatic per-model prices (editable) and a usage view. AI calls time out after 2 minutes.
- **First-run setup** — the first visitor creates the account, then picks a theme and brief size (timezone taken from the browser) and connects an AI provider; a welcome page guides you to your first topic.
- **Themes** — DailyBrief, Catppuccin Mocha / Latte, Dracula, Nord Snow Storm.
- **Security** — single account with argon2id passwords, revocable sessions, login throttling and lockout, CSRF origin checks, CSP; SSRF guard on all page/feed fetches; API keys encrypted at rest with `DAILYBRIEF_SECRET`.
- **User manual** — built in, behind the **?** button.

### Notes
- `.env` holds only `DAILYBRIEF_SECRET`; everything else is configured in the app.
- The database schema starts from a single baseline migration. Databases from pre-beta development builds can't be upgraded — start with an empty data volume.
