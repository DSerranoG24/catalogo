import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import express from "express";
import type { User } from "@prisma/client";
import { DASHBOARD_MODULES, DashboardQueryError, fillSeries, parseDashboardQuery, presentSummary, type RawSummary } from "./dashboard-summary";
import { dashboardExpensesSql, dashboardSummarySql, readDashboardSummary } from "../repositories/dashboard-summary.repository";

const zero: RawSummary = {
  today: "2026-11-25", todaySales: "0", todayCount: 0, yesterdaySales: "0",
  month: { sales: "0", cost: "0", withoutCost: 0 }, previousMonth: { sales: "0", cost: "0" },
  series: [], attention: { low: 0, out: 0, pending: 0, dueSoon: 0, overdue: 0 }, recent: [],
  setup: { hasInventoryItems: false, hasPublishedCatalog: false, hasSales: false },
};
const at = new Date("2026-11-25T17:00:00.000Z");

test("query: days 7|30|90 (default 7); unknown, repeated, nested or other values are rejected", () => {
  assert.deepEqual(parseDashboardQuery({}), { days: 7 });
  for (const days of [7, 30, 90]) assert.deepEqual(parseDashboardQuery({ days: String(days) }), { days });
  for (const query of [{ days: "14" }, { days: "" }, { days: "7.0" }, { days: " 7" }, { days: ["7", "30"] }, { days: { a: "7" } }, { ownerId: "x" }, { days: "7", userId: "x" }, null, "days=7"])
    assert.throws(() => parseDashboardQuery(query), DashboardQueryError, JSON.stringify(query));
});

test("new account: every figure in zero, setup false; expenses null only when no expenses data is read", () => {
  assert.equal(DASHBOARD_MODULES.expenses, true, "F1a expenses are part of this build");
  const summary = presentSummary(zero, null, at, 7);
  assert.equal(summary.generatedAt, "2026-11-25T17:00:00.000Z");
  assert.deepEqual(summary.today, { date: "2026-11-25", salesTotal: "0", salesCount: 0, yesterdaySalesTotal: "0" });
  assert.deepEqual(summary.month, { salesTotal: "0", costOfSales: "0", salesWithoutCostCount: 0, expensesTotal: null, estimatedProfit: "0",
    previousMonth: { salesTotal: "0", expensesTotal: null, estimatedProfit: "0" } });
  assert.deepEqual(summary.attention, { lowStockCount: 0, outOfStockCount: 0, pendingOrdersCount: 0, scheduledDueSoonCount: 0, scheduledOverdueCount: 0 });
  assert.deepEqual(summary.salesSeries.map(p => p.total), Array(7).fill("0"));
  assert.deepEqual(summary.recent, []);
  assert.deepEqual(summary.setup, { hasInventoryItems: false, hasPublishedCatalog: false, hasSales: false });
  assert.deepEqual(summary.modules, { expenses: false, scheduledExpenses: true });
});

test("profit = sales − cost − (expenses ?? 0) with BigInt beyond Number precision; negative allowed", () => {
  const raw: RawSummary = { ...zero, month: { sales: "9007199254740993000", cost: "1", withoutCost: 2 }, previousMonth: { sales: "100", cost: "250" } };
  const without = presentSummary(raw, null, at, 7);
  assert.equal(without.month.estimatedProfit, "9007199254740992999");
  assert.equal(without.month.previousMonth.estimatedProfit, "-150");
  assert.equal(without.month.salesWithoutCostCount, 2);
  const withExpenses = presentSummary(raw, { month: "1000000000000", previousMonth: "50" }, at, 7);
  assert.equal(withExpenses.month.expensesTotal, "1000000000000");
  assert.equal(withExpenses.month.estimatedProfit, "9007198254740992999");
  assert.deepEqual(withExpenses.month.previousMonth, { salesTotal: "100", expensesTotal: "50", estimatedProfit: "-200" });
  assert.deepEqual(withExpenses.modules, { expenses: true, scheduledExpenses: true });
  assert.equal(presentSummary({ ...raw, month: { ...raw.month, sales: "-5000" } }, null, at, 7).month.estimatedProfit, "-5001", "a month with only returns is negative");
});

