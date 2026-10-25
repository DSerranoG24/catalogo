import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import express from "express";
import type { User } from "@prisma/client";
import { makeAccountActionService } from "./account-action.service";
import { actionTtl, actionTokenValid, canIssueAction, createActionToken, hashActionToken, type AccountActionStore, type ActionRecord } from "./account-action";
import { accountActionUrl, accountMailer, type AccountMail, type ActionDispatcher } from "./account-mail.service";
import { invalidAction, makeAccountActionRouter, recoveryAccepted } from "../routes/account-action.routes";
import type { AuthenticatedRequest } from "../types/auth.types";

function fixture() {
  const user: User = { id: "owner-a", email: "owner@example.invalid", name: null, passwordHash: "old-hash", googleId: null, emailVerifiedAt: null, sessionVersion: 0, createdAt: new Date(), updatedAt: new Date() };
  const tokens: ActionRecord[] = [], sent: AccountMail[] = [], jobs: (() => Promise<void>)[] = [];
  let clock = new Date("2026-10-25T12:00:00Z");
  const store: AccountActionStore = {
    findByEmail: async email => email === user.email ? user : null,
    findById: async id => id === user.id ? user : null,
    reserve: async (id, purpose, tokenHash, now) => {
      if (id !== user.id || !canIssueAction(user, purpose, tokens.filter(t => t.purpose === purpose && t.createdAt.getTime() > now.getTime() - 3_600_000), tokens.filter(t => t.purpose === purpose && !t.consumedAt && t.expiresAt > now).length, now)) return null;
      tokens.push({ userId: id, purpose, tokenHash, emailAtIssue: user.email, expiresAt: new Date(now.getTime() + actionTtl[purpose]), consumedAt: null, createdAt: now });
      return user;
    },
    consume: async (hash, purpose, now, passwordHash) => {
      const token = tokens.find(t => t.tokenHash === hash);
      if (!token || !actionTokenValid(token, user, purpose, now) || (purpose === "RESET_PASSWORD" && !passwordHash)) return false;
      token.consumedAt = now; user.emailVerifiedAt ??= now;
      if (purpose === "RESET_PASSWORD") { user.passwordHash = passwordHash ?? null; user.sessionVersion++; }
      for (const other of tokens) if (purpose === "RESET_PASSWORD" || other.purpose === purpose) other.consumedAt = now;
      return true;
    },
  };
  const dispatcher: ActionDispatcher = { enqueue(_operation, work) { jobs.push(work); return true; } };
  const service = makeAccountActionService(store, { send: async mail => { sent.push(mail); } }, dispatcher, () => clock);
  return { user, tokens, sent, jobs, store, service, dispatcher, advance(ms: number) { clock = new Date(clock.getTime() + ms); }, async flush() { while (jobs.length) await jobs.shift()?.(); } };
}

async function withApi(work: (base: string, f: ReturnType<typeof fixture>) => Promise<void>) {
  const f = fixture(), app = express(); app.use(express.json());
  app.use("/auth", makeAccountActionRouter((req: AuthenticatedRequest, res, next) => {
    if (req.headers["x-owner"] !== f.user.id) return res.status(401).json({ success: false });
    req.user = { id: f.user.id, email: f.user.email }; next();
  }, f.service));
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  try { await work(`http://127.0.0.1:${address.port}/auth`, f); }
  finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}
const post = (base: string, route: string, body: unknown, owner?: string) => fetch(`${base}/${route}`, { method: "POST", headers: { "content-type": "application/json", ...(owner ? { "x-owner": owner } : {}) }, body: JSON.stringify(body) });

test("action tokens have 256 random bits; only SHA256 and expiry/purpose-bound records are stored", async () => {
  const f = fixture(); f.service.requestVerification(f.user.id); await f.flush();
  assert.equal(f.sent[0].token.length, 43); assert.equal(f.tokens[0].tokenHash.length, 64);
  assert.ok(!JSON.stringify(f.tokens).includes(f.sent[0].token));
  assert.equal(f.tokens[0].expiresAt.getTime() - f.tokens[0].createdAt.getTime(), 86_400_000);
  assert.equal(await f.service.resetPassword(f.sent[0].token, "valid-password"), false);
  f.service.requestRecovery(f.user.email); await f.flush();
  const reset = f.sent.find(m => m.purpose === "RESET_PASSWORD"); assert.ok(reset);
  assert.equal(await f.service.confirmVerification(reset.token), false);
  assert.equal(f.tokens[1].expiresAt.getTime() - f.tokens[1].createdAt.getTime(), 1_800_000);
});

