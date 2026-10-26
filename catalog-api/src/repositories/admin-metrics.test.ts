import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import express from "express";
import { Prisma, type OrderStatus } from "@prisma/client";
import { prisma } from "../config/prisma";
import { adminMetricsSql, readAdminMetrics } from "./admin-metrics.repository";
import { changeOrderStatus } from "./order.repository";
import { presentMetrics, type MetricsCounts } from "../services/admin-metrics";

const asOf = new Date("2026-10-25T03:00:00Z");
function counts(): MetricsCounts {
  const cohort = { initiated: 0, pending: 0, confirmedCurrent: 0, confirmedKnown: 0, confirmedDated: 0, legacyCancelledUnknown: 0 };
  return { accounts: { total: 0, last7Days: 0, last30Days: 0, active: 0, unverified: 0 }, catalogs: { published: 0, last7Days: 0, last30Days: 0 }, orders: { total: 0, last7Days: 0, last30Days: 0 }, repeat: { withOrders: 0, repeating: 0 }, funnel: { allTime: { ...cohort }, last7Days: { ...cohort }, last30Days: { ...cohort } }, daily: [] };
}

test("metrics zero denominators are null and missing days become 30 dated zeros using Bogota, not UTC day", () => {
  const input = counts(); input.daily = [{ date: "2026-10-24", accountsCreated: 2, ordersCreated: 1 }];
  const result = presentMetrics(input, asOf);
  assert.equal(result.daily.length, 30); assert.equal(result.daily[0].date, "2026-09-25"); assert.equal(result.daily[29].date, "2026-10-24");
  assert.equal(result.daily[0].accountsCreated, 0); assert.equal(result.daily[0].ordersCreated, 0); assert.equal(result.daily[29].ordersCreated, 1);
  assert.equal(result.accounts.activePercent, null); assert.equal(result.accounts.unverifiedPercent, null); assert.equal(result.repeat.percent, null);
  assert.equal(result.funnel.last7Days.confirmedCurrentPercent, null); assert.equal(result.funnel.last30Days.confirmedKnownPercent, null);
  assert.equal(result.includesAdmin, true); assert.equal(result.timeZone, "America/Bogota"); assert.equal(result.asOf, asOf.toISOString());
});

test("confirmed proportions divide by initiated including cancelled, while known history and current state stay separate", () => {
  const input = counts(); input.funnel.allTime = { initiated: 5, pending: 1, confirmedCurrent: 1, confirmedKnown: 3, confirmedDated: 2, legacyCancelledUnknown: 1 };
  input.accounts = { total: 4, active: 2, unverified: 1, last7Days: 1, last30Days: 3 };
  const result = presentMetrics(input, asOf);
  assert.equal(result.funnel.allTime.confirmedCurrentPercent, 20); assert.equal(result.funnel.allTime.confirmedKnownPercent, 60);
  assert.equal(result.accounts.activePercent, 50); assert.equal(result.accounts.unverifiedPercent, 25);
  assert.equal(result.visits.last7Days, null);
});

test("metrics rejects accidental personal fields, unsafe numeric counts and duplicate/out-of-range days", () => {
  assert.throws(() => presentMetrics({ ...counts(), customerEmail: "private-canary" }, asOf));
  const duplicate = counts(); duplicate.daily = [{ date: "2026-10-24", accountsCreated: 1, ordersCreated: 0 }, { date: "2026-10-24", accountsCreated: 0, ordersCreated: 0 }];
  assert.throws(() => presentMetrics(duplicate, asOf), /DUPLICATE/);
  const future = counts(); future.daily = [{ date: "2026-10-25", accountsCreated: 1, ordersCreated: 0 }]; assert.throws(() => presentMetrics(future, asOf), /OUT_OF_RANGE/);
  const unsafe = counts(); unsafe.orders.total = Number.MAX_SAFE_INTEGER + 1; assert.throws(() => presentMetrics(unsafe, asOf));
});

