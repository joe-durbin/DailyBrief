import { hash, verify } from "@node-rs/argon2";
import { and, desc, eq, gt, lt, ne, sql } from "drizzle-orm";
import { randomToken, sha256 } from "../crypto.ts";
import type { Db } from "../db/index.ts";
import { loginAttempts, sessions, users } from "../db/schema.ts";

const DAY = 86_400_000;
const REMEMBER_TTL = 30 * DAY;
const SESSION_IDLE_TTL = 12 * 3_600_000;
const LAST_SEEN_WRITE_INTERVAL = 60_000;
const THROTTLE_WINDOW = 15 * 60_000;
const DELAY_AFTER_FAILURES = 3;
const LOCK_AFTER_FAILURES = 10;
const MAX_DELAY_MS = 8_000;

export type SessionUser = { id: number; username: string; sessionId: string };
type Throttle = { lockedForMs: number; delayMs: number };

export interface AuthService {
  hasUser(): boolean;
  /** Create the single account (first-run setup). */
  createUser(username: string, password: string): Promise<number>;
  verifyCredentials(username: string, password: string): Promise<number | null>;
  throttle(ip: string, now?: number): Throttle;
  recordAttempt(ip: string, success: boolean): void;
  createSession(userId: number, remember: boolean, meta: { userAgent?: string; ip?: string }): { token: string; expiresAt: Date };
  resolveSession(token: string): SessionUser | null;
  deleteSession(sessionId: string): void;
  listSessions(userId: number): SessionInfo[];
  /** Verify the current password, set the new one and sign out every other session. */
  changePassword(userId: number, current: string, next: string, keepSessionId: string): Promise<boolean>;
  deleteOtherSessions(userId: number, keepSessionId: string): number;
}

type SessionInfo = { id: string; userAgent: string | null; ip: string | null; createdAt: Date; lastSeenAt: Date; remember: boolean };

export function createAuthService(db: Db, opts: { delayBaseMs: number }): AuthService {
  const hasUser = () => db.select({ id: users.id }).from(users).limit(1).get() !== undefined;

  return {
    hasUser,

    async createUser(username: string, password: string): Promise<number> {
      const row = db.insert(users).values({ username, passwordHash: await hash(password) }).returning({ id: users.id }).get();
      return row.id;
    },

    /** Constant-ish work regardless of whether the user exists, so usernames can't be probed by timing. */
    async verifyCredentials(username: string, password: string): Promise<number | null> {
      const user = db.select().from(users).where(sql`lower(${users.username}) = lower(${username})`).get();
      const ok = await verify(user?.passwordHash ?? DUMMY_HASH, password).catch(() => false);
      return user && ok ? user.id : null;
    },

    throttle(ip: string, now = Date.now()): Throttle {
      const lastSuccess = db
        .select({ at: loginAttempts.attemptedAt })
        .from(loginAttempts)
        .where(and(eq(loginAttempts.ip, ip), eq(loginAttempts.success, true)))
        .orderBy(desc(loginAttempts.attemptedAt))
        .limit(1)
        .get();
      const since = Math.max(now - THROTTLE_WINDOW, lastSuccess?.at.getTime() ?? 0);
      const failures = db
        .select({ attemptedAt: loginAttempts.attemptedAt })
        .from(loginAttempts)
        .where(and(eq(loginAttempts.ip, ip), eq(loginAttempts.success, false), gt(loginAttempts.attemptedAt, new Date(since))))
        .orderBy(desc(loginAttempts.attemptedAt))
        .all();
      if (failures.length >= LOCK_AFTER_FAILURES) {
        const newest = failures[0]?.attemptedAt.getTime() ?? now;
        return { lockedForMs: Math.max(0, newest + THROTTLE_WINDOW - now), delayMs: 0 };
      }
      const over = failures.length - DELAY_AFTER_FAILURES;
      return { lockedForMs: 0, delayMs: over >= 0 ? Math.min(opts.delayBaseMs * 2 ** over, MAX_DELAY_MS) : 0 };
    },

    recordAttempt(ip: string, success: boolean): void {
      db.insert(loginAttempts).values({ ip, success, attemptedAt: new Date() }).run();
      db.delete(loginAttempts).where(lt(loginAttempts.attemptedAt, new Date(Date.now() - DAY))).run();
    },

    createSession(userId: number, remember: boolean, meta: { userAgent?: string; ip?: string }): { token: string; expiresAt: Date } {
      const token = randomToken(32);
      const expiresAt = new Date(Date.now() + (remember ? REMEMBER_TTL : SESSION_IDLE_TTL));
      db.insert(sessions).values({ id: sha256(token), userId, remember, expiresAt, userAgent: meta.userAgent, ip: meta.ip }).run();
      return { token, expiresAt };
    },

    /** Validates the cookie token and slides the expiry window. */
    resolveSession(token: string): SessionUser | null {
      const id = sha256(token);
      const row = db
        .select({ id: sessions.id, userId: sessions.userId, username: users.username, expiresAt: sessions.expiresAt, lastSeenAt: sessions.lastSeenAt, remember: sessions.remember })
        .from(sessions)
        .innerJoin(users, eq(users.id, sessions.userId))
        .where(eq(sessions.id, id))
        .get();
      const now = Date.now();
      if (!row) return null;
      if (row.expiresAt.getTime() <= now) {
        db.delete(sessions).where(eq(sessions.id, id)).run();
        return null;
      }
      if (now - row.lastSeenAt.getTime() > LAST_SEEN_WRITE_INTERVAL) {
        const expiresAt = new Date(now + (row.remember ? REMEMBER_TTL : SESSION_IDLE_TTL));
        db.update(sessions).set({ lastSeenAt: new Date(now), expiresAt }).where(eq(sessions.id, id)).run();
      }
      return { id: row.userId, username: row.username, sessionId: id };
    },

    deleteSession(sessionId: string): void {
      db.delete(sessions).where(eq(sessions.id, sessionId)).run();
    },

    listSessions(userId) {
      return db
        .select({ id: sessions.id, userAgent: sessions.userAgent, ip: sessions.ip, createdAt: sessions.createdAt, lastSeenAt: sessions.lastSeenAt, remember: sessions.remember })
        .from(sessions)
        .where(and(eq(sessions.userId, userId), gt(sessions.expiresAt, new Date())))
        .orderBy(desc(sessions.lastSeenAt))
        .all();
    },

    async changePassword(userId, current, next, keepSessionId) {
      const user = db.select().from(users).where(eq(users.id, userId)).get();
      if (!user || !(await verify(user.passwordHash, current).catch(() => false))) return false;
      db.update(users).set({ passwordHash: await hash(next), passwordChangedAt: new Date() }).where(eq(users.id, userId)).run();
      db.delete(sessions).where(and(eq(sessions.userId, userId), ne(sessions.id, keepSessionId))).run();
      return true;
    },

    deleteOtherSessions(userId, keepSessionId) {
      return db.delete(sessions).where(and(eq(sessions.userId, userId), ne(sessions.id, keepSessionId))).run().changes;
    },
  };
}

// argon2id hash of a random throwaway value; used so unknown usernames cost the same as known ones.
const DUMMY_HASH = await hash(randomToken(16));
