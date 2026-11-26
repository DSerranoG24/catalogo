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

/** Stages appended by later F1b commits (API and figures). */
export const laterStages: ((context: Context) => Promise<void>)[] = [];

async function main() {
  const context = await prepare();
  await schemaStages(context);
  for (const run of laterStages) await run(context);
}

main().then(() => { console.log(JSON.stringify({ success: true, checks: results, observations, productionAccess: false }, null, 2)); })
  .catch(error => { process.exitCode = 1; console.log(JSON.stringify({ success: false, stage, error: error instanceof Error ? error.message.slice(0, 700) : "UNKNOWN", checks: results }, null, 2)); })
  .finally(async () => {
    try { if (database && schemaCreated) await database.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`); } catch { /* reported by the run */ }
    await database?.$disconnect();
    if (folder) await rm(folder, { recursive: true, force: true });
  });