test("series: one point per day ending today, empty days filled, month and year borders", () => {
  const series = fillSeries("2026-11-25", 30, [{ date: "2026-11-01", total: "10" }, { date: "2026-11-25", total: "-3" }]);
  assert.equal(series.length, 30); assert.equal(series[0]?.date, "2026-10-27"); assert.equal(series[29]?.date, "2026-11-25");
  assert.equal(series.find(p => p.date === "2026-11-01")?.total, "10"); assert.equal(series[29]?.total, "-3");
  assert.equal(series.filter(p => p.total === "0").length, 28);
  assert.deepEqual(fillSeries("2026-03-01", 7, []).map(p => p.date), ["2026-02-23", "2026-02-24", "2026-02-25", "2026-02-26", "2026-02-27", "2026-02-28", "2026-03-01"], "28-day February");
  assert.equal(fillSeries("2028-03-01", 7, [])[0]?.date, "2028-02-24", "leap year");
  assert.equal(fillSeries("2027-01-01", 90, []).length, 90); assert.equal(fillSeries("2027-01-01", 90, [])[0]?.date, "2026-10-04");
  assert.equal(fillSeries("2026-08-01", 7, [])[0]?.date, "2026-07-26", "31-day July");
  assert.throws(() => fillSeries("2026-11-25", 7, [{ date: "2026-11-01", total: "1" }]), /OUT_OF_RANGE/);
  assert.throws(() => fillSeries("2026-11-25", 7, [{ date: "2026-11-25", total: "1" }, { date: "2026-11-25", total: "2" }]), /DUPLICATE/);
});

test("raw rows are validated: money must be a decimal string, no extra keys, recent limited to 5", () => {
  assert.throws(() => presentSummary({ ...zero, todaySales: 5 }, null, at, 7));
  assert.throws(() => presentSummary({ ...zero, todaySales: "1.5" }, null, at, 7));
  assert.throws(() => presentSummary({ ...zero, extra: true }, null, at, 7));
  assert.throws(() => presentSummary(zero, { month: 1, previousMonth: "0" }, at, 7));
  const sale = { id: "s", status: "DELIVERED" as const, total: "1", at: "2026-11-25T04:59:59.000Z", customerName: null };
  assert.throws(() => presentSummary({ ...zero, recent: Array(6).fill(sale) }, null, at, 7));
  assert.deepEqual(presentSummary({ ...zero, recent: [sale] }, null, at, 7).recent, [{ kind: "SALE", ...sale }]);
});

test("SQL: owner bound as a parameter in every owned table; fixed statements; expenses only with the module", async () => {
  const sql = dashboardSummarySql("owner-a", at, 30);
  assert.ok(!sql.sql.includes("owner-a"), "owner is never interpolated");
  assert.equal(sql.values.filter(v => v === "owner-a").length, 10, "sales, returns ×2 (return and its sale), stock, recent, orders, published catalog, hasSales, scheduled ×2");
  for (const table of ['"Sale" s', '"SaleReturn" r', "inventory_items i", "catalogs c"]) assert.ok(sql.sql.includes(table), table);
  const lists = sql.sql.match(/s\.status IN \([^)]*\)/g) ?? [];
  assert.equal(lists[0], "s.status IN ('CONFIRMED', 'DELIVERED', 'RETURNED')", "sales: cancelled and drafts never count");
  assert.equal(lists[1], "s.status IN ('DELIVERED', 'RETURNED')", "returns only exist on delivered sales");
  assert.ok(lists.slice(2).every(list => !list.includes("DRAFT")), "recent and hasSales exclude drafts");
  assert.equal(dashboardExpensesSql("owner-a", at).values.filter(v => v === "owner-a").length, 1);
  const statements: string[] = [];
  const tx = {
    $executeRaw: async (parts: TemplateStringsArray) => { statements.push(parts.join("?")); return 0; },
    $queryRaw: async (query: TemplateStringsArray | { sql: string }) => {
      const text = "sql" in query ? query.sql : query.join("?");
      statements.push(text);
      if (text.includes("CURRENT_TIMESTAMP")) return [{ asOf: at }];
      if (text.includes("expenseDate")) return [{ data: { month: "7", previousMonth: "0" } }];
      return [{ data: { ...zero, month: { sales: "10", cost: "1", withoutCost: 0 } } }];
    },
  };
  const database = { $transaction: async (work: (t: typeof tx) => Promise<unknown>, options: { isolationLevel: string }) => { assert.equal(options.isolationLevel, "RepeatableRead"); return work(tx); } };
  const off = await readDashboardSummary("owner-a", 7, { database: database as never, expenses: false });
  assert.equal(statements.length, 4); assert.equal(off.month.expensesTotal, null); assert.equal(off.month.estimatedProfit, "9");
  statements.length = 0;
  const on = await readDashboardSummary("owner-a", 7, { database: database as never, expenses: true });
  assert.equal(statements.length, 5); assert.equal(on.month.expensesTotal, "7"); assert.equal(on.month.estimatedProfit, "2"); assert.equal(on.modules.expenses, true);
  assert.match(statements[0] ?? "", /READ ONLY/);
});

