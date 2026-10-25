import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma";
import { makeAccountActionStore } from "./account-action.repository";

function fixture() {
  let locked = false, updates = 0, failUserUpdate = false;
  const now = new Date("2026-10-25T12:00:00Z");
  const token = { id: "token-row", userId: "owner", purpose: "RESET_PASSWORD", tokenHash: "hash", emailAtIssue: "owner@example.invalid", createdAt: now, expiresAt: new Date(now.getTime() + 1_800_000), consumedAt: null as Date | null };
  const user = { id: "owner", email: token.emailAtIssue, passwordHash: "old", emailVerifiedAt: null as Date | null, sessionVersion: 0 };
  let tail = Promise.resolve();
  const database = new Proxy(prisma, { get(_target, key) {
    if (key === "$transaction") return async (work: (tx: Prisma.TransactionClient) => Promise<unknown>) => {
      const previous = tail; let release = () => {}; tail = new Promise<void>(resolve => { release = resolve; });
      await previous; locked = false;
      const priorToken = { ...token }, priorUser = { ...user };
      try { return await work(database); }
      catch (error) { Object.assign(token, priorToken); Object.assign(user, priorUser); throw error; }
      finally { release(); }
    };
    if (key === "$queryRaw") return async (strings: TemplateStringsArray, ...values: unknown[]) => {
      assert.match(strings.join(""), /FOR UPDATE/); assert.deepEqual(values, [user.id]); locked = true; return [{ id: user.id }];
    };
    if (key === "accountActionToken") return {
      findUnique: async (args: { where: { tokenHash: string } }) => args.where.tokenHash === token.tokenHash ? { ...token } : null,
      updateMany: async (args: { where: { id?: string; consumedAt: null; expiresAt?: { gt: Date }; userId?: string }; data: { consumedAt: Date } }) => {
        assert.ok(locked, "Token consumption must hold the user row lock");
        if (args.where.id) {
          assert.equal(args.where.id, token.id); assert.equal(args.where.consumedAt, null); assert.ok(args.where.expiresAt);
          if (token.consumedAt) return { count: 0 };
          token.consumedAt = args.data.consumedAt; return { count: 1 };
        }
        assert.equal(args.where.userId, user.id); return { count: 0 };
      },
    };
    if (key === "user") return {
      findUnique: async (args: { where: { id: string } }) => args.where.id === user.id ? { ...user } : null,
      update: async (args: { where: { id: string }; data: { passwordHash: string; emailVerifiedAt: Date; sessionVersion: { increment: number } } }) => {
        assert.ok(locked); assert.equal(args.where.id, user.id);
        if (failUserUpdate) throw new Error("SIMULATED_UPDATE_FAILURE");
        user.passwordHash = args.data.passwordHash; user.emailVerifiedAt = args.data.emailVerifiedAt; user.sessionVersion += args.data.sessionVersion.increment;
        updates++; return { ...user };
      },
    };
    throw new Error("Unexpected database operation");
  } });
  return { store: makeAccountActionStore(database), token, user, now, get updates() { return updates; }, fail() { failUserUpdate = true; } };
}

test("repository uses a user row lock plus conditional token claim; parallel reset mutates credentials once", async () => {
  const f = fixture();
  const results = await Promise.all([f.store.consume("hash", "RESET_PASSWORD", f.now, "new-hash"), f.store.consume("hash", "RESET_PASSWORD", f.now, "other-hash")]);
  assert.deepEqual(results, [true, false]); assert.equal(f.updates, 1); assert.equal(f.user.sessionVersion, 1);
});

test("repository rolls token consumption back if the credential update fails", async () => {
  const f = fixture(); f.fail();
  await assert.rejects(f.store.consume("hash", "RESET_PASSWORD", f.now, "new-hash"), /SIMULATED_UPDATE_FAILURE/);
  assert.equal(f.token.consumedAt, null); assert.equal(f.user.passwordHash, "old"); assert.equal(f.user.sessionVersion, 0);
});

test("email budget is persistent and shared across purposes; day and month ceilings suppress issuance", async () => {
  const budgets = new Map<string, number>(); let created = 0;
  const now = new Date("2026-10-25T12:00:00Z");
  const database = new Proxy(prisma, { get(_target, key) {
    if (key === "$transaction") return async (work: (tx: Prisma.TransactionClient) => Promise<unknown>) => work(database);
    if (key === "$queryRaw") return async (strings: TemplateStringsArray) => { assert.match(strings.join(""), /pg_advisory_xact_lock|FOR UPDATE/); return []; };
    if (key === "user") return { findUnique: async (args: { where: { id: string } }) => ({ id: args.where.id, email: "owner@example.invalid", passwordHash: "hash", emailVerifiedAt: null, sessionVersion: 0 }) };
    if (key === "accountActionToken") return {
      findMany: async () => [], count: async () => 0,
      create: async (args: { data: { tokenHash: string; emailAtIssue: string; expiresAt: Date } }) => {
        assert.equal(args.data.tokenHash, "hash-only"); assert.ok(args.data.expiresAt > now); created++; return {};
      },
    };
    if (key === "emailDeliveryBudget") return {
      findUnique: async (args: { where: { period: string } }) => ({ reserved: budgets.get(args.where.period) ?? 0 }),
      upsert: async (args: { where: { period: string } }) => { const value = (budgets.get(args.where.period) ?? 0) + 1; budgets.set(args.where.period, value); return { reserved: value }; },
    };
    throw new Error("Unexpected database operation");
  } });
  const first = makeAccountActionStore(database);
  for (let i = 0; i < 100; i++) assert.ok(await first.reserve(`owner-${i}`, i % 2 ? "VERIFY_EMAIL" : "RESET_PASSWORD", "hash-only", now));
  const restarted = makeAccountActionStore(database);
  assert.equal(await restarted.reserve("another", "RESET_PASSWORD", "hash-only", now), null); assert.equal(created, 100);
  budgets.set("day:2026-10-25", 0); budgets.set("month:2026-10", 3000);
  assert.equal(await restarted.reserve("another", "VERIFY_EMAIL", "hash-only", now), null); assert.equal(created, 100);
});
