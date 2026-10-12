import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import fastifyStatic from "@fastify/static";
import { registerDashboardRoutes } from "./dashboard-routes.ts";
import { createPriceRefresher, type PriceRefresher } from "./pipeline/prices.ts";
import { createThemes } from "./pipeline/themes.ts";
import Fastify, { type FastifyInstance } from "fastify";
import { registerAuth } from "./auth/routes.ts";
import { createAuthService, type AuthService } from "./auth/service.ts";
import type { Config } from "./config.ts";
import { makeSecretBox } from "./crypto.ts";
import { openDb, type Db } from "./db/index.ts";
import { registerBriefRoutes } from "./briefs-routes.ts";
import { createEventBus } from "./events.ts";
import { registerChatRoutes } from "./chat-routes.ts";
import { registerDataRoutes } from "./data-routes.ts";
import { createLlmRouter } from "./llm/router.ts";
import { createBriefQueue, type BriefQueue } from "./pipeline/queue.ts";
import { createSearch } from "./pipeline/search.ts";
import { registerRoutes, type SettingsHooks } from "./routes.ts";
import { registerRssRoutes } from "./rss-routes.ts";
import { registerTopicRoutes } from "./topics-routes.ts";

type BuiltApp = { app: FastifyInstance; auth: AuthService; db: Db; queue: BriefQueue; hooks: SettingsHooks; prices: PriceRefresher };

export async function buildApp(config: Config, opts: { logger?: boolean } = {}): Promise<BuiltApp> {
  const app = Fastify({
    logger: opts.logger === false ? false : { level: config.LOG_LEVEL },
    // Caddy (optional HTTPS profile) sets X-Forwarded-Proto so cookies get `Secure`.
    trustProxy: true,
  });
  const { db, close } = openDb(config.DATA_DIR, config.MIGRATIONS_DIR);
  app.addHook("onClose", async () => close());

  const box = makeSecretBox(config.DAILYBRIEF_SECRET);

  const auth = createAuthService(db, { delayBaseMs: config.LOGIN_DELAY_BASE_MS });

  await app.register(helmet, {
    // Served over plain HTTP on the LAN by default: HSTS / upgrade-insecure-requests would break that.
    hsts: false,
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https:"],
        fontSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        // Same-origin only: the in-app help dialog frames /manual.html; other sites still can't frame DailyBrief.
        frameAncestors: ["'self'"],
      },
    },
  });
  await app.register(cookie);

  app.get("/healthz", async () => ({ ok: true }));
  registerAuth(app, auth);
  const events = createEventBus();
  const llm = createLlmRouter(db, box);
  const search = createSearch(db, box, config.SEARXNG_URL);
  const themes = createThemes({ db, llm, events, log: app.log });
  // When the day's briefs are done, write the dashboard's cross-topic themes.
  const queue = createBriefQueue({ db, llm, events, log: app.log, search }, config.PIPELINE_CONCURRENCY, () => themes.refresh());
  // The scheduler is started after listen (index.ts) and plugs itself in here.
  const hooks: SettingsHooks = { onScheduleChange: () => {} };
  const prices = createPriceRefresher({ db, box, log: app.log });
  registerRoutes(app, db, box, queue, config.SEARXNG_URL, hooks, prices);
  registerBriefRoutes(app, db, queue, events);
  registerRssRoutes(app, db);
  registerTopicRoutes(app, db, queue, { llm, search });
  registerChatRoutes(app, db, llm, search);
  registerDataRoutes(app, db);
  registerDashboardRoutes(app, db, queue, themes);

  if (config.WEB_DIST) {
    await app.register(fastifyStatic, { root: config.WEB_DIST, wildcard: false });
    app.setNotFoundHandler((req, reply) =>
      req.url.startsWith("/api/") ? reply.code(404).send({ error: "Not found" }) : reply.sendFile("index.html"),
    );
  }

  return { app, auth, db, queue, hooks, prices };
}
