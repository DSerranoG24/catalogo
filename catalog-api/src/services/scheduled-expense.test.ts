import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import express from "express";
import { addDays, horizon, MAX_OCCURRENCES_PER_SYNC, nextOccurrence, nthOccurrence, occurrencesBetween, syncPlan, type ScheduleRule } from "./schedule-dates";
import { cancelScheduledSchema, createRecurringSchema, createScheduledSchema, payScheduledSchema, scheduledListSchema, updateRecurringSchema } from "../schemas/scheduled-expense.schema";
import { expenseListSchema } from "../schemas/expense.schema";
import { makeExpenseController } from "../controllers/expense.controller";
import { makeExpenseRouter } from "../routes/expense.routes";
import type { ExpenseService } from "./expense.service";

const rule = (frequency: ScheduleRule["frequency"], anchorDate: string, interval = 1, endDate: string | null = null): ScheduleRule => ({ frequency, interval, anchorDate, endDate });
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const keys = { operationId: uuid(1), requestId: uuid(2) };

test("dates: weekly and every N, month end and leap years, yearly 29 Feb, end date", () => {
  assert.deepEqual(occurrencesBetween(rule("WEEKLY", "2026-11-02", 2), null, "2026-12-15"), ["2026-11-02", "2026-11-16", "2026-11-30", "2026-12-14"]);
  assert.deepEqual(occurrencesBetween(rule("MONTHLY", "2026-01-31"), null, "2026-05-31"), ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31"], "day 31 → last day, then back to 31");
  assert.deepEqual(occurrencesBetween(rule("MONTHLY", "2028-01-31"), null, "2028-03-31"), ["2028-01-31", "2028-02-29", "2028-03-31"], "leap year");
  assert.deepEqual(occurrencesBetween(rule("MONTHLY", "2026-11-15", 3), null, "2027-11-30"), ["2026-11-15", "2027-02-15", "2027-05-15", "2027-08-15", "2027-11-15"], "quarterly");
  assert.deepEqual(occurrencesBetween(rule("YEARLY", "2028-02-29"), null, "2032-12-31"), ["2028-02-29", "2029-02-28", "2030-02-28", "2031-02-28", "2032-02-29"]);
  assert.deepEqual(occurrencesBetween(rule("MONTHLY", "2026-01-15", 1, "2026-03-20"), null, "2026-12-31"), ["2026-01-15", "2026-02-15", "2026-03-15"], "stops at endDate");
  assert.deepEqual(occurrencesBetween(rule("MONTHLY", "2026-01-15"), "2026-02-15", "2026-04-30"), ["2026-03-15", "2026-04-15"], "strictly after `after`");
  assert.equal(nthOccurrence(rule("MONTHLY", "2026-12-31"), 2), "2027-02-28", "crosses the year");
  assert.deepEqual(occurrencesBetween(rule("WEEKLY", "2000-01-03"), "2026-11-20", "2026-12-01"), ["2026-11-23", "2026-11-30"], "long-running weekly rules skip ahead (Mondays)");
  assert.equal(nextOccurrence(rule("MONTHLY", "2026-01-31"), "2026-02-01"), "2026-02-28");
  assert.equal(nextOccurrence(rule("MONTHLY", "2026-01-31", 1, "2026-02-01"), "2026-02-02"), null, "ended rule has no next date");
  // The fortnight (15 and last day) is two monthly rules, not a frequency of its own.
  assert.deepEqual([...occurrencesBetween(rule("MONTHLY", "2026-02-15"), null, "2026-03-31"), ...occurrencesBetween(rule("MONTHLY", "2026-01-31"), "2026-01-31", "2026-03-31")].sort(),
    ["2026-02-15", "2026-02-28", "2026-03-15", "2026-03-31"]);
});

test("horizon and sync plan: end of month or a week ahead; first sync keeps only the latest due date; cap of 24", () => {
  assert.equal(horizon("2026-11-10"), "2026-11-30"); assert.equal(horizon("2026-11-26"), "2026-12-03"); assert.equal(horizon("2026-02-25"), "2026-03-04");
  // Anchor three months ago: only the latest overdue date plus the future ones up to the horizon.
  assert.deepEqual(syncPlan(rule("MONTHLY", "2026-08-05"), null, "2026-11-10"), { dates: ["2026-11-05"], through: "2026-11-30" });
  assert.deepEqual(syncPlan(rule("MONTHLY", "2026-08-20"), null, "2026-11-10"), { dates: ["2026-10-20", "2026-11-20"], through: "2026-11-30" });
  assert.deepEqual(syncPlan(rule("MONTHLY", "2026-12-01"), null, "2026-11-26"), { dates: ["2026-12-01"], through: "2026-12-03" }, "future anchor inside the horizon");
  assert.deepEqual(syncPlan(rule("MONTHLY", "2026-08-20"), "2026-11-30", "2026-11-26"), { dates: [], through: "2026-12-03" });
  // Not opened for months: every pending date since generatedThrough, at most 24 per call.
  const weekly = syncPlan(rule("WEEKLY", "2026-01-01"), "2026-01-01", "2026-11-26");
  assert.equal(weekly.dates.length, MAX_OCCURRENCES_PER_SYNC); assert.equal(weekly.through, weekly.dates.at(-1));
  const next = syncPlan(rule("WEEKLY", "2026-01-01"), weekly.through, "2026-11-26");
  assert.equal(next.dates[0], addDays(weekly.through, 7), "the next call continues without gaps or duplicates");
  // Resume: generatedThrough = yesterday, so today's date is generated but the paused ones are not.
  assert.deepEqual(syncPlan(rule("WEEKLY", "2026-11-05"), "2026-11-25", "2026-11-26"), { dates: ["2026-11-26", "2026-12-03"], through: "2026-12-03" }, "Thursday rule resumed on a Thursday");
  assert.deepEqual(syncPlan(rule("WEEKLY", "2026-11-05"), "2026-11-26", "2026-11-27").dates, ["2026-12-03"], "resumed on Friday: the Thursday of the pause is not generated");
});

test("schemas: strict, owner never accepted, frequencies limited, amounts as decimal strings, note with OTHER", () => {
  const recurring = { ...keys, description: "Arriendo", categoryId: uuid(3), paymentMethod: "BANK_TRANSFER", frequency: "MONTHLY", interval: 1, anchorDate: "2026-12-01", estimatedAmount: "600000" };
  assert.equal(createRecurringSchema.safeParse(recurring).success, true);
  for (const bad of [{ ...recurring, ownerId: uuid(9) }, { ...recurring, frequency: "BIWEEKLY" }, { ...recurring, interval: 13 }, { ...recurring, interval: 0 }, { ...recurring, estimatedAmount: 600000 },
    { ...recurring, paymentMethod: "OTHER" }, { ...recurring, endDate: "2026-11-30" }, { ...recurring, anchorDate: "2026-02-30" }])
    assert.equal(createRecurringSchema.safeParse(bad).success, false, JSON.stringify(bad));
  assert.equal(updateRecurringSchema.safeParse({ ...keys, expectedVersion: 1 }).success, false, "an edit must change something");
  assert.equal(updateRecurringSchema.safeParse({ ...keys, expectedVersion: 1, estimatedAmount: null }).success, true, "the estimate can be cleared");
  const single = { ...keys, dueDate: "2027-01-15", description: "Impuesto predial", categoryId: uuid(3), paymentMethod: "CASH" };
  assert.equal(createScheduledSchema.safeParse(single).success, true, "planned amount optional, future due date allowed");
  assert.equal(createScheduledSchema.safeParse({ ...single, status: "PAID" }).success, false);
  const pay = { ...keys, expectedVersion: 1, amount: "610000", expenseDate: "2026-11-25", paymentMethod: "NEQUI" };
  assert.equal(payScheduledSchema.safeParse(pay).success, true);
  for (const bad of [{ ...pay, amount: undefined }, { ...pay, amount: "0" }, { ...pay, amount: "1.5" }, { ...pay, paymentMethod: "OTHER" }, { ...pay, ownerId: uuid(9) }])
    assert.equal(payScheduledSchema.safeParse(bad).success, false, JSON.stringify(bad));
  assert.equal(cancelScheduledSchema.safeParse({ ...keys, expectedVersion: 2 }).success, true, "reason optional");
  assert.deepEqual(scheduledListSchema.parse({}), { status: "PENDING", kind: "all" });
  assert.equal(scheduledListSchema.safeParse({ from: "2026-01-01", to: "2027-06-01" }).success, false, "range at most a year");
  assert.equal(expenseListSchema.safeParse({ from: "2026-11-01", to: "2026-11-30", origin: "fixed" }).success, true);
  assert.equal(expenseListSchema.safeParse({ from: "2026-11-01", to: "2026-11-30", origin: "single" }).success, false);
});

test("routes: F1b paths are not read as expense ids; owner from the session; errors mapped", async () => {
  const calls: string[] = [];
  const handler = (name: string, result: unknown = { ok: true }) => async (owner: string) => { calls.push(`${name}:${owner}`); if (result instanceof Error) throw result; return result; };
  const { ExpenseError } = await import("../repositories/expense.repository.js");
  const service = {
    syncScheduled: handler("sync", { generated: 2, pendingCount: 3 }), listScheduled: handler("listScheduled"), listRecurring: handler("listRecurring"),
    createScheduled: handler("createScheduled", { idempotent: false }), payScheduled: handler("pay", new ExpenseError("INVALID_SCHEDULED_TRANSITION")),
    cancelScheduled: handler("cancel", new ExpenseError("SCHEDULED_EXPENSE_NOT_FOUND")), detail: handler("detail"),
  } as unknown as ExpenseService;
  const auth = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (req.headers.authorization !== "Bearer ok") return res.status(401).json({ success: false });
    (req as unknown as { user: { id: string; email: string } }).user = { id: "owner-a", email: "owner@example.invalid" }; next(); return undefined;
  };
  const app = express(); app.use("/api", makeExpenseRouter(makeExpenseController(service), auth));
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}/api`, headers = { authorization: "Bearer ok", "content-type": "application/json" };
  try {
    assert.equal((await fetch(`${base}/expenses/scheduled/sync`, { method: "POST" })).status, 401);
    const sync = await fetch(`${base}/expenses/scheduled/sync`, { method: "POST", headers });
    assert.equal(sync.status, 200); assert.deepEqual(await sync.json(), { success: true, result: { generated: 2, pendingCount: 3 } });
    assert.equal(sync.headers.get("cache-control"), "private, no-store");
    assert.equal((await fetch(`${base}/expenses/scheduled`, { headers })).status, 200);
    assert.equal((await fetch(`${base}/expenses/recurring`, { headers })).status, 200);
    assert.equal((await fetch(`${base}/expenses/scheduled`, { method: "POST", headers, body: "{}" })).status, 201);
    const pay = await fetch(`${base}/expenses/scheduled/${uuid(5)}/pay`, { method: "POST", headers, body: "{}" });
    assert.equal(pay.status, 409); assert.equal((await pay.json() as { error: string }).error, "INVALID_SCHEDULED_TRANSITION");
    assert.equal((await fetch(`${base}/expenses/scheduled/${uuid(5)}/cancel`, { method: "POST", headers, body: "{}" })).status, 404);
    assert.deepEqual(calls, ["sync:owner-a", "listScheduled:owner-a", "listRecurring:owner-a", "createScheduled:owner-a", "pay:owner-a", "cancel:owner-a"], "never the expense detail route");
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
