# DailyBrief

A self-hosted daily news brief. You describe the topics you follow; every morning DailyBrief researches each one and gives you up to 15 deduplicated stories as a grid of cards, each a short article with its sources. Open one to read it, chat with the AI about it, then save or ignore it. A two-pane RSS reader, saved articles, chats and a dashboard sit alongside. Runs in Docker on your home network; use it from any modern browser, on a computer or a tablet.

**Status:** beta (1.0.0-beta.3) — see [CHANGELOG.md](CHANGELOG.md). The full user manual is built into the app (the **?** button) and is [README.html](README.html) in this repository.

## Requirements

- Docker with Compose.
- An AI provider: an API key for Anthropic, OpenAI, Google Gemini or OpenRouter, or any OpenAI-compatible endpoint (a LiteLLM proxy, Ollama, …).

Web search uses the bundled SearXNG container; no key needed.

## Install

```bash
git clone gh repo clone joe-durbin/DailyBrief && cd DailyBrief
cp .env.example .env
# set DAILYBRIEF_SECRET in .env:  openssl rand -base64 32
docker compose up -d --build
```

Open `http://<host-ip>:8080` and follow the first-run setup:

1. **Create the account** — whoever opens it first chooses the username and password (single-user app).
2. **Make it yours** — theme and brief size; your timezone is taken from the browser.
3. **Connect your AI** — provider type, address and key, **Test connection**, then pick the default model. Can be skipped and done later in Settings → AI.

A new install has no topics or feeds; the dashboard's welcome page walks you through creating your first topic. Its brief is written straight away, then every day at 05:00 (Settings → Schedule).

### `.env`

`.env` holds a single setting, `DAILYBRIEF_SECRET`, which encrypts the API keys stored in the database. Keep it with your backups: if it changes, the keys must be entered again (nothing else is lost). Everything else — account, AI providers and models, search, schedule — is configured in the app.

### Using a LiteLLM proxy (or another OpenAI-compatible server) on the same machine

Choose **OpenAI-compatible** and use `http://host.docker.internal:4000/v1` as the address (inside Docker, `127.0.0.1` is the container itself). Make the proxy listen on `0.0.0.0` (with a key) or on the Docker bridge address.

## Settings at a glance

| Tab | What it controls |
| --- | --- |
| Daily brief | Maximum coverage (always aim for 15 stories) or Highlights only |
| Appearance | Theme: DailyBrief, Catppuccin Mocha / Latte, Dracula, Nord Snow Storm |
| AI | Default model, per-step models (Researcher / Editor / Writer / Chat), providers, and automatically looked-up per-model prices (editable). There is no automatic backup model: if a provider fails, the brief or chat says why |
| Search | SearXNG (built in, no key), Brave, Tavily or Exa |
| Schedule | Brief time and timezone, RSS check interval, Run all now |
| RSS | Days without a post before a feed is flagged as quiet |
| Usage | DailyBrief's AI use and estimated cost over the last 30 days, by step and model |
| Account | Password, signed-in devices |
| Data | Export saved articles (Markdown / JSON), storage stats |

## Operating

```bash
docker compose logs -f dailybrief     # watch briefs being generated
git pull && docker compose up -d --build   # update
```

Data lives in the `dailybrief_dailybrief-data` Docker volume (SQLite). Back it up together with `.env`:

```bash
docker run --rm -v dailybrief_dailybrief-data:/d -v "$PWD":/b alpine tar czf /b/dailybrief-backup.tgz -C /d .
```

## Security notes

- Login is required for everything; one account; sessions can be revoked in Settings → Account. Repeated failed logins lock the address out for 15 minutes.
- Served over plain HTTP on your LAN. Don't expose port 8080 to the internet; Docker-published ports bypass `ufw`, so restrict at the router if the host has a public interface.
- Page and feed fetching blocks private, loopback and Docker addresses (SSRF guard). If your AI proxy listens on all interfaces, protect it with a key.
- Article HTML from feeds is sanitised in the browser; AI output is rendered as sanitised Markdown.

## Documentation

- User manual: in the app (**?**), or [README.html](README.html)
- [CHANGELOG.md](CHANGELOG.md)
- [docs/architecture.md](docs/architecture.md) — how it works
- [docs/development.md](docs/development.md) — building, testing, releasing

## Licence

[MIT](LICENSE) © 2026 Joe Durbin