test("route: 401 without session, 400 invalid query, owner from the session, private no-store, generic 500", async () => {
  process.env.JWT_SECRET = "dashboard-tests-only-signing-secret-at-least-32-bytes";
  const { makeAuthenticate } = await import("../middlewares/auth.middleware.js");
  const { makeDashboardRouter } = await import("../routes/dashboard.routes.js");
  const { generateToken } = await import("../utils/jwt.js");
  const owner: User = { id: "owner-a", email: "owner@example.invalid", name: null, passwordHash: null, googleId: null, emailVerifiedAt: null, sessionVersion: 0, closedAt: null, role: "USER", createdAt: new Date(), updatedAt: new Date() };
  const calls: [string, number][] = [];
  let fail = false;
  const app = express();
  app.use("/api/dashboard", makeDashboardRouter(makeAuthenticate(async id => id === owner.id ? { ...owner } : null), async (ownerId, days) => {
    calls.push([ownerId, days]);
    if (fail) throw new Error("relation \"Sale\" failed for owner@example.invalid owner-a");
    return presentSummary(zero, null, at, days);
  }));
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}/api/dashboard/summary`;
  const headers = { authorization: `Bearer ${generateToken({ userId: owner.id, email: owner.email })}` };
  const logged: string[] = []; const original = console.error;
  console.error = (...args: unknown[]) => { logged.push(args.map(String).join(" ")); };
  try {
    const anonymous = await fetch(base);
    assert.equal(anonymous.status, 401); assert.equal(anonymous.headers.get("cache-control"), "private, no-store");
    for (const query of ["?days=14", "?days=7&days=30", "?ownerId=owner-b", "?days=7&userId=owner-b", "?days[x]=7", "?days="]) {
      const response = await fetch(base + query, { headers });
      assert.equal(response.status, 400, query);
      assert.equal((await response.json() as { error: string }).error, "INVALID_DASHBOARD_QUERY");
      assert.equal(response.headers.get("cache-control"), "private, no-store");
    }
    assert.deepEqual(calls, [], "invalid queries never reach the database");
    const ok = await fetch(base + "?days=90", { headers });
    assert.equal(ok.status, 200); assert.equal(ok.headers.get("cache-control"), "private, no-store");
    const body = await ok.json() as { success: boolean; salesSeries: unknown[] };
    assert.equal(body.success, true); assert.equal(body.salesSeries.length, 90);
    assert.equal((await fetch(base, { headers })).status, 200);
    assert.deepEqual(calls, [["owner-a", 90], ["owner-a", 7]]);
    fail = true;
    const broken = await fetch(base, { headers });
    assert.equal(broken.status, 500);
    assert.deepEqual(await broken.json(), { success: false, error: "DASHBOARD_UNAVAILABLE", message: "No se pudo cargar el resumen. Intenta de nuevo." });
    assert.ok(logged.every(line => !line.includes("owner@example.invalid") && !line.includes("owner-a")), "no personal data or identifiers in logs");
  } finally {
    console.error = original;
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
