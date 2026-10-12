import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";

const PASSWORD = "correct horse battery";
let app: FastifyInstance;
let dataDir: string;

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "dailybrief-test-"));
  ({ app } = await buildApp(
    loadConfig({ DATA_DIR: dataDir, DAILYBRIEF_SECRET: "x".repeat(40), LOGIN_DELAY_BASE_MS: "0" }),
    { logger: false },
  ));
});
after(async () => {
  await app.close();
  rmSync(dataDir, { recursive: true, force: true });
});

const cookieFrom = (res: { headers: Record<string, unknown> }) => String(res.headers["set-cookie"]).split(";")[0] ?? "";
const login = (password: string, ip = "10.0.0.5") =>
  app.inject({ method: "POST", url: "/api/auth/login", remoteAddress: ip, payload: { username: "reader", password } });

describe("first-run setup", () => {
  it("creates the account without a setup code, only once", async () => {
    const payload = { username: "reader", password: PASSWORD };
    assert.equal((await app.inject({ method: "POST", url: "/api/auth/setup", payload: { username: "reader", password: "short" } })).statusCode, 400);

    const ok = await app.inject({ method: "POST", url: "/api/auth/setup", payload });
    assert.equal(ok.statusCode, 200);
    assert.match(cookieFrom(ok), /^db_session=.+/);

    const again = await app.inject({ method: "POST", url: "/api/auth/setup", payload: { username: "intruder", password: PASSWORD } });
    assert.equal(again.statusCode, 409, "a second account can't be created");
  });
});

describe("sessions", () => {
  it("protects the API and ends on logout", async () => {
    assert.equal((await app.inject({ url: "/api/topics" })).statusCode, 401);

    const upper = await app.inject({ method: "POST", url: "/api/auth/login", remoteAddress: "10.0.0.6", payload: { username: "READER", password: PASSWORD } });
    assert.equal(upper.statusCode, 200, "usernames match case-insensitively");

    const cookie = cookieFrom(await login(PASSWORD));
    const topics = await app.inject({ url: "/api/topics", headers: { cookie } });
    assert.equal(topics.statusCode, 200);
    assert.deepEqual(topics.json(), [], "a new install starts with no topics");

    await app.inject({ method: "POST", url: "/api/auth/logout", headers: { cookie } });
    assert.equal((await app.inject({ url: "/api/topics", headers: { cookie } })).statusCode, 401);
  });

  it("rejects cross-site state-changing requests", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { origin: "http://evil.example", host: "dailybrief.lan:8080" },
      payload: { username: "reader", password: PASSWORD },
    });
    assert.equal(res.statusCode, 403);
  });
});

describe("login throttling", () => {
  it("locks an IP out after 10 failures, even for the correct password, without affecting other IPs", async () => {
    const ip = "10.0.0.99";
    for (let i = 0; i < 10; i++) assert.equal((await login("wrong password", ip)).statusCode, 401);
    const locked = await login(PASSWORD, ip);
    assert.equal(locked.statusCode, 429);
    assert.ok(Number(locked.headers["retry-after"]) > 0);
    assert.equal((await login(PASSWORD, "10.0.0.100")).statusCode, 200);
  });
});

describe("password change", () => {
  it("requires the current password and signs out every other session", async () => {
    const a = cookieFrom(await login(PASSWORD, "10.0.1.1"));
    const b = cookieFrom(await login(PASSWORD, "10.0.1.2"));
    const change = (cookie: string, current: string) =>
      app.inject({ method: "PUT", url: "/api/auth/password", headers: { cookie }, payload: { current, next: "a brand new passphrase" } });

    assert.equal((await change(a, "not my password")).statusCode, 403);
    assert.equal((await change(a, PASSWORD)).statusCode, 200);

    assert.equal((await app.inject({ url: "/api/topics", headers: { cookie: a } })).statusCode, 200, "the session that changed it stays signed in");
    assert.equal((await app.inject({ url: "/api/topics", headers: { cookie: b } })).statusCode, 401, "other sessions are revoked");
    assert.equal((await login(PASSWORD, "10.0.1.3")).statusCode, 401, "old password no longer works");
  });
});
