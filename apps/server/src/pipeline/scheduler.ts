import { Cron } from "croner";
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";
import type { Db } from "../db/index.ts";
import { briefs, topics } from "../db/schema.ts";
import { readSchedule } from "../settings.ts";
import { pollFeeds, preExtract } from "./feeds.ts";
import { localDate } from "./generate.ts";
import type { PriceRefresher } from "./prices.ts";
import type { BriefQueue } from "./queue.ts";

const IN_FLIGHT = ["queued", "gathering", "selecting", "writing"] as const;
const MAX_DAILY_FAILURES = 2;

export type Scheduler = { stop(): void; /** Re-read Settings → Schedule (time, timezone, feed interval). */ reschedule(): void };

/** Daily briefs, feed polling and catch-up, all driven by Settings → Schedule. */
export function startScheduler(db: Db, queue: BriefQueue, prices: PriceRefresher, log: FastifyBaseLogger): Scheduler {
  // A restart mid-run leaves briefs that will never finish.
  const stale = db.update(briefs).set({ status: "failed", error: "Interrupted by a restart", completedAt: new Date(), detail: null }).where(inArray(briefs.status, [...IN_FLIGHT])).run();
  if (stale.changes) log.warn({ count: stale.changes }, "marked interrupted briefs as failed");

  const activeTopics = () => db.select({ id: topics.id }).from(topics).where(isNull(topics.deletedAt)).all();
  // Poll, then prepare reader content for new items so opening them is instant.
  const refreshFeeds = (maxAgeMs: number) =>
    pollFeeds(db, log, { maxAgeMs })
      .then(() => preExtract(db, log))
      .catch((e) => log.warn({ err: String(e) }, "feed refresh failed"));

  let jobs: Cron[] = [];
  let briefCron = "";

  // Catch-up: today's scheduled time has passed but a topic has no brief today. Runs at boot and every
  // 10 minutes, so a container started late or a host that slept through the brief time still gets today's brief.
  // Capped at MAX_DAILY_FAILURES failed attempts per topic per day so a broken provider can't loop.
  const catchUp = () => {
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    const todaysRun = new Cron(briefCron, { paused: true }).nextRun(midnight);
    const today = localDate();
    if (!todaysRun || localDate(todaysRun) !== today || todaysRun.getTime() > Date.now()) return;
    for (const t of activeTopics()) {
      const statuses = db.select({ status: briefs.status }).from(briefs).where(and(eq(briefs.topicId, t.id), eq(briefs.briefDate, today))).all().map((b) => b.status);
      const hasBrief = statuses.some((s) => s !== "failed" && s !== "superseded");
      const failures = statuses.filter((s) => s === "failed").length;
      if (!hasBrief && failures < MAX_DAILY_FAILURES && queue.enqueue(t.id, "catch_up")) log.info({ topicId: t.id }, "catch-up brief queued");
    }
  };

  const schedule = () => {
    for (const j of jobs) j.stop();
    const s = readSchedule(db);
    // The timezone setting drives both the cron and brief dates (Node re-reads process.env.TZ when it changes).
    process.env.TZ = s.timezone;
    const [hh, mm] = s.time.split(":").map(Number);
    briefCron = `${mm} ${hh} * * *`;
    const feedMs = s.feedMinutes * 60_000;
    jobs = [
      new Cron(briefCron, { protect: true }, () => {
        log.info("scheduled brief generation");
        for (const t of activeTopics()) queue.enqueue(t.id, "scheduled");
      }),
      new Cron(`*/${s.feedMinutes} * * * *`, { protect: true }, () => void refreshFeeds(feedMs - 5 * 60_000)),
      new Cron("*/10 * * * *", { protect: true }, catchUp),
      // Model prices change rarely: look them up weekly, early Sunday (and once at start-up, below).
      new Cron("30 3 * * 0", { protect: true }, () => prices.refresh()),
    ];
    log.info({ nextBrief: jobs[0]?.nextRun()?.toISOString(), timezone: s.timezone, feedMinutes: s.feedMinutes }, "scheduler (re)configured");
  };

  schedule();
  catchUp();
  prices.refresh();
  void refreshFeeds(25 * 60_000);

  return {
    stop: () => jobs.forEach((j) => j.stop()),
    reschedule: schedule,
  };
}
