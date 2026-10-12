import { loginSchema, passwordChangeSchema, setupSchema, type AuthState, type SessionSummary } from "@dailybrief/shared";
import { z } from "zod";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { setTimeout as sleep } from "node:timers/promises";
import type { AuthService, SessionUser } from "./service.ts";

const SESSION_COOKIE = "db_session";
const PUBLIC_API = new Set(["/api/auth/state", "/api/auth/login", "/api/auth/setup"]);
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

declare module "fastify" {
  interface FastifyRequest {
    user: SessionUser | null;
  }
}

function setSessionCookie(req: FastifyRequest, reply: FastifyReply, session: { token: string; expiresAt: Date }, remember: boolean) {
  reply.setCookie(SESSION_COOKIE, session.token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: req.protocol === "https",
    // Without "remember", a browser-session cookie; the server still enforces the idle timeout.
    ...(remember ? { expires: session.expiresAt } : {}),
  });
}

/** "Safari on iPad", "Chrome on Linux" … from a User-Agent string. */
function describeDevice(ua: string | null): string {
  if (!ua) return "Unknown device";
  const os = /iPad/.test(ua) ? "iPad" : /iPhone/.test(ua) ? "iPhone" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "Unknown OS";
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : /curl|node|undici/i.test(ua) ? "Script" : "Browser";
  return `${browser} on ${os}`;
}

export function registerAuth(app: FastifyInstance, auth: AuthService) {
  app.decorateRequest("user", null);

  // CSRF: browsers send Origin / Sec-Fetch-Site on state-changing requests; reject anything cross-site.
  app.addHook("onRequest", async (req, reply) => {
    if (SAFE_METHODS.has(req.method) || !req.url.startsWith("/api/")) return;
    const site = req.headers["sec-fetch-site"];
    const origin = req.headers.origin;
    let crossOrigin = site === "cross-site";
    if (origin) {
      try {
        crossOrigin ||= new URL(origin).host !== req.headers.host;
      } catch {
        crossOrigin = true;
      }
    }
    if (crossOrigin) return reply.code(403).send({ error: "Cross-site request rejected" });
  });

  app.addHook("onRequest", async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    req.user = token ? auth.resolveSession(token) : null;
    const path = req.url.split("?")[0] ?? "";
    if (path.startsWith("/api/") && !PUBLIC_API.has(path) && !req.user) {
      return reply.code(401).send({ error: "Not signed in" });
    }
  });

  app.get("/api/auth/state", async (req): Promise<AuthState> => ({
    setupRequired: !auth.hasUser(),
    authenticated: req.user !== null,
    username: req.user?.username,
  }));

  app.post("/api/auth/setup", async (req, reply) => {
    if (auth.hasUser()) return reply.code(409).send({ error: "Account already exists" });
    const body = setupSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues[0]?.message ?? "Invalid request" });
    const userId = await auth.createUser(body.data.username, body.data.password);
    setSessionCookie(req, reply, auth.createSession(userId, true, { userAgent: req.headers["user-agent"], ip: req.ip }), true);
    req.log.info({ username: body.data.username }, "account created");
    return { ok: true };
  });

  app.post("/api/auth/login", async (req, reply) => {
    const body = loginSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "Invalid request" });
    const { lockedForMs, delayMs } = auth.throttle(req.ip);
    if (lockedForMs > 0) {
      const retryAfter = Math.ceil(lockedForMs / 1000);
      return reply.code(429).header("retry-after", retryAfter).send({ error: `Too many attempts. Try again in ${Math.ceil(retryAfter / 60)} min.` });
    }
    if (delayMs) await sleep(delayMs);
    const userId = await auth.verifyCredentials(body.data.username, body.data.password);
    auth.recordAttempt(req.ip, userId !== null);
    if (userId === null) {
      req.log.warn({ ip: req.ip }, "failed login");
      return reply.code(401).send({ error: "Incorrect username or password" });
    }
    setSessionCookie(req, reply, auth.createSession(userId, body.data.remember, { userAgent: req.headers["user-agent"], ip: req.ip }), body.data.remember);
    return { ok: true };
  });

  app.get("/api/auth/sessions", async (req): Promise<SessionSummary[]> => {
    const me = req.user;
    if (!me) return [];
    return auth.listSessions(me.id).map((s) => ({
      id: s.id,
      device: describeDevice(s.userAgent),
      ip: s.ip,
      lastSeenAt: s.lastSeenAt.getTime(),
      current: s.id === me.sessionId,
    }));
  });

  app.delete("/api/auth/sessions/:id", async (req, reply) => {
    const { id } = z.object({ id: z.string().regex(/^[0-9a-f]{64}$/) }).parse(req.params);
    const me = req.user;
    if (!me) return reply.code(401).send({ error: "Not signed in" });
    if (!auth.listSessions(me.id).some((s) => s.id === id)) return reply.code(404).send({ error: "Session not found" });
    auth.deleteSession(id);
    return { ok: true };
  });

  app.delete("/api/auth/sessions", async (req) => {
    const me = req.user;
    return { signedOut: me ? auth.deleteOtherSessions(me.id, me.sessionId) : 0 };
  });

  app.put("/api/auth/password", async (req, reply) => {
    const me = req.user;
    if (!me) return reply.code(401).send({ error: "Not signed in" });
    const body = passwordChangeSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues[0]?.message ?? "Invalid request" });
    const ok = await auth.changePassword(me.id, body.data.current, body.data.next, me.sessionId);
    if (!ok) return reply.code(403).send({ error: "Your current password is incorrect" });
    req.log.info("password changed; other sessions signed out");
    return { ok: true };
  });

  app.post("/api/auth/logout", async (req, reply) => {
    if (req.user) auth.deleteSession(req.user.sessionId);
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });
}
