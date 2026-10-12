# Development

## Setup

```bash
npm install
cp .env.example .env          # set DAILYBRIEF_SECRET (openssl rand -base64 32)
docker compose up -d searxng  # search sidecar, published on 127.0.0.1:8888 for the dev server
DATA_DIR=../../data npm run dev:server   # API on :8080, watch mode (reads ../../.env)
npm run dev:web               # Vite on :5173, proxies /api to :8080
```

Running outside Docker, an AI proxy on the same machine is `http://127.0.0.1:4000/v1` (inside Docker it is `http://host.docker.internal:4000/v1`). `data/` is gitignored.

## Checks

```bash
npm run typecheck                                  # all workspaces
npx tsc --noEmit -p apps/server --noUnusedLocals   # also catches dead locals/imports (likewise apps/web)
npm test                                           # server tests (node:test): auth, SSRF guard, feeds, dedupe, review, prices
npm run build                                      # web, then server bundle
```

Deploy the local checkout: `docker compose up -d --build`.

## Conventions

- **TypeScript:** no `any`; schemas and API types live in `packages/shared` (zod) and are shared by both sides.
- **Database changes:** edit `apps/server/src/db/schema.ts`, then `npm run db:generate -w @dailybrief/server -- --name <what_changed>`. Migrations are append-only once released; never edit or delete one. Anything Drizzle can't express (the `feed_items_fts` full-text table and triggers in `0000_baseline.sql`) is hand-written SQL in the migration.
- **Network fetches** from the server go through `net/safe-fetch.ts` (SSRF guard).
- **AI calls** go through `llm/router.ts` (role → model, usage recording, timeout).
- **User manual:** `README.html` (inline CSS using the app's `--color-*` variables) is built into the app as `/manual.html`. Describe every user-visible change there.

## Versioning and releases

The single source of the version is the root `package.json` `version` ([SemVer](https://semver.org/); pre-releases `1.0.0-beta.N`). The manual's two `<span data-version>` elements must match — the web build fails otherwise.

To release:

1. Bump `package.json` (`npm version --no-git-tag-version <version>`) and both `data-version` spans in `README.html`.
2. Add a section to `CHANGELOG.md`.
3. Typecheck, test, build; commit as `Release <version>`.
4. Tag: `git tag -a v<version> -m "DailyBrief <version>"`.

## Data

All state is in SQLite at `$DATA_DIR/dailybrief.db` (`/data` in the container, the `dailybrief_dailybrief-data` volume). Back up the volume together with `.env`: provider and search API keys are encrypted with `DAILYBRIEF_SECRET`. To start over with an empty install, remove the volume (`docker compose down && docker volume rm dailybrief_dailybrief-data`).