test("metrics repository uses one snapshot, database clock, bounded statements, parameterized dates and aggregate-only SQL", async () => {
  let reads = 0;
  const database = new Proxy(prisma, { get(_target, key) {
    if (key === "$transaction") return async (work: (tx: Prisma.TransactionClient) => Promise<unknown>, options: { isolationLevel: string; timeout: number; maxWait: number }) => {
      assert.deepEqual(options, { isolationLevel: "RepeatableRead", maxWait: 1000, timeout: 4000 }); return work(database);
    };
    if (key === "$executeRaw") return async (strings: TemplateStringsArray) => { assert.match(strings.join(""), /SET TRANSACTION READ ONLY|statement_timeout = '2500ms'/); return 0; };
    if (key === "$queryRaw") return async (query: Prisma.Sql | TemplateStringsArray) => {
      reads++;
      if (reads === 1) { assert.ok(Array.isArray(query)); return [{ asOf }]; }
      assert.ok("sql" in query); assert.ok(query.values.every(value => value instanceof Date && value.getTime() === asOf.getTime()));
      assert.doesNotMatch(query.sql, /customer|passwordHash|googleId|quotationSellerSnapshot|\bnotes\b|\bphone\b|\baddress\b/);
      assert.match(query.sql, /c.active AND c\."archivedAt" IS NULL/);
      assert.match(query.sql, /p.active/); assert.match(query.sql, /firstConfirmedAt/); assert.match(query.sql, /date_trunc\('week'/);
      return [{ data: counts() }];
    };
    throw new Error("Unexpected database operation");
  } });
  const result = await readAdminMetrics(database); assert.equal(reads, 2); assert.equal(result.asOf, asOf.toISOString());
  const sql = adminMetricsSql(asOf).sql;
  assert.ok(sql.includes("interval '6 days'") && sql.includes("interval '29 days'"));
  assert.ok(sql.includes("o.status = 'CANCELLED' AND o.\"firstConfirmedAt\" IS NULL"));
});

function transitionFixture() {
  const row: { status: OrderStatus; firstConfirmedAt: Date | null } = { status: "PENDING", firstConfirmedAt: null };
  const confirmedAt = new Date("2026-10-25T12:00:00Z"); let failStamp = false;
  const database = new Proxy(prisma, { get(_target, key) {
    if (key === "$transaction") return async (work: (tx: Prisma.TransactionClient) => Promise<unknown>) => { const before = { ...row }; try { return await work(database); } catch (error) { Object.assign(row, before); throw error; } };
    if (key === "$queryRaw") return async () => [{ confirmedAt }];
    if (key === "order") return { updateMany: async (args: Prisma.OrderUpdateManyArgs) => {
      assert.deepEqual(args.where?.catalog, { userId: "owner" }); assert.equal(args.where?.id, "order");
      if (args.where?.status) { if (args.where.status !== row.status) return { count: 0 }; assert.ok(args.data.status === "CONFIRMED" || args.data.status === "CANCELLED"); row.status = args.data.status; return { count: 1 }; }
      assert.equal(args.where?.firstConfirmedAt, null);
      if (failStamp) throw new Error("SIMULATED_STAMP_FAILURE");
      if (row.firstConfirmedAt) return { count: 0 };
      assert.ok(args.data.firstConfirmedAt instanceof Date); row.firstConfirmedAt = args.data.firstConfirmedAt; return { count: 1 };
    } };
    throw new Error("Unexpected database operation");
  } });
  return { row, confirmedAt, database, fail() { failStamp = true; } };
}

test("first confirmation is atomic, retries do not overwrite, and cancellation never clears its timestamp", async () => {
  const f = transitionFixture();
  assert.equal((await changeOrderStatus("order", "owner", "PENDING", "CONFIRMED", f.database)).count, 1);
  assert.equal(f.row.firstConfirmedAt?.toISOString(), f.confirmedAt.toISOString());
  assert.equal((await changeOrderStatus("order", "owner", "PENDING", "CONFIRMED", f.database)).count, 0);
  await changeOrderStatus("order", "owner", "CONFIRMED", "CONFIRMED", f.database);
  assert.equal(f.row.firstConfirmedAt?.toISOString(), f.confirmedAt.toISOString());
  await changeOrderStatus("order", "owner", "CONFIRMED", "CANCELLED", f.database);
  assert.equal(f.row.status, "CANCELLED"); assert.equal(f.row.firstConfirmedAt?.toISOString(), f.confirmedAt.toISOString());
  const preserved = transitionFixture(); const original = new Date("2026-10-01T12:00:00Z"); preserved.row.firstConfirmedAt = original;
  await changeOrderStatus("order", "owner", "PENDING", "CONFIRMED", preserved.database);
  assert.equal(preserved.row.firstConfirmedAt.toISOString(), original.toISOString());
});

test("confirmation rollback includes status if timestamp write fails; legacy cancellations keep null", async () => {
  const f = transitionFixture(); f.fail();
  await assert.rejects(changeOrderStatus("order", "owner", "PENDING", "CONFIRMED", f.database), /SIMULATED_STAMP_FAILURE/);
  assert.equal(f.row.status, "PENDING"); assert.equal(f.row.firstConfirmedAt, null);
  const legacy = transitionFixture(); legacy.row.status = "CONFIRMED";
  await changeOrderStatus("order", "owner", "CONFIRMED", "CONFIRMED", legacy.database); assert.equal(legacy.row.firstConfirmedAt, null);
  await changeOrderStatus("order", "owner", "CONFIRMED", "CANCELLED", legacy.database); assert.equal(legacy.row.firstConfirmedAt, null);
});

test("metrics HTTP requires an administrator, denies query selectors, returns only aggregates and preserves failures as 503", async () => {
  process.env.JWT_SECRET = "metrics-test-only-signing-secret-at-least-32-bytes";
  const { makeAdminRouter } = await import("../routes/admin.routes.js");
  const { makeAuthenticate } = await import("../middlewares/auth.middleware.js");
  const { makeRequireAdmin } = await import("../middlewares/admin.middleware.js");
  const { generateToken } = await import("../utils/jwt.js");
  const user = { id: "owner", email: "private@example.invalid", name: null, passwordHash: null, googleId: null, sessionVersion: 0, role: "USER" as "USER" | "ADMIN", emailVerifiedAt: null, createdAt: new Date(), updatedAt: new Date() };
  let reads = 0, fail = false;
  const app = express(); app.use("/api/admin", makeAdminRouter(makeAuthenticate(async () => user), makeRequireAdmin(async () => ({ role: user.role })), async () => { reads++; if (fail) throw new Error("private-database-canary"); return presentMetrics(counts(), asOf); }));
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening"); const address = server.address(); assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}/api/admin/metrics`, headers = { authorization: `Bearer ${generateToken({ userId: user.id, email: user.email })}` };
  try {
    assert.equal((await fetch(url)).status, 401); assert.equal((await fetch(url, { headers })).status, 404); assert.equal(reads, 0);
    user.role = "ADMIN"; assert.equal((await fetch(url + "?userId=other", { headers })).status, 400); assert.equal(reads, 0);
    const response = await fetch(url, { headers }); assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
    const body = await response.text(); assert.ok(!body.includes(user.email)); assert.doesNotMatch(body, /customer|userId|catalogId|phone|address|passwordHash|quotationToken/);
    assert.equal(JSON.parse(body).metrics.accounts.activePercent, null);
    fail = true; const failure = await fetch(url, { headers }); assert.equal(failure.status, 503); assert.ok(!(await failure.text()).includes("private-database-canary"));
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
