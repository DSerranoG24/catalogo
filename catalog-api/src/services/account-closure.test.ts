import assert from "node:assert/strict";
import test from "node:test";
import bcrypt from "bcrypt";
import { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma";
import { requestAccountClosure, verifyClosureCredentials, validateRecentClosureGoogleIdentity } from "./account-closure.service";
import { assertOwnedStoragePath, runAccountClosureBatch, type ClosureStorage } from "./account-closure-worker";

test("closure requires the current password for local accounts; Google cannot bypass it", async () => {
  const user = { passwordHash: await bcrypt.hash("fixture-password", 4), googleId: "google-fixture" };
  for (const credentials of [{}, { password: "wrong" }, { idToken: "unverified-fixture" }]) await assert.rejects(verifyClosureCredentials(user, credentials), /REAUTH_REQUIRED/);
  await verifyClosureCredentials(user, { password: "fixture-password" });
  await assert.rejects(verifyClosureCredentials({ passwordHash: null, googleId: "google-fixture" }, {}), /REAUTH_REQUIRED/);
});

test("failed reauthentication performs no transaction or destructive write", async () => {
  const database = new Proxy(prisma, { get(_target, key) {
    if (key === "user") return { findUnique: async () => ({ passwordHash: null, googleId: null }) };
    throw new Error("No operation may start before reauthentication");
  } });
  await assert.rejects(requestAccountClosure("owner", {}, database), /REAUTH_REQUIRED/);
});

test("Google closure identity must match the linked subject and be verified, recent and unexpired", () => {
  const now = Date.parse("2026-10-27T12:00:00Z"), seconds = now / 1000;
  const payload = { sub: "google-fixture", email_verified: true, iss: "https://accounts.google.com", aud: "fixture-client", iat: seconds - 10, exp: seconds + 1000 };
  validateRecentClosureGoogleIdentity(payload, "google-fixture", now);
  for (const change of [{ sub: "other-subject" }, { email_verified: false }, { iss: "untrusted.invalid" }, { iat: seconds - 301 }, { iat: seconds + 31 }, { exp: seconds }]) {
    assert.throws(() => validateRecentClosureGoogleIdentity({ ...payload, ...change }, "google-fixture", now), /REAUTH_REQUIRED/);
  }
});

test("repeated account closure returns the persisted job without changing its dates or issuing another job", async () => {
  const user = { id: "owner", passwordHash: "fixture-hash", googleId: null, sessionVersion: 1 };
  const database = new Proxy(prisma, { get(_target, key) {
    if (key === "$transaction") return async (fn: (tx: Prisma.TransactionClient) => Promise<unknown>) => fn(database);
    if (key === "$queryRaw") return async () => [];
    if (key === "user") return { findUnique: async () => user, findUniqueOrThrow: async () => user };
    if (key === "accountClosureJob") return { findUnique: async () => ({ id: "existing-job", phase: "CLEANING" }) };
    throw new Error("An idempotent closure must not perform writes");
  } });
  const again = await requestAccountClosure("owner", {}, database, async () => {});
  assert.deepEqual(again, { id: "existing-job", phase: "CLEANING" });
});

test("unresolved or unreviewed orders block closure before any data is changed", async () => {
  const user = { id: "owner", passwordHash: "fixture-hash", googleId: null, sessionVersion: 0 };
  const database = new Proxy(prisma, { get(_target, key) {
    if (key === "$transaction") return async (fn: (tx: Prisma.TransactionClient) => Promise<unknown>) => fn(database);
    if (key === "$queryRaw") return async () => [];
    if (key === "user") return { findUnique: async () => user, findUniqueOrThrow: async () => user };
    if (key === "accountClosureJob") return { findUnique: async () => null };
    if (key === "catalog") return { findMany: async () => [{ id: "catalog" }] };
    if (key === "order") return { count: async (args: Prisma.OrderCountArgs) => {
      assert.deepEqual(args.where, { catalog: { userId: "owner" }, OR: [{ status: { in: ["PENDING", "CONFIRMED"] } }, { anonymizedAt: null }] });
      return 1;
    } };
    throw new Error("No destructive operation is permitted");
  } });
  await assert.rejects(requestAccountClosure("owner", {}, database, async () => {}), /ACCOUNT_ORDERS_REQUIRE_REVIEW/);
});

type JobState = { id: string; userId: string; phase: string; attempts: number; catalogIds: string[]; pendingPaths: string[]; scanQueue: string[]; scanOffset: number };

function workerStore(initial?: JobState, reconcileComplete = false) {
  let job: JobState = initial ?? { id: "job", userId: "owner", phase: "PENDING", attempts: 0, catalogIds: ["catalog"], pendingPaths: [], scanQueue: ["catalog"], scanOffset: 0 };
  const actions: string[] = [];
  const update = (args: Prisma.AccountClosureJobUpdateArgs) => {
    const { attempts, ...data } = args.data;
    Object.assign(job, data);
    if (attempts) job.attempts++;
    return structuredClone(job);
  };
  const database = new Proxy(prisma, { get(_target, key) {
    if (key === "$transaction") return async (fn: (tx: Prisma.TransactionClient) => Promise<unknown>) => {
      const before = structuredClone(job);
      try { return await fn(database); } catch (error) { job = before; throw error; }
    };
    if (key === "$queryRaw") return async (sql: TemplateStringsArray) => { assert.match(sql.join(""), /FOR UPDATE SKIP LOCKED/); return job.phase === "COMPLETE" && !reconcileComplete ? [] : [{ id: job.id }]; };
    if (key === "$executeRaw") return async () => 0;
    if (key === "accountClosureJob") return { findUniqueOrThrow: async () => structuredClone(job), update,
      updateMany: async (args: Prisma.AccountClosureJobUpdateArgs) => { update(args); return { count: 1 }; } };
    if (key === "product" || key === "category" || key === "catalogBanner") return { deleteMany: async () => { actions.push(String(key)); return { count: 1 }; } };
    if (key === "catalog") return {
      deleteMany: async (args: Prisma.CatalogDeleteManyArgs) => { assert.deepEqual(args.where, { userId: "owner", orders: { none: {} } }); actions.push("deleteEmptyCatalogs"); return { count: 1 }; },
      updateMany: async () => { actions.push("scrubCatalogs"); return { count: 1 }; },
    };
    if (key === "user") return { update: async (args: Prisma.UserUpdateArgs) => { assert.equal(args.data.passwordHash, null); assert.equal(args.data.googleId, null); actions.push("scrubUser"); return {}; } };
    throw new Error("Unexpected worker operation");
  } });
  return { database, actions, get job() { return structuredClone(job); } };
}

test("cleanup manifest survives restart; failed removal remains pending and is safely retried", async () => {
  const store = workerStore();
  const removed: string[][] = [];
  let fail = true;
  const storage: ClosureStorage = {
    list: async prefix => prefix === "catalog" ? [{ name: "categories", folder: true }, { name: "orphan.png", folder: false }]
      : [{ name: "image.png", folder: false }],
    remove: async paths => { if (fail) throw new Error("fixture-storage-unavailable"); removed.push(paths); },
  };
  assert.equal(await runAccountClosureBatch(storage, store.database), true);
  assert.deepEqual(store.job.pendingPaths, ["catalog/orphan.png"]);
  // Simulate a fresh process restoring only the persisted DB job, not process memory.
  const restarted = workerStore(JSON.parse(JSON.stringify(store.job)));
  await runAccountClosureBatch(storage, restarted.database);
  await runAccountClosureBatch(storage, restarted.database);
  assert.equal(restarted.job.phase, "CLEANING");
  assert.equal(await runAccountClosureBatch(storage, restarted.database), false);
  assert.equal(restarted.job.pendingPaths.length, 2);
  assert.equal(restarted.actions.length, 0);
  fail = false;
  await runAccountClosureBatch(storage, restarted.database);
  assert.deepEqual(removed, [["catalog/orphan.png", "catalog/categories/image.png"]]);
  await runAccountClosureBatch(storage, restarted.database);
  assert.equal(restarted.job.phase, "COMPLETE");
  assert.equal(await runAccountClosureBatch(storage, restarted.database), false);
  assert.equal(removed.length, 1);
  assert.ok(restarted.actions.includes("deleteEmptyCatalogs"));
});

test("cleanup refuses arbitrary bucket paths and keeps the job pending", async () => {
  for (const path of ["other/file.png", "catalog/../other.png", "catalog//file.png", "catalog\\file.png"]) assert.throws(() => assertOwnedStoragePath(path, ["catalog"]));
  const store = workerStore({ id: "job", userId: "owner", phase: "CLEANING", attempts: 0, catalogIds: ["catalog"], pendingPaths: ["other/file.png"], scanQueue: [], scanOffset: 0 });
  let removes = 0;
  assert.equal(await runAccountClosureBatch({ list: async () => [], remove: async () => { removes++; } }, store.database), false);
  assert.equal(removes, 0); assert.equal(store.job.phase, "CLEANING");
});

test("completed cleanup is periodically reconciled to catch late uploads and orphan objects", async () => {
  const store = workerStore({ id: "job", userId: "owner", phase: "COMPLETE", attempts: 2, catalogIds: ["catalog"], pendingPaths: [], scanQueue: [], scanOffset: 0 }, true);
  const removed: string[] = [];
  const storage: ClosureStorage = { list: async () => [{ name: "late-upload.png", folder: false }], remove: async paths => { removed.push(...paths); } };
  await runAccountClosureBatch(storage, store.database);
  assert.equal(store.job.phase, "PENDING");
  assert.deepEqual(store.job.scanQueue, ["catalog"]);
  await runAccountClosureBatch(storage, store.database);
  await runAccountClosureBatch(storage, store.database);
  await runAccountClosureBatch(storage, store.database);
  assert.deepEqual(removed, ["catalog/late-upload.png"]);
});
