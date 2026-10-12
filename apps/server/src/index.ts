import { buildApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { startScheduler } from "./pipeline/scheduler.ts";

const config = loadConfig();
const { app, auth, db, queue, hooks, prices } = await buildApp(config);

if (!auth.hasUser()) app.log.warn("No account yet: open DailyBrief in a browser to create one.");

await app.listen({ host: config.HOST, port: config.PORT });
const scheduler = startScheduler(db, queue, prices, app.log);
hooks.onScheduleChange = scheduler.reschedule;

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    scheduler.stop();
    void app.close().then(() => process.exit(0));
  });
}
