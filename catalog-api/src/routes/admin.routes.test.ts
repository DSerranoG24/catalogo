import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import express from "express";
import { Prisma, type User } from "@prisma/client";
import { prisma } from "../config/prisma";
import { registerSchema } from "../schemas/auth.schema";
import { createUser, createGoogleUser } from "../repositories/user.repository";

test("admin router checks database roles after JWT authentication; degradation, forged roles and database failure deny", async () => {
  process.env.JWT_SECRET = "admin-tests-only-signing-secret-at-least-32-bytes";
  const { makeAuthenticate } = await import("../middlewares/auth.middleware.js");
  const { makeRequireAdmin } = await import("../middlewares/admin.middleware.js");
  const { makeAdminRouter } = await import("./admin.routes.js");
  const { generateToken } = await import("../utils/jwt.js");
  const user: User = { id: "owner-a", email: "owner@example.invalid", name: null, passwordHash: null, googleId: null, emailVerifiedAt: null, sessionVersion: 0, role: "USER", createdAt: new Date(), updatedAt: new Date() };
  let roleReads = 0, broken = false;
  const auth = makeAuthenticate(async id => id === user.id ? { ...user } : null);
  const authorize = makeRequireAdmin(async id => {
    roleReads++; assert.equal(id, user.id);
    if (broken) throw new Error("private-database-details");
    return { role: user.role };
  });
  const app = express(); app.use(express.json()); app.use("/api/admin", makeAdminRouter(auth, authorize));
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}/api/admin`;
  const claims = { userId: user.id, email: user.email, role: "ADMIN", isAdmin: true };
  const token = generateToken(claims);
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json", "x-role": "ADMIN" };
  try {
    const anonymous = await fetch(`${base}/access`);
    assert.equal(anonymous.status, 401); assert.equal(anonymous.headers.get("cache-control"), "no-store"); assert.equal(roleReads, 0);
    for (const path of ["/access?role=ADMIN&isAdmin=true", "/users", "/anything"]) {
      const response = await fetch(`${base}${path}`, { headers });
      assert.equal(response.status, 404); assert.deepEqual(await response.json(), { success: false, error: "ROUTE_NOT_FOUND" });
    }
    assert.equal((await fetch(`${base}/access`, { method: "POST", headers, body: JSON.stringify({ role: "ADMIN", isAdmin: true }) })).status, 404);
    user.role = "ADMIN";
    const allowed = await fetch(`${base}/access`, { headers });
    assert.equal(allowed.status, 200); assert.equal(allowed.headers.get("cache-control"), "no-store"); assert.deepEqual(await allowed.json(), { success: true });
    user.role = "USER";
    assert.equal((await fetch(`${base}/access`, { headers })).status, 404, "Same JWT loses access on the next request");
    broken = true; user.role = "ADMIN";
    const failure = await fetch(`${base}/access`, { headers });
    assert.equal(failure.status, 503); assert.deepEqual(await failure.json(), { success: false, error: "SERVICE_UNAVAILABLE" });
    assert.equal(failure.headers.get("cache-control"), "no-store");
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});

test("registration and Google creation cannot promote through role/isAdmin payloads, even at repository boundary", async () => {
  const writes: Prisma.UserCreateArgs[] = [];
  const now = new Date();
  const database = new Proxy(prisma, { get(_target, key) {
    if (key === "user") return { create: async (args: Prisma.UserCreateArgs) => {
      writes.push(args);
      return { id: "new-user", email: args.data.email, role: args.data.role, name: null, passwordHash: null, googleId: null, sessionVersion: 0, emailVerifiedAt: null, createdAt: now, updatedAt: now };
    } };
    throw new Error("Unexpected database operation");
  } });
  const payload = { email: "new@example.invalid", password: "valid-password", role: "ADMIN", isAdmin: true };
  const parsed = registerSchema.parse(payload);
  assert.ok(!("role" in parsed)); assert.ok(!("isAdmin" in parsed));
  const local = { email: parsed.email, passwordHash: "test-hash", role: "ADMIN", isAdmin: true };
  const google = { email: parsed.email, googleId: "google-user", role: "ADMIN", isAdmin: true };
  assert.equal((await createUser(local, database)).role, "USER");
  assert.equal((await createGoogleUser(google, database)).role, "USER");
  for (const write of writes) { assert.equal(write.data.role, "USER"); assert.ok(!("isAdmin" in write.data)); }
});
