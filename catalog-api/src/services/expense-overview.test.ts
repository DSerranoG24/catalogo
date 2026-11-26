import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import express from "express";
import { expenseOverviewSchema, expenseOverviewSql, monthBounds, percentOf, presentOverview } from "../repositories/expense-overview.repository";
import { bogotaToday } from "./expense-dates";
import { makeExpenseController } from "../controllers/expense.controller";
import { makeExpenseRouter } from "../routes/expense.routes";
import type { ExpenseService } from "./expense.service";

const at = new Date("2026-11-25T20:56:00.000Z");
const raw = (extra = {}) => ({ total: "0", count: 0, voidedCount: 0, previousTotal: "0", days: [], byCategory: [], fixedDue: 0, fixedPaid: 0, fixedPaidTotal: "0",
  variableTotal: "0", variableCount: 0, upcomingCount: 0, upcomingTotal: "0", upcomingWithout: 0, overdueCount: 0, overdueTotal: "0", overdueWithout: 0, ...extra });

test("overview query: strict month YYYY-MM between 2000-01 and the current Bogotá month", () => {
  const current = bogotaToday().slice(0, 7);
  assert.equal(expenseOverviewSchema.parse({ month: current }).month, current);
  assert.equal(expenseOverviewSchema.parse({ month: "2000-01" }).month, "2000-01");
  const [y, m] = current.split("-").map(Number) as [number, number];
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  for (const query of [{}, { month: next }, { month: "1999-12" }, { month: "2026-13" }, { month: "2026-1" }, { month: "2026-11-01" }, { month: ["2026-11", "2026-10"] }, { month: "2026-11", ownerId: "x" }])
    assert.equal(expenseOverviewSchema.safeParse(query).success, false, JSON.stringify(query));
});

test("month bounds: current month runs to today; past months complete; 28/29/30/31 days; January's previous is December", () => {
  assert.deepEqual(monthBounds("2026-11", "2026-11-25"), { from: "2026-11-01", to: "2026-11-25", previous: "2026-10", monthEnd: "2026-11-30", today: "2026-11-25", current: true });
  assert.deepEqual(monthBounds("2026-02", "2026-11-25"), { from: "2026-02-01", to: "2026-02-28", previous: "2026-01", monthEnd: "2026-02-28", today: "2026-11-25", current: false });
  assert.deepEqual(monthBounds("2028-02", "2028-11-01"), { from: "2028-02-01", to: "2028-02-29", previous: "2028-01", monthEnd: "2028-02-29", today: "2028-11-01", current: false });
  assert.equal(monthBounds("2026-04", "2026-11-25").to, "2026-04-30");
  assert.equal(monthBounds("2026-01", "2026-11-25").previous, "2025-12");
});

test("percent with BigInt, half up; categories sorted by total; amounts beyond 2^53 exact; raw rows validated", () => {
  assert.equal(percentOf(BigInt(2), BigInt(3)), "67"); assert.equal(percentOf(BigInt(1), BigInt(3)), "33");
  assert.equal(percentOf(BigInt(1), BigInt(8)), "13", "12.5 rounds half up"); assert.equal(percentOf(BigInt(0), BigInt(0)), "0");
  const big = "9007199254740993000";
  const overview = presentOverview(raw({ total: (BigInt(big) + BigInt(1000)).toString(), count: 3, voidedCount: 1, previousTotal: "500",
    days: [{ date: "2026-11-01", total: "0" }], byCategory: [
      { categoryId: "c1", name: "Otros", archived: false, total: "1000", count: 2 },
      { categoryId: "c2", name: "Arriendo", archived: true, total: big, count: 1 }] }), "2026-11", monthBounds("2026-11", "2026-11-25"), at);
  assert.deepEqual(overview.byCategory.map(c => [c.name, c.total, c.percent, c.archived]), [["Arriendo", big, "100", true], ["Otros", "1000", "0", false]]);
  assert.equal(overview.total, "9007199254740994000");
  assert.deepEqual(overview.previousMonth, { month: "2026-10", total: "500" });
  assert.equal(overview.generatedAt, "2026-11-25T20:56:00.000Z");
  assert.throws(() => presentOverview(raw({ total: 5 }), "2026-11", monthBounds("2026-11", "2026-11-25"), at));
  assert.throws(() => presentOverview(raw({ total: "-5" }), "2026-11", monthBounds("2026-11", "2026-11-25"), at));
  assert.throws(() => presentOverview(raw({ extra: 1 }), "2026-11", monthBounds("2026-11", "2026-11-25"), at));
  const sql = expenseOverviewSql("owner-a", monthBounds("2026-11", "2026-11-25"));
  assert.ok(!sql.sql.includes("owner-a")); assert.equal(sql.values.filter(v => v === "owner-a").length, 6, "expenses, categories, pending, fixed and variable expenses ×2 are owner-scoped");
  assert.match(sql.sql, /status IN \('CONFIRMED', 'VOIDED'\)/);
});

test("route GET /api/expenses/overview: 401, strict 400, owner from the session, private no-store, generic 503", async () => {
  const calls: [string, unknown][] = [];
  let fail = false;
  const service = { overview: async (owner: string, query: unknown) => {
    calls.push([owner, query]);
    if (fail) throw new Error("relation expenses failed for owner-a");
    const { month } = expenseOverviewSchema.parse(query);
    return presentOverview(raw(), month, monthBounds(month, bogotaToday()), at);
  } } as unknown as ExpenseService;
  const auth = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (req.headers.authorization !== "Bearer ok") return res.status(401).json({ success: false, error: "AUTH_REQUIRED" });
    (req as unknown as { user: { id: string; email: string } }).user = { id: "owner-a", email: "owner@example.invalid" }; next(); return undefined;
  };
  const app = express(); app.use("/api", makeExpenseRouter(makeExpenseController(service), auth));
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}/api/expenses/overview`, headers = { authorization: "Bearer ok" };
  try {
    assert.equal((await fetch(`${base}?month=2026-11`)).status, 401);
    for (const query of ["", "?month=2026-13", "?month=2026-11&month=2026-10", "?month=2026-11&ownerId=owner-b", "?month=2999-01"]) {
      const response = await fetch(base + query, { headers });
      assert.equal(response.status, 400, query); assert.equal(response.headers.get("cache-control"), "private, no-store");
    }
    const ok = await fetch(`${base}?month=${bogotaToday().slice(0, 7)}`, { headers });
    assert.equal(ok.status, 200); assert.equal(ok.headers.get("cache-control"), "private, no-store");
    const body = await ok.json() as { success: boolean; result: { month: string } };
    assert.equal(body.success, true); assert.equal(body.result.month, bogotaToday().slice(0, 7));
    assert.ok(calls.every(([owner]) => owner === "owner-a"), "owner always from the session");
    fail = true;
    const broken = await fetch(`${base}?month=2026-10`, { headers });
    assert.equal(broken.status, 503); assert.equal((await broken.json() as { error: string }).error, "EXPENSE_RETRY_SAME_OPERATION");
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