test("HTTP: expired, used, malformed and nonexistent verification links return the same generic 400; GET never consumes", async () => {
  await withApi(async (base, f) => {
    f.service.requestVerification(f.user.id); await f.flush();
    const token = f.sent[0].token;
    assert.equal((await fetch(`${base}/verification/confirm`)).status, 404);
    assert.equal(f.tokens[0].consumedAt, null);
    assert.equal((await post(base, "verification/confirm", { token })).status, 200);
    for (const value of [token, createActionToken(), "bad"]) {
      const response = await post(base, "verification/confirm", { token: value });
      assert.equal(response.status, 400); assert.deepEqual(await response.json(), invalidAction);
    }
    const g = fixture(); g.service.requestVerification(g.user.id); await g.flush(); g.advance(actionTtl.VERIFY_EMAIL);
    assert.equal(await g.service.confirmVerification(g.sent[0].token), false);
  });
  await withApi(async (base, f) => {
    f.service.requestVerification(f.user.id); await f.flush(); f.advance(actionTtl.VERIFY_EMAIL);
    const response = await post(base, "verification/confirm", { token: f.sent[0].token });
    assert.equal(response.status, 400); assert.deepEqual(await response.json(), invalidAction);
  });
});

test("HTTP forgot is identical for existing, nonexistent, Google-only and cooldown; lookup/delivery run after response admission", async () => {
  await withApi(async (base, f) => {
    for (const email of [f.user.email, "missing@example.invalid", f.user.email]) {
      const response = await post(base, "password/forgot", { email });
      assert.equal(response.status, 202); assert.deepEqual(await response.json(), recoveryAccepted);
    }
    assert.equal(f.tokens.length, 0); assert.equal(f.sent.length, 0);
    await f.flush(); assert.equal(f.sent.length, 1);
    f.user.passwordHash = null;
    const response = await post(base, "password/forgot", { email: f.user.email });
    assert.equal(response.status, 202); assert.deepEqual(await response.json(), recoveryAccepted);
    await f.flush(); assert.equal(f.sent.length, 1);
  });
});

test("60-second cooldown and five per hour survive a new service instance over the same store; sixth is suppressed", async () => {
  const f = fixture();
  const restarted = makeAccountActionService(f.store, { send: async mail => { f.sent.push(mail); } }, f.dispatcher, () => new Date(f.tokens.at(-1)?.createdAt.getTime() ?? 0));
  f.service.requestRecovery(f.user.email); await f.flush();
  f.advance(59_999); f.service.requestRecovery(f.user.email); await f.flush(); assert.equal(f.sent.length, 1);
  f.advance(1); f.service.requestRecovery(f.user.email); await f.flush(); assert.equal(f.sent.length, 2);
  for (let i = 0; i < 3; i++) { f.advance(60_000); f.service.requestRecovery(f.user.email); await f.flush(); }
  assert.equal(f.sent.length, 5);
  f.advance(60_000); f.service.requestRecovery(f.user.email); await f.flush(); assert.equal(f.sent.length, 5);
  restarted.requestRecovery(f.user.email); await f.flush(); assert.equal(f.sent.length, 5);
});

test("concurrent consumption succeeds once; reset verifies email, rotates sessions, invalidates siblings and does not issue a session", async () => {
  await withApi(async (base, f) => {
    f.service.requestRecovery(f.user.email); await f.flush(); const token = f.sent[0].token;
    f.advance(60_000); f.service.requestRecovery(f.user.email); await f.flush();
    const responses = await Promise.all([post(base, "password/reset", { token, password: "new-password", passwordConfirmation: "new-password" }), post(base, "password/reset", { token, password: "new-password", passwordConfirmation: "new-password" })]);
    assert.deepEqual(responses.map(r => r.status).sort(), [200, 400]);
    assert.equal(f.user.sessionVersion, 1); assert.ok(f.user.emailVerifiedAt);
    for (const response of responses) { assert.equal(response.headers.get("set-cookie"), null); const body = await response.json(); assert.ok(!("token" in body)); assert.ok(!("user" in body)); }
    assert.equal(await f.service.resetPassword(f.sent[1].token, "another-password"), false);
  });
});

test("a user cannot select another user's verification target or enumerate action tokens", async () => {
  await withApi(async (base, f) => {
    assert.equal((await post(base, "verification/request", {})).status, 401);
    assert.equal((await post(base, "verification/request", {}, "owner-b")).status, 401);
    assert.equal((await post(base, "verification/request", { userId: "owner-b", email: "other@example.invalid" }, f.user.id)).status, 400);
    const response = await post(base, "verification/request", {}, f.user.id);
    assert.equal(response.status, 202); assert.ok(!("token" in await response.json()));
    await f.flush(); assert.equal(f.tokens[0].userId, f.user.id);
    assert.equal((await fetch(`${base}/tokens`)).status, 404);
  });
});

