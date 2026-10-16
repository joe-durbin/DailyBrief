import { agentsSettingsSchema, DEFAULT_AGENTS_SETTINGS, DEFAULT_RSS_SETTINGS, modelChoiceSchema, roleChoicesSchema, rssSettingsSchema, scheduleSchema, SEARCH_PROVIDERS, type AgentsSettings, type AppSettings, type RssSettings, type Schedule, type SearchProvider } from "@dailybrief/shared";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { SecretBox } from "./crypto.ts";
import type { Db } from "./db/index.ts";
import { settings } from "./db/schema.ts";
import { readBriefFill } from "./pipeline/generate.ts";

const searchStored = z.object({ provider: z.enum(SEARCH_PROVIDERS), keyEnc: z.string().nullable() });

const DEFAULT_SCHEDULE: Schedule = { time: "05:00", timezone: "UTC", feedMinutes: 30 };

export function readSetting(db: Db, key: string): unknown {
  return db.select({ value: settings.value }).from(settings).where(eq(settings.key, key)).get()?.value;
}

export function writeSetting(db: Db, key: string, value: unknown): void {
  db.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value } }).run();
}

export function readSchedule(db: Db): Schedule {
  return scheduleSchema.safeParse(readSetting(db, "schedule")).data ?? DEFAULT_SCHEDULE;
}

export function readRssSettings(db: Db): RssSettings {
  return rssSettingsSchema.safeParse(readSetting(db, "rss")).data ?? DEFAULT_RSS_SETTINGS;
}
export function readAgentSettings(db: Db): AgentsSettings {
  return agentsSettingsSchema.safeParse(readSetting(db, "agents")).data ?? DEFAULT_AGENTS_SETTINGS;
}

/** Search provider and its decrypted API key (SearXNG needs none). */
export function readSearch(db: Db, box: SecretBox): { provider: SearchProvider; apiKey: string } {
  const s = searchStored.safeParse(readSetting(db, "search")).data;
  return { provider: s?.provider ?? "searxng", apiKey: s?.keyEnc ? box.open(s.keyEnc) : "" };
}

export function readAppSettings(db: Db): AppSettings {
  const search = searchStored.safeParse(readSetting(db, "search")).data;
  return {
    briefFill: readBriefFill(db),
    ai: {
      default: modelChoiceSchema.safeParse(readSetting(db, "ai.default")).data ?? null,
      roles: roleChoicesSchema.safeParse(readSetting(db, "ai.roles") ?? {}).data ?? {},
    },
    agents: readAgentSettings(db),
    search: { provider: search?.provider ?? "searxng", hasKey: !!search?.keyEnc },
    schedule: readSchedule(db),
    rss: readRssSettings(db),
    onboarded: readSetting(db, "onboarding.done") === true,
  };
}

export function writeSearch(db: Db, box: SecretBox, patch: { provider: SearchProvider; apiKey?: string }): void {
  const current = searchStored.safeParse(readSetting(db, "search")).data;
  const keyEnc = patch.apiKey === undefined ? (current?.keyEnc ?? null) : patch.apiKey ? box.seal(patch.apiKey) : null;
  writeSetting(db, "search", { provider: patch.provider, keyEnc });
}
