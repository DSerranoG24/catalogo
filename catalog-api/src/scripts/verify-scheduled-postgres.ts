import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { Prisma, PrismaClient } from "@prisma/client";

// Rehearsal of Gastos F1b (docs/expenses-f1b-contract.md) on a local throwaway PostgreSQL (never production).
// Usage: '<postgresql://user@127.0.0.1:port/catalogo_test>' | node dist/scripts/verify-scheduled-postgres.js
const moduleRequire = createRequire(__filename);
const runId = randomUUID().replaceAll("-", "");
const schema = `scheduled_verify_${runId}`;
const results: string[] = [];
const observations: Record<string, unknown> = {};
let stage = "INPUT_VALIDATION";
let database: PrismaClient | undefined;
let schemaCreated = false;
let folder: string | undefined;
const loopback = (host: string) => host === "::1" || /^127(?:\.\d{1,3}){3}$/.test(host);
const passed = (check: string) => results.push(check);
/** Expects a failure whose message (or Postgres code) matches. Messages never include data. */
async function rejects(work: () => Promise<unknown>, pattern: RegExp, label: string) {
  try { await work(); } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    assert.match(text, pattern, label); return;
  }
  assert.fail(`${label}: expected a failure`);
}

export type Context = { db: PrismaClient; url: string; ids: Record<string, string> };