test("mail log mode never calls the provider or logs destination/token; action URLs use only configured origin and fragments", async () => {
  const previous = process.env.MAIL_MODE; process.env.MAIL_MODE = "log";
  const original = console.info, lines: unknown[][] = []; console.info = (...args: unknown[]) => { lines.push(args); };
  const token = createActionToken();
  try { await accountMailer.send({ purpose: "VERIFY_EMAIL", to: "never-send@example.invalid", token }); }
  finally { console.info = original; if (previous === undefined) delete process.env.MAIL_MODE; else process.env.MAIL_MODE = previous; }
  assert.ok(!JSON.stringify(lines).includes(token)); assert.ok(!JSON.stringify(lines).includes("never-send"));
  assert.equal(lines.length, 1);
  const url = new URL(accountActionUrl("RESET_PASSWORD", token, "https://app.example.invalid"));
  assert.equal(url.pathname, "/restablecer-contrasena"); assert.equal(url.search, ""); assert.ok(url.hash.startsWith("#token="));
  assert.throws(() => accountActionUrl("VERIFY_EMAIL", token, "https://evil.example.invalid/path"));
});

test("registration survives email failure; version claim revokes previous JWTs without editing jwt.ts", async () => {
  process.env.JWT_SECRET = "account-tests-only-jwt-secret-at-least-32-bytes";
  const { registerUser } = await import("./auth.service.js");
  const { makeAuthenticate } = await import("../middlewares/auth.middleware.js");
  const { generateToken } = await import("../utils/jwt.js");
  const f = fixture();
  const session = await registerUser({ email: f.user.email, password: "valid-password" }, { findUserByEmail: async () => null, createUser: async () => f.user }, { ...f.service, requestVerification() { throw new Error("simulated-mail-failure"); } });
  const app = express(); app.get("/me", makeAuthenticate(async id => id === f.user.id ? f.user : null), (_req, res) => res.json({ success: true }));
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening"); const address = server.address(); assert.ok(address && typeof address !== "string");
  const request = (token: string) => fetch(`http://127.0.0.1:${address.port}/me`, { headers: { authorization: `Bearer ${token}` } });
  try {
    const legacy = generateToken({ userId: f.user.id, email: f.user.email });
    assert.equal((await request(legacy)).status, 200); assert.equal((await request(session.token)).status, 200);
    f.service.requestRecovery(f.user.email); await f.flush(); await f.service.resetPassword(f.sent[0].token, "new-password");
    assert.equal((await request(legacy)).status, 401); assert.equal((await request(session.token)).status, 401);
    assert.equal((await request(session.token + "x")).status, 401);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});

test("Google email collision never auto-links an existing local account", async () => {
  process.env.JWT_SECRET = "account-tests-only-jwt-secret-at-least-32-bytes";
  const { loginWithGoogle } = await import("./auth.service.js");
  const f = fixture(); let creates = 0;
  await assert.rejects(loginWithGoogle("test-only-credential", { findUserByGoogleId: async () => null, findUserByEmail: async () => f.user, createGoogleUser: async () => { creates++; return f.user; } }, async () => ({ googleId: "google-owner", email: f.user.email, name: undefined, authoritative: true })), /GOOGLE_LINK_REQUIRED/);
  assert.equal(creates, 0); assert.equal(f.user.googleId, null);
});

test("explicit Google linking requires the authenticated user's password and matching Google email", async () => {
  process.env.JWT_SECRET = "account-tests-only-jwt-secret-at-least-32-bytes";
  const { linkGoogleAccount } = await import("./auth.service.js");
  const bcrypt = (await import("bcrypt")).default;
  const f = fixture(); f.user.passwordHash = await bcrypt.hash("local-password", 12);
  let links = 0;
  const store = { findUserById: async (id: string) => id === f.user.id ? f.user : null, linkGoogleUser: async () => { links++; return f.user; } };
  const verify = async () => ({ googleId: "google-owner", email: f.user.email, name: undefined, authoritative: true });
  await assert.rejects(linkGoogleAccount("other-user", "test-only", "local-password", store, verify), /GOOGLE_LINK_REJECTED/);
  await assert.rejects(linkGoogleAccount(f.user.id, "test-only", "wrong-password", store, verify), /GOOGLE_LINK_REJECTED/);
  await assert.rejects(linkGoogleAccount(f.user.id, "test-only", "local-password", store, async () => ({ ...await verify(), email: "other@example.invalid" })), /GOOGLE_LINK_REJECTED/);
  assert.equal(links, 0);
  await linkGoogleAccount(f.user.id, "test-only", "local-password", store, verify);
  assert.equal(links, 1);
});
