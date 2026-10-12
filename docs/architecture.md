# Architecture

DailyBrief is two containers: the app (`dailybrief`, Node 24) and a SearXNG metasearch sidecar. The app serves the web UI and a JSON/SSE API from one Fastify process and stores everything in one SQLite database in the `dailybrief-data` volume.

```
apps/server      Fastify API, generation pipeline, scheduler (TypeScript, run with Node type stripping; bundled with esbuild)
apps/web         React + Vite + Tailwind + Motion single-page app; the user manual (README.html) is built in as /manual.html
packages/shared  zod schemas and types shared by server and web
searxng/         SearXNG settings (JSON API on, image proxy and limiter off)
```

## Server (`apps/server/src`)

| Area | Files |
| --- | --- |
| Entry, config | `index.ts`, `app.ts`, `config.ts` (env: `DAILYBRIEF_SECRET`, `DATA_DIR`, `SEARXNG_URL`, `HOST`, `PORT`…) |
| Auth | `auth/` — single account, argon2id, server-side sessions, per-IP throttling and lockout, CSRF origin checks |
| Routes | `routes.ts` (settings, providers), `topics-routes.ts`, `briefs-routes.ts` (briefs, triage, SSE `/api/events`), `rss-routes.ts`, `chat-routes.ts` (streamed answers), `dashboard-routes.ts`, `data-routes.ts` (usage, stats, export) |
| Database | `db/schema.ts` (Drizzle), migrations in `apps/server/drizzle/` |
| AI | `llm/provider.ts` (Anthropic, OpenAI, Gemini, OpenRouter, OpenAI-compatible), `llm/router.ts` (role → model, usage accounting, limits: every call is streamed and stopped after 3 minutes without data or 10 minutes in total; a timeout ends the whole brief), `llm/errors.ts` |
| Network | `net/safe-fetch.ts` — every page/feed fetch goes through an SSRF guard (private, loopback and Docker addresses blocked on every redirect hop) |
| Secrets | `crypto.ts` — AES-256-GCM, key derived from `DAILYBRIEF_SECRET`; used for provider and search API keys |

## Brief generation (`pipeline/`)

`scheduler.ts` runs the daily brief cron (time and timezone from Settings → Schedule), feed polling, a 10-minute catch-up (topics without today's brief, at most two failures a day) and a weekly model-price refresh. `queue.ts` runs briefs one at a time.

`generate.ts` for one topic:

1. **Finding feeds** (only when the topic was saved with background *Let AI pick*) — `feed-suggest.ts` links suitable existing feeds and adds new ones.
2. **Planning searches** — the *researcher* model writes search queries from the topic description and learned preferences (ratings).
3. **Gathering** — SearXNG results plus the topic's RSS items, first for the last 3 days, widened to 7 if too few stories; pages are fetched and reduced to readable text (`extract.ts`) and dated from page metadata, structured data or the URL (`dates.ts`; a day beats a month, anything provably older than the window is dropped), deduplicated by canonical URL and pre-clustered lexically (`candidates.ts`).
4. **Clustering and scoring** — the *researcher* groups sources into stories and scores them (relevance, significance, substance, source quality, freshness, preference fit), and dates each story (`eventDate`, an educated guess when no source is dated). Stories older than 7 days are dropped; a story is never treated as fresher than its newest dated source. Stories seen in the last 14 days or ignored in the last 90 are dropped too.
5. **Selection** — the *editor* picks up to 15 from a shortlist, seeing each story's date (*Maximum coverage* tops up from the next-best; *Highlights only* may leave gaps).
6. **Writing** — the *writer* writes each article (three at a time) with citations validated against its sources.
7. **Final review** — the *editor* checks the set; duplicates and weak cards are rewritten or replaced by spares.

Progress is pushed to the browser over SSE. `themes.ts` writes the dashboard's themes of the day; `prices.ts` looks up per-model prices (provider, LiteLLM's public list, then OpenRouter; manual prices win).

## Web (`apps/web/src`)

`main.tsx` (routes), `api.ts` (API client), `pages/AuthScreen.tsx` (sign-in and account creation), `shell/` (top bar, topic sidebar, onboarding, manual), `views/` (Dashboard, Welcome, Briefs, RSS, Saved, Chats), `briefs/` (grid, cards, calendar), `rss/` (reader, Manage feeds), `chat/`, `topics/` (topic dialog), `settings/`, `lib/` (live events, theme, formatting, sanitising), `ui/` (shared controls). Server state lives in TanStack Query; live events invalidate the affected queries.
