import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import * as schema from "./schema.ts";

export type Db = BetterSQLite3Database<typeof schema>;

export function openDb(dataDir: string, migrationsDir: string): { db: Db; close: () => void } {
  mkdirSync(dataDir, { recursive: true });
  const sqlite = new Database(join(dataDir, "dailybrief.db"));
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("busy_timeout = 5000");
  const db = drizzle(sqlite, { schema });
  // Table rebuilds drop and recreate tables; with FK enforcement on, the DROP would cascade/null
  // into referencing rows. The pragma is ignored inside a transaction, so set it around the migrator.
  sqlite.pragma("foreign_keys = OFF");
  migrate(db, { migrationsFolder: migrationsDir });
  sqlite.pragma("foreign_keys = ON");
  const broken = sqlite.pragma("foreign_key_check");
  if (Array.isArray(broken) && broken.length) throw new Error(`Database foreign key check failed after migration (${broken.length} rows)`);
  return { db, close: () => sqlite.close() };
}
