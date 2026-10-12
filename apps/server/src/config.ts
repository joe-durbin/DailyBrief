import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().int().default(8080),
  HOST: z.string().default("0.0.0.0"),
  DATA_DIR: z.string().default("./data"),
  /** Built SPA directory; unset in dev (Vite serves the UI). */
  WEB_DIST: z.string().optional(),
  // src/ and dist/ are siblings, so these relative defaults hold for both `node src/index.ts` and the bundle.
  MIGRATIONS_DIR: z.string().default(new URL("../drizzle/", import.meta.url).pathname),
  /** SearXNG base URL; the compose file points this at the sidecar. */
  SEARXNG_URL: z.string().default("http://127.0.0.1:8888"),
  PIPELINE_CONCURRENCY: z.coerce.number().int().min(1).max(4).default(1),
  DAILYBRIEF_SECRET: z.string().min(32, "DAILYBRIEF_SECRET must be at least 32 characters"),
  /** Base of the progressive login delay (doubles per failure after the 3rd). */
  LOGIN_DELAY_BASE_MS: z.coerce.number().int().min(0).default(1000),
  LOG_LEVEL: z.string().default("info"),
});

export type Config = z.infer<typeof envSchema>;

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  return envSchema.parse(env);
}