async function prepare(): Promise<Context> {
  let input = "";
  for await (const chunk of process.stdin) { input += String(chunk); assert.ok(input.length <= 8192); }
  const target = new URL(input.trim());
  const host = target.hostname.replace(/^\[|\]$/g, "");
  assert.ok(["postgres:", "postgresql:"].includes(target.protocol));
  assert.ok(["localhost", "127.0.0.1", "::1"].includes(host));
  assert.equal(target.pathname, "/catalogo_test");
  assert.ok([...target.searchParams.keys()].every(key => key === "schema"));
  assert.ok((await lookup(host, { all: true })).every(address => loopback(address.address)));
  target.search = ""; target.searchParams.set("schema", schema); target.searchParams.set("connection_limit", "8");
  process.env.DATABASE_URL = target.toString();
  database = new PrismaClient({ datasources: { db: { url: target.toString() } }, log: [] });
  const db = database;
  const [identity] = await db.$queryRaw<{ db: string; address: string }[]>`SELECT current_database() AS db, host(inet_server_addr()) AS address`;
  assert.ok(identity && identity.db === "catalogo_test" && loopback(identity.address));
  await db.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`); schemaCreated = true;
  await db.$disconnect();

  stage = "ALL_MIGRATIONS";
  folder = await mkdtemp(path.join(tmpdir(), "vitrinaya-scheduled-"));
  await writeFile(path.join(folder, "schema.prisma"), await readFile("prisma/schema.prisma"));
  await cp(path.resolve("prisma/migrations"), path.join(folder, "migrations"), { recursive: true });
  const cli = (args: string[]) => spawnSync(process.execPath, [moduleRequire.resolve("prisma/build/index.js"), ...args],
    { cwd: folder, env: { ...process.env, DATABASE_URL: target.toString() }, encoding: "utf8", timeout: 180000, maxBuffer: 1024 * 1024 });
  const deploy = cli(["migrate", "deploy", "--schema", path.join(folder, "schema.prisma")]);
  // CLI output may include connection details: only the Prisma code is reported.
  assert.equal(deploy.status, 0, `MIGRATION_DEPLOY_FAILED ${`${deploy.stdout}${deploy.stderr}`.match(/\bP\d{4}\b/)?.[0] ?? ""}`);
  const [applied] = await db.$queryRawUnsafe<{ n: bigint; last: string }[]>(`SELECT count(*) AS n, max(migration_name) AS last FROM "${schema}"._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`);
  observations.migrations = Number(applied?.n); observations.lastMigration = applied?.last;
  assert.equal(applied?.last, "20261126000000_scheduled_expense_payments");
  // No drift between the migrated database and schema.prisma (exit code 0 = no difference).
  const drift = cli(["migrate", "diff", "--from-url", target.toString(), "--to-schema-datamodel", path.join(folder, "schema.prisma"), "--exit-code"]);
  assert.equal(drift.status, 0, "schema.prisma and the migrated database differ");
  passed(`${observations.migrations} migrations applied, the last one is F1b; no drift against schema.prisma`);
  return { db, url: target.toString(), ids: {} };
}

/** Database-level guarantees of migration 20261126000000_scheduled_expense_payments. */
async function schemaStages({ db, ids }: Context) {
  stage = "FIXTURES";
  const [a, b] = await Promise.all(["a", "b"].map(name => db.user.create({ data: { email: `${runId}-${name}@example.invalid` }, select: { id: true } })));
  assert.ok(a && b);
  const category = (ownerId: string) => db.expenseCategory.create({ data: { ownerId, name: "Arriendo", normalizedKey: "arriendo" }, select: { id: true } });
  const [catA, catB] = [await category(a.id), await category(b.id)];
  const template = await db.recurringExpenseTemplate.create({ data: { ownerId: a.id, description: "Arriendo del local", categoryId: catA.id, paymentMethod: "BANK_TRANSFER",
    estimatedAmount: 600000n, frequency: "MONTHLY", interval: 1, anchorDate: new Date("2026-01-01T00:00:00Z") }, select: { id: true } });
  Object.assign(ids, { a: a.id, b: b.id, catA: catA.id, catB: catB.id, template: template.id });
  const occurrence = (occurrenceDate: string, extra: Prisma.ScheduledExpensePaymentUncheckedCreateInput | object = {}) => db.scheduledExpensePayment.create({ data: {
    ownerId: a.id, templateId: template.id, occurrenceDate: new Date(`${occurrenceDate}T00:00:00Z`), dueDate: new Date(`${occurrenceDate}T00:00:00Z`), plannedAmount: 600000n,
    description: "Arriendo del local", categoryId: catA.id, paymentMethod: "BANK_TRANSFER", ...extra } });
  passed("Fixtures: two accounts, categories and a monthly fixed expense");

  stage = "OCCURRENCE_UNIQUE";
  const march = await occurrence("2026-03-01");
  await rejects(() => occurrence("2026-03-01"), /Unique constraint|23505/, "same template and occurrenceDate twice");
  const inserted = await db.$executeRaw`INSERT INTO scheduled_expense_payments (id, "ownerId", "templateId", "occurrenceDate", "dueDate", description, "categoryId", "paymentMethod", "updatedAt")
    VALUES (${randomUUID()}, ${a.id}, ${template.id}, DATE '2026-03-01', DATE '2026-03-01', 'Arriendo del local', ${catA.id}, 'BANK_TRANSFER', now()) ON CONFLICT DO NOTHING`;
  assert.equal(inserted, 0, "ON CONFLICT DO NOTHING ignores the duplicate silently");
  await db.scheduledExpensePayment.update({ where: { id: march.id }, data: { status: "CANCELLED", cancelledAt: new Date(), version: { increment: 1 } } });
  const regenerated = await occurrence("2026-03-01");
  assert.notEqual(regenerated.id, march.id, "a cancelled occurrence does not block regenerating its date");
  passed("Partial unique (templateId, occurrenceDate) without CANCELLED; ON CONFLICT DO NOTHING ignores duplicates");

  stage = "CHECKS";
  await rejects(() => db.scheduledExpensePayment.create({ data: { ownerId: a.id, dueDate: new Date("2026-04-01T00:00:00Z"), description: "x", categoryId: catA.id, paymentMethod: "OTHER" } }), /scheduled_expense_payments_valid_check|23514/, "OTHER without note");
  await rejects(() => db.scheduledExpensePayment.create({ data: { ownerId: a.id, dueDate: new Date("2026-04-01T00:00:00Z"), description: "x", categoryId: catA.id, paymentMethod: "CASH", plannedAmount: 0n } }), /valid_check|23514/, "planned amount 0");
  await rejects(() => db.scheduledExpensePayment.create({ data: { ownerId: a.id, templateId: template.id, dueDate: new Date("2026-04-01T00:00:00Z"), description: "x", categoryId: catA.id, paymentMethod: "CASH" } }), /valid_check|23514/, "template without occurrenceDate");
  await rejects(() => db.scheduledExpensePayment.create({ data: { ownerId: a.id, status: "PAID", dueDate: new Date("2026-04-01T00:00:00Z"), description: "x", categoryId: catA.id, paymentMethod: "CASH" } }), /status_check|23514/, "PAID without expense");
  await rejects(() => db.scheduledExpensePayment.create({ data: { ownerId: a.id, dueDate: new Date("2026-04-01T00:00:00Z"), description: "x", categoryId: catB.id, paymentMethod: "CASH" } }), /Foreign key|23503/, "category of another account");
  passed("CHECKs: note with OTHER, amount range, template ⇔ occurrence, status columns; composite FK rejects another account's category");

  stage = "PAY_COHERENCE";
  const pending = await occurrence("2026-04-01");
  // Paying correctly: expense + payment PAID in one transaction.
  const paid = await db.$transaction(async tx => {
    const expense = await tx.expense.create({ data: { ownerId: a.id, status: "CONFIRMED", source: "MANUAL", expenseDate: new Date("2026-04-01T00:00:00Z"), amount: 610000n, categoryId: catA.id,
      paymentMethod: "BANK_TRANSFER", description: "Arriendo del local", confirmedAt: new Date(), scheduledPaymentId: pending.id } });
    await tx.scheduledExpensePayment.update({ where: { id: pending.id }, data: { status: "PAID", paidExpenseId: expense.id, paidAt: new Date(), version: { increment: 1 } } });
    return expense;
  });
  // A linked CONFIRMED expense while the payment is not PAID fails at commit.
  const loose = await occurrence("2026-05-01");
  await rejects(() => db.$transaction(async tx => tx.expense.create({ data: { ownerId: a.id, status: "CONFIRMED", source: "MANUAL", expenseDate: new Date("2026-05-01T00:00:00Z"), amount: 1n,
    categoryId: catA.id, paymentMethod: "CASH", description: "x", confirmedAt: new Date(), scheduledPaymentId: loose.id } })), /SCHEDULED_PAYMENT_INCOHERENT/, "linked expense without PAID");
  // A second current expense for the same payment.
  await rejects(() => db.expense.create({ data: { ownerId: a.id, status: "CONFIRMED", source: "MANUAL", expenseDate: new Date("2026-04-02T00:00:00Z"), amount: 1n, categoryId: catA.id,
    paymentMethod: "CASH", description: "x", confirmedAt: new Date(), scheduledPaymentId: pending.id } }), /Unique constraint|23505/, "two current expenses for one payment");
  // Another account cannot link its expense to A's payment.
  await rejects(() => db.expense.create({ data: { ownerId: b.id, status: "CONFIRMED", source: "MANUAL", expenseDate: new Date("2026-04-02T00:00:00Z"), amount: 1n, categoryId: catB.id,
    paymentMethod: "CASH", description: "x", confirmedAt: new Date(), scheduledPaymentId: loose.id } }), /Foreign key|23503/, "cross-account link");
  // The link of a CONFIRMED expense cannot change (F1a guard).
  await rejects(() => db.expense.update({ where: { id: paid.id }, data: { scheduledPaymentId: loose.id } }), /INVALID_EXPENSE_TRANSITION|23514/, "link is immutable");
  passed("Coherence at commit (PAID ⇔ one current linked expense), one current expense per payment, no cross-account link, immutable link");

  stage = "VOID_FLOWS";
  // Void and replace: the replacement inherits the link and the payment stays PAID.
  const replacement = await db.$transaction(async tx => {
    await tx.expense.update({ where: { id: paid.id }, data: { status: "VOIDED", voidedAt: new Date(), voidReason: "Monto equivocado", version: { increment: 1 } } });
    const next = await tx.expense.create({ data: { ownerId: a.id, status: "CONFIRMED", source: "MANUAL", expenseDate: new Date("2026-04-01T00:00:00Z"), amount: 600000n, categoryId: catA.id,
      paymentMethod: "BANK_TRANSFER", description: "Arriendo del local", confirmedAt: new Date(), replacesExpenseId: paid.id, scheduledPaymentId: pending.id } });
    await tx.scheduledExpensePayment.update({ where: { id: pending.id }, data: { paidExpenseId: next.id, paidAt: new Date(), version: { increment: 1 } } });
    return next;
  });
  // Void without replacement: the payment returns to PENDING (decision F1b-1).
  await db.$transaction(async tx => {
    await tx.expense.update({ where: { id: replacement.id }, data: { status: "VOIDED", voidedAt: new Date(), voidReason: "Registrado dos veces", version: { increment: 1 } } });
    await tx.scheduledExpensePayment.update({ where: { id: pending.id }, data: { status: "PENDING", paidExpenseId: null, paidAt: null, version: { increment: 1 } } });
  });
  // Voiding without reopening the payment fails at commit.
  const again = await db.$transaction(async tx => {
    const expense = await tx.expense.create({ data: { ownerId: a.id, status: "CONFIRMED", source: "MANUAL", expenseDate: new Date("2026-04-03T00:00:00Z"), amount: 600000n, categoryId: catA.id,
      paymentMethod: "BANK_TRANSFER", description: "Arriendo del local", confirmedAt: new Date(), scheduledPaymentId: pending.id } });
    await tx.scheduledExpensePayment.update({ where: { id: pending.id }, data: { status: "PAID", paidExpenseId: expense.id, paidAt: new Date(), version: { increment: 1 } } });
    return expense;
  });
  await rejects(() => db.expense.update({ where: { id: again.id }, data: { status: "VOIDED", voidedAt: new Date(), voidReason: "Sin reabrir", version: { increment: 1 } } }), /SCHEDULED_PAYMENT_INCOHERENT/, "void without reopening");
  assert.equal((await db.expense.count({ where: { scheduledPaymentId: pending.id } })), 3, "voided expenses stay as history");
  passed("Void + replace keeps PAID with the replacement; void alone reopens to PENDING; paying again after a void works; voiding without reopening is rejected");

  stage = "TRANSITIONS";
  await rejects(() => db.scheduledExpensePayment.update({ where: { id: march.id }, data: { description: "Otra" } }), /INVALID_SCHEDULED_TRANSITION/, "CANCELLED is terminal");
  await rejects(() => db.scheduledExpensePayment.update({ where: { id: pending.id }, data: { status: "CANCELLED", cancelledAt: new Date(), paidExpenseId: null, paidAt: null } }), /INVALID_SCHEDULED_TRANSITION/, "PAID cannot be cancelled");
  const free = await occurrence("2026-06-01");
  await rejects(() => db.scheduledExpensePayment.update({ where: { id: free.id }, data: { status: "CANCELLED", cancelledAt: new Date(), description: "Cambiada" } }), /INVALID_SCHEDULED_TRANSITION/, "cancel only changes its own columns");
  await rejects(() => db.scheduledExpensePayment.update({ where: { id: free.id }, data: { occurrenceDate: new Date("2026-06-02T00:00:00Z") } }), /EXPENSE_IDENTITY_IMMUTABLE/, "occurrenceDate is immutable");
  await db.scheduledExpensePayment.update({ where: { id: free.id }, data: { dueDate: new Date("2026-06-05T00:00:00Z"), plannedAmount: 620000n, customizedAt: new Date(), version: { increment: 1 } } });
  await rejects(() => db.scheduledExpensePayment.delete({ where: { id: free.id } }), /EXPENSE_DELETE_FORBIDDEN/, "no deletes");
  await rejects(() => db.expense.create({ data: { ownerId: a.id, status: "CONFIRMED",
    source: "RECURRING", templateId: template.id, occurrenceDate: new Date("2026-07-01T00:00:00Z"), expenseDate: new Date("2026-07-01T00:00:00Z"), amount: 1n, categoryId: catA.id, paymentMethod: "CASH",
    description: "x", confirmedAt: new Date(), scheduledPaymentId: free.id } }), /expenses_scheduled_source_check|23514/, "linked expenses keep source MANUAL");
  passed("Transitions: CANCELLED terminal, PAID not cancellable, each transition changes only its columns, identity frozen, rescheduling allowed, no deletes, linked expenses are MANUAL");
}

/** API-level stages (F1b-2): repositories against the real schema with a fixed clock (Bogotá 2026-03-10). */
async function apiStages({ db, ids }: Context) {
  const { makeScheduledExpenseRepository } = await import("../repositories/scheduled-expense.repository.js");
  const { makeExpenseRepository } = await import("../repositories/expense.repository.js");
  const clock = () => new Date("2026-03-10T15:00:00.000Z");
  const scheduled = makeScheduledExpenseRepository(db, clock), expenses = makeExpenseRepository(db, clock);
  const keys = () => ({ operationId: randomUUID(), requestId: randomUUID() });
  const a = ids.a as string, b = ids.b as string, catA = ids.catA as string;
  const pendingOf = (templateId: string) => db.scheduledExpensePayment.findMany({ where: { templateId, status: "PENDING" }, orderBy: { dueDate: "asc" } });
  const dates = (rows: { dueDate: Date }[]) => rows.map(r => r.dueDate.toISOString().slice(0, 10));

  stage = "API_CREATE_AND_SYNC";
  const rent = await scheduled.createRecurring(a, { ...keys(), description: "Arriendo local", categoryId: catA, paymentMethod: "BANK_TRANSFER", estimatedAmount: "600000",
    frequency: "MONTHLY", interval: 1, anchorDate: "2026-01-31" }) as unknown as { template: { id: string; version: number }; generated: number };
  assert.equal(rent.generated, 2, "anchor in the past: only the latest due date (Feb 28) plus the future one (Mar 31)");
  assert.deepEqual(dates(await pendingOf(rent.template.id)), ["2026-02-28", "2026-03-31"]);
  // A fixed expense created directly (never synced) and five syncs at once: no duplicates, no errors.
  const weekly = await db.recurringExpenseTemplate.create({ data: { ownerId: a, description: "Domicilios", categoryId: catA, paymentMethod: "CASH", estimatedAmount: 50000n,
    frequency: "WEEKLY", interval: 1, anchorDate: new Date("2026-03-12T00:00:00Z") } });
  const runs = await Promise.all(Array.from({ length: 5 }, () => scheduled.sync(a)));
  assert.equal(runs.reduce((sum, r) => sum + r.generated, 0), 3, "Mar 12, 19 and 26 generated once in total");
  assert.deepEqual(dates(await pendingOf(weekly.id)), ["2026-03-12", "2026-03-19", "2026-03-26"]);
  assert.equal((await scheduled.sync(a)).generated, 0, "sync again: nothing new");
  passed("Create + sync: past anchor keeps only the latest due date; five syncs in parallel generate each date once, without errors");

  stage = "API_PAY";
  const [feb] = await pendingOf(rent.template.id);
  assert.ok(feb);
  const payKeys = keys();
  const pay = { ...payKeys, expectedVersion: feb.version, amount: "610000", expenseDate: "2026-03-05", paymentMethod: "NEQUI" as const };
  const [first, second] = await Promise.all([scheduled.payScheduled(a, feb.id, pay), scheduled.payScheduled(a, feb.id, { ...pay, requestId: randomUUID() })]) as unknown as { idempotent: boolean; expense: { id: string; amount: string } }[];
  assert.ok(first && second);
  assert.equal(first.expense.id, second.expense.id, "same operationId: same expense"); assert.deepEqual([first.idempotent, second.idempotent].sort(), [false, true]);
  assert.equal(first.expense.amount, "610000", "paid amount differs from the planned 600000");
  assert.equal(await db.expense.count({ where: { scheduledPaymentId: feb.id } }), 1, "one expense");
  await rejects(() => scheduled.payScheduled(a, feb.id, { ...pay, ...keys() }), /INVALID_SCHEDULED_TRANSITION/, "another operation on a PAID payment");
  const [mar] = (await pendingOf(rent.template.id));
  assert.ok(mar);
  await rejects(() => scheduled.payScheduled(a, mar.id, { ...keys(), expectedVersion: mar.version, amount: "1", expenseDate: "2026-03-11", paymentMethod: "CASH" }), /INVALID_EXPENSE_INPUT/, "payment date in the future");
  await rejects(() => scheduled.payScheduled(b, mar.id, { ...keys(), expectedVersion: mar.version, amount: "1", expenseDate: "2026-03-10", paymentMethod: "CASH" }), /SCHEDULED_EXPENSE_NOT_FOUND/, "another account");
  passed("Pay: repeated (parallel) with the same operationId creates one expense; amount may differ; another operation, future date and another account are rejected");

  stage = "API_VOID";
  const paidExpense = await db.expense.findFirstOrThrow({ where: { id: first.expense.id } });
  await expenses.voidExpense(a, paidExpense.id, { ...keys(), expectedVersion: paidExpense.version, reason: "Registrado dos veces" });
  let state = await db.scheduledExpensePayment.findUniqueOrThrow({ where: { id: feb.id } });
  assert.equal(state.status, "PENDING", "void without replacement reopens (decision F1b-1)");
  const repaid = await scheduled.payScheduled(a, feb.id, { ...keys(), expectedVersion: state.version, amount: "600000", expenseDate: "2026-03-06", paymentMethod: "BANK_TRANSFER" }) as unknown as { expense: { id: string; version: number } };
  const replaced = await expenses.voidExpense(a, repaid.expense.id, { ...keys(), expectedVersion: repaid.expense.version, reason: "Monto equivocado",
    replacement: { expenseDate: "2026-03-06", amount: "600500", categoryId: catA, paymentMethod: "BANK_TRANSFER", description: "Arriendo local" } }) as unknown as { replacement: { id: string; scheduledPaymentId: string } };
  state = await db.scheduledExpensePayment.findUniqueOrThrow({ where: { id: feb.id } });
  assert.equal(state.status, "PAID"); assert.equal(state.paidExpenseId, replaced.replacement.id); assert.equal(replaced.replacement.scheduledPaymentId, feb.id);
  const reopened = await db.expenseEvent.count({ where: { entityKind: "SCHEDULED_PAYMENT", entityId: feb.id, eventType: { in: ["REOPENED", "PAYMENT_REPLACED", "PAID"] } } });
  assert.equal(reopened, 4, "PAID, REOPENED, PAID, PAYMENT_REPLACED in the history");
  passed("Void without replacement → PENDING; pay again; void with replacement → PAID pointing to the replacement; history keeps every step");

  stage = "API_EDIT_TEMPLATE";
  const weeklyRows = await pendingOf(weekly.id);
  const nineteenth = weeklyRows[1]!;
  await scheduled.updateScheduled(a, nineteenth.id, { ...keys(), expectedVersion: nineteenth.version, dueDate: "2026-03-20", plannedAmount: "55000" });
  let template = await db.recurringExpenseTemplate.findUniqueOrThrow({ where: { id: weekly.id } });
  const amountEdit = await scheduled.updateRecurring(a, weekly.id, { ...keys(), expectedVersion: template.version, estimatedAmount: "52000" }) as unknown as { updatedPayments: number };
  assert.equal(amountEdit.updatedPayments, 2, "Mar 12 and 26 updated; the rescheduled Mar 19 is customized");
  const afterEdit = await pendingOf(weekly.id);
  assert.deepEqual(afterEdit.map(r => [r.dueDate.toISOString().slice(0, 10), r.plannedAmount?.toString()]), [["2026-03-12", "52000"], ["2026-03-20", "55000"], ["2026-03-26", "52000"]]);
  template = await db.recurringExpenseTemplate.findUniqueOrThrow({ where: { id: weekly.id } });
  const ruleEdit = await scheduled.updateRecurring(a, weekly.id, { ...keys(), expectedVersion: template.version, interval: 2 }) as unknown as { cancelled: number; generated: number };
  assert.equal(ruleEdit.cancelled, 2); assert.equal(ruleEdit.generated, 2, "every 2 weeks from the anchor: Mar 12 and 26 again (cancelled ones do not block)");
  assert.deepEqual(dates(await pendingOf(weekly.id)), ["2026-03-12", "2026-03-20", "2026-03-26"]);
  passed("Edit a fixed expense: amount changes future uncustomized pending only (decision F1b-5); a rule change cancels them and regenerates");

  stage = "API_PAUSE_RESUME_END";
  template = await db.recurringExpenseTemplate.findUniqueOrThrow({ where: { id: weekly.id } });
  const paused = await scheduled.setRecurringState(a, weekly.id, "pause", { ...keys(), expectedVersion: template.version }) as unknown as { cancelled: number };
  assert.equal(paused.cancelled, 3, "pausing cancels the future pending ones");
  assert.equal((await scheduled.sync(a)).generated, 0, "a paused fixed expense generates nothing");
  template = await db.recurringExpenseTemplate.findUniqueOrThrow({ where: { id: weekly.id } });
  const resumed = await scheduled.setRecurringState(a, weekly.id, "resume", { ...keys(), expectedVersion: template.version }) as unknown as { generated: number };
  assert.equal(resumed.generated, 2, "resume generates the future dates again (Mar 12 and 26)");
  template = await db.recurringExpenseTemplate.findUniqueOrThrow({ where: { id: weekly.id } });
  await scheduled.setRecurringState(a, weekly.id, "end", { ...keys(), expectedVersion: template.version });
  assert.equal((await pendingOf(weekly.id)).length, 0); assert.equal((await db.recurringExpenseTemplate.findUniqueOrThrow({ where: { id: weekly.id } })).status, "ENDED");
  template = await db.recurringExpenseTemplate.findUniqueOrThrow({ where: { id: weekly.id } });
  await rejects(() => scheduled.setRecurringState(a, weekly.id, "resume", { ...keys(), expectedVersion: template.version }), /INVALID_RECURRING_TRANSITION/, "ENDED is terminal");
  passed("Pause cancels future pending and stops generation; resume regenerates without the paused dates; end is terminal");

  stage = "API_SINGLE";
  const single = await scheduled.createScheduled(a, { ...keys(), dueDate: "2026-04-15", plannedAmount: "320000", description: "Impuesto predial", categoryId: catA, paymentMethod: "CASH" }) as unknown as { payment: { id: string; version: number; kind: string } };
  assert.equal(single.payment.kind, "single");
  await rejects(() => scheduled.createScheduled(a, { ...keys(), dueDate: "2027-03-12", description: "Muy lejos", categoryId: catA, paymentMethod: "CASH" }), /INVALID_EXPENSE_INPUT/, "more than 366 days ahead");
  await scheduled.cancelScheduled(a, single.payment.id, { ...keys(), expectedVersion: single.payment.version, reason: "Ya no aplica" });
  await rejects(() => scheduled.cancelScheduled(a, single.payment.id, { ...keys(), expectedVersion: single.payment.version + 1 }), /INVALID_SCHEDULED_TRANSITION/, "cancel is terminal");
  const listedB = await scheduled.listScheduled(b, { status: "all", kind: "all" });
  assert.equal(listedB.items.length, 0, "B sees none of A's payments");
  const listedA = await scheduled.listScheduled(a, { status: "PENDING", kind: "fixed" });
  assert.ok(listedA.items.every(item => item.kind === "fixed" && item.status === "PENDING"));
  passed("One-off: future due date, limit of 366 days, cancel is terminal; lists are owner-scoped and filter by kind");
  observations.eventsWritten = await db.expenseEvent.count({ where: { ownerId: a } });
}

/** Figures (F1b-3): scheduled payments never add; fixed n of m, variable, upcoming and overdue; reads never generate. */
async function figureStages({ db }: Context) {
  const { makeScheduledExpenseRepository } = await import("../repositories/scheduled-expense.repository.js");
  const { makeExpenseRepository } = await import("../repositories/expense.repository.js");
  const { expenseOverviewSql, monthBounds, presentOverview } = await import("../repositories/expense-overview.repository.js");
  const { dashboardExpensesSql, dashboardSummarySql, readDashboardSummary } = await import("../repositories/dashboard-summary.repository.js");
  const { presentSummary } = await import("../services/dashboard-summary.js");
  const asOf = new Date("2026-03-10T15:00:00.000Z"), clock = () => asOf; // 10 Mar 2026 in Bogotá
  const scheduled = makeScheduledExpenseRepository(db, clock), expenses = makeExpenseRepository(db, clock);
  const keys = () => ({ operationId: randomUUID(), requestId: randomUUID() });

  stage = "FIGURES_FIXTURES";
  const c = await db.user.create({ data: { email: `${runId}-c@example.invalid` }, select: { id: true } });
  const cat = (await db.expenseCategory.create({ data: { ownerId: c.id, name: "Servicios", normalizedKey: "servicios" }, select: { id: true } })).id;
  const fixed = (anchorDate: string, estimatedAmount?: string) => scheduled.createRecurring(c.id, { ...keys(), description: `Fijo ${anchorDate}`, categoryId: cat, paymentMethod: "CASH",
    frequency: "MONTHLY", interval: 1, anchorDate, ...(estimatedAmount ? { estimatedAmount } : {}) });
  await fixed("2026-03-05", "100000"); await fixed("2026-03-15", "200000"); await fixed("2026-03-28");
  const single = (dueDate: string, plannedAmount?: string) => scheduled.createScheduled(c.id, { ...keys(), dueDate, description: `Único ${dueDate}`, categoryId: cat, paymentMethod: "CASH", ...(plannedAmount ? { plannedAmount } : {}) });
  await single("2026-03-12", "50000"); await single("2026-04-20", "999999"); await single("2026-03-01");
  const fifth = await db.scheduledExpensePayment.findFirstOrThrow({ where: { ownerId: c.id, occurrenceDate: new Date("2026-03-05T00:00:00Z") } });
  await scheduled.payScheduled(c.id, fifth.id, { ...keys(), expectedVersion: fifth.version, amount: "110000", expenseDate: "2026-03-08", paymentMethod: "CASH" });
  await expenses.createExpense(c.id, { ...keys(), expenseDate: "2026-03-09", amount: "70000", categoryId: cat, paymentMethod: "CASH", description: "Gasto variable" });
  passed("Figures fixtures: three fixed expenses (one paid with a different amount), three one-offs (upcoming, later, overdue without amount), one variable expense");

  stage = "FIGURES_OVERVIEW";
  const bounds = monthBounds("2026-03", "2026-03-10");
  const [row] = await db.$queryRaw<{ data: unknown }[]>(expenseOverviewSql(c.id, bounds));
  const march = presentOverview(row?.data, "2026-03", bounds, asOf);
  assert.equal(march.total, "180000", "only real expenses add: 110000 paid + 70000 variable; planned amounts never add");
  assert.deepEqual(march.scheduled, { fixed: { due: 3, paid: 1, paidTotal: "110000" }, upcoming: { count: 2, plannedTotal: "250000", withoutAmount: 0 }, overdue: { count: 1, plannedTotal: "0", withoutAmount: 1 } });
  assert.deepEqual(march.variable, { total: "70000", count: 1 });
  const febBounds = monthBounds("2026-02", "2026-03-10");
  const [febRow] = await db.$queryRaw<{ data: unknown }[]>(expenseOverviewSql(c.id, febBounds));
  const february = presentOverview(febRow?.data, "2026-02", febBounds, asOf);
  assert.equal(february.scheduled.upcoming, null); assert.equal(february.scheduled.overdue, null); assert.equal(february.scheduled.fixed.due, 0);
  passed("Overview: total ignores scheduled payments; Fijos pagados 1 de 3 ($ 110.000); Variables $ 70.000; Próximos 2 ($ 250.000); Vencidos 1 sin monto; past months without upcoming/overdue");

  stage = "FIGURES_SUMMARY";
  const [summaryRow] = await db.$queryRaw<{ data: unknown }[]>(dashboardSummarySql(c.id, asOf, 7));
  const [expenseRow] = await db.$queryRaw<{ data: unknown }[]>(dashboardExpensesSql(c.id, asOf));
  const summary = presentSummary(summaryRow?.data, expenseRow?.data ?? null, asOf, 7);
  assert.equal(summary.attention.scheduledDueSoonCount, 2); assert.equal(summary.attention.scheduledOverdueCount, 1);
  assert.equal(summary.month.expensesTotal, "180000"); assert.equal(summary.month.estimatedProfit, "-180000", "profit subtracts real expenses only");
  // The real summary runs READ ONLY and never generates occurrences.
  const before = await db.scheduledExpensePayment.count({ where: { ownerId: c.id } });
  const live = await readDashboardSummary(c.id, 7, { database: db });
  assert.equal(await db.scheduledExpensePayment.count({ where: { ownerId: c.id } }), before, "reads never write");
  assert.equal(live.modules.scheduledExpenses, true);
  await rejects(() => db.$transaction(async tx => { await tx.$executeRaw`SET TRANSACTION READ ONLY`; await tx.scheduledExpensePayment.updateMany({ where: { ownerId: c.id }, data: { version: { increment: 1 } } }); }),
    /read-only|25006/, "the summary transaction mode rejects writes");
  passed("Summary: 2 payments due this week, 1 overdue; expenses and profit unaffected by scheduled payments; READ ONLY and never generates");
}

/** Stages appended by later F1b commits (API and figures). */
export const laterStages: ((context: Context) => Promise<void>)[] = [];

async function main() {
  const context = await prepare();
  await schemaStages(context);
  await apiStages(context);
  await figureStages(context);
  for (const run of laterStages) await run(context);
}

main().then(() => { console.log(JSON.stringify({ success: true, checks: results, observations, productionAccess: false }, null, 2)); })
  .catch(error => { process.exitCode = 1; console.log(JSON.stringify({ success: false, stage, error: error instanceof Error ? error.message.slice(0, 700) : "UNKNOWN", checks: results }, null, 2)); })
  .finally(async () => {
    try { if (database && schemaCreated) await database.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`); } catch { /* reported by the run */ }
    await database?.$disconnect();
    if (folder) await rm(folder, { recursive: true, force: true });
  });
