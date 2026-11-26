import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, cp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { Prisma, PrismaClient } from "@prisma/client";
import { inventoryTestTarget } from "./verify-inventory-postgres";
import { makeExpenseRepository, SEED_CATEGORIES } from "../repositories/expense.repository";
import { makeExpenseService } from "../services/expense.service";
import { bogotaToday } from "../services/expense-dates";

// Local rehearsal only: URL from stdin, localhost/catalogo_test, random schema, real migration
// chain with no manual schema changes. Never point this at production.
const requireModule = createRequire(__filename);
const schema = `expenses_${randomBytes(8).toString("hex")}`;
const MIGRATION = "20261125000000_operating_expenses";
const CHECKS = ["expense_categories_valid_check", "expenses_money_check", "expenses_date_check", "expenses_payment_check", "expenses_text_check",
  "expenses_status_check", "expenses_source_check", "recurring_expense_templates_valid_check", "expense_operations_valid_check", "expense_events_valid_check"];
const TRIGGERS = ["expense_operations_immutable", "expense_events_immutable", "expense_categories_guard", "recurring_expense_templates_guard", "expenses_transition_guard"];
let stage = "TARGET_GUARD";
let db: PrismaClient | undefined;
const passed: string[] = [];
function pass(name: string) { passed.push(name); console.log(`PASS ${name}`); }
const keys = () => ({ operationId: randomUUID(), requestId: randomUUID() });
const outcome = (r: PromiseSettledResult<unknown>) => r.status === "fulfilled" ? "OK" : r.reason instanceof Error ? (/^[A-Z_]+$/.test(r.reason.message) ? r.reason.message : String((r.reason as unknown as { code?: string }).code ?? r.reason.name)) : "ERROR";

async function preflightObjectsQuery() {
  const sql = await readFile(path.resolve("../docs/sql/verify-expenses-preflight.sql"), "utf8");
  assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|TRUNCATE|GRANT)\b/i, "preflight SQL must stay read-only");
  const start = sql.indexOf("SELECT 'table'"), end = sql.indexOf(";", start);
  assert.ok(start > 0 && end > start, "PREFLIGHT_SQL_NOT_FOUND");
  return sql.slice(start, end);
}

async function main() {
  let input = "";
  for await (const chunk of process.stdin) { input += String(chunk); assert.ok(input.length < 8192); }
  const target = await inventoryTestTarget(input); input = "";
  target.search = ""; target.searchParams.set("schema", schema); target.searchParams.set("connect_timeout", "5");
  process.env.DATABASE_URL = target.toString(); process.env.NODE_ENV = "test";
  db = new PrismaClient({ datasources: { db: { url: target.toString() } }, log: [] });
  const database = db;
  const [identity] = await database.$queryRaw<{ database: string; address: string }[]>`SELECT current_database() AS database, host(inet_server_addr()) AS address`;
  assert.equal(identity?.database, "catalogo_test"); assert.ok(identity.address === "127.0.0.1" || identity.address === "::1");
  await database.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`); await database.$disconnect();
  pass(stage);

  const folder = await mkdtemp(path.join(tmpdir(), "expenses-migrations-"));
  const migrationRoot = path.resolve("prisma/migrations");
  const names = (await readdir(migrationRoot, { withFileTypes: true })).filter(v => v.isDirectory()).map(v => v.name).sort();
  // The F1a migration is rehearsed over the ones before it; later migrations (F1b onwards) are applied afterwards so the
  // current Prisma client matches the schema.
  const position = names.indexOf(MIGRATION);
  assert.ok(position > 0, "the expenses migration exists");
  const later = names.slice(position + 1);
  await mkdir(path.join(folder, "migrations"));
  await cp("prisma/schema.prisma", path.join(folder, "schema.prisma"));
  await cp(path.join(migrationRoot, "migration_lock.toml"), path.join(folder, "migrations/migration_lock.toml"));
  for (const name of names.slice(0, position)) await cp(path.join(migrationRoot, name), path.join(folder, "migrations", name), { recursive: true });
  // Never echo Prisma output: it may contain connection details.
  const deploy = () => spawnSync(process.execPath, [requireModule.resolve("prisma/build/index.js"), "migrate", "deploy", "--schema", path.join(folder, "schema.prisma")], {
    cwd: folder, env: { ...process.env, DATABASE_URL: target.toString() }, encoding: "utf8", timeout: 120000, windowsHide: true }).status;

  stage = "BASELINE_MIGRATIONS"; assert.equal(deploy(), 0); pass(stage);

  stage = "PREFLIGHT_BEFORE_MIGRATION";
  const objectsQuery = await preflightObjectsQuery();
  assert.equal((await database.$queryRawUnsafe<unknown[]>(objectsQuery)).length, 0, "no object with the new names exists yet");
  const ledgerRows = () => database.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM _prisma_migrations WHERE migration_name = ${MIGRATION}`;
  assert.equal(Number((await ledgerRows())[0].n), 0);
  // Data of earlier modules must survive the additive migration untouched.
  const legacy = await database.user.create({ data: { email: `legacy_${randomUUID()}@example.invalid` } });
  const legacyItem = await database.inventoryItem.create({ data: { userId: legacy.id, name: "Legacy item", sku: "LEGACY-EXP", stock: 7 } });
  pass(stage);

  stage = "MIGRATION_APPLIES";
  await cp(path.join(migrationRoot, MIGRATION), path.join(folder, "migrations", MIGRATION), { recursive: true });
  assert.equal(deploy(), 0);
  assert.equal((await database.inventoryItem.findUniqueOrThrow({ where: { id: legacyItem.id } })).stock, 7, "existing data untouched");
  assert.equal((await database.$queryRawUnsafe<unknown[]>(objectsQuery)).length, 18, "5 tables, 5 types, 3 functions and 5 triggers");
  const constraints = await database.$queryRaw<{ conname: string; validated: boolean }[]>`SELECT conname, convalidated AS validated FROM pg_constraint WHERE connamespace = ${schema}::regnamespace AND conname = ANY(${CHECKS})`;
  assert.deepEqual(constraints.map(c => c.conname).sort(), [...CHECKS].sort()); assert.ok(constraints.every(c => c.validated));
  const triggers = await database.$queryRaw<{ tgname: string }[]>`SELECT t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid WHERE c.relnamespace = ${schema}::regnamespace AND t.tgname = ANY(${TRIGGERS})`;
  assert.deepEqual(triggers.map(t => t.tgname).sort(), [...TRIGGERS].sort());
  pass(stage);

  stage = "LATER_MIGRATIONS";
  for (const name of later) await cp(path.join(migrationRoot, name), path.join(folder, "migrations", name), { recursive: true });
  assert.equal(deploy(), 0);
  pass(stage);

  const A = await database.user.create({ data: { email: `exp_a_${randomUUID()}@example.invalid` } });
  const B = await database.user.create({ data: { email: `exp_b_${randomUUID()}@example.invalid` } });
  const service = makeExpenseService(makeExpenseRepository(database));
  const today = bogotaToday();

  stage = "CONCURRENT_SEED_TWO_ACCOUNTS";
  const seeds = await Promise.allSettled([service.seedCategories(A.id, keys()), service.seedCategories(A.id, keys()), service.seedCategories(B.id, keys())]);
  assert.ok(seeds.every(r => r.status === "fulfilled"), `seeds: ${seeds.map(outcome).join(",")}`);
  for (const owner of [A.id, B.id]) assert.equal(await database.expenseCategory.count({ where: { ownerId: owner } }), SEED_CATEGORIES.length);
  const catsA = await database.expenseCategory.findMany({ where: { ownerId: A.id } }), catsB = await database.expenseCategory.findMany({ where: { ownerId: B.id } });
  const rentA = catsA.find(c => c.seedKey === "rent")!, utilA = catsA.find(c => c.seedKey === "utilities")!, rentB = catsB.find(c => c.seedKey === "rent")!;
  assert.ok(catsA.some(c => c.name === "Nómina y honorarios"));
  pass(stage);

  const body = (categoryId: string, extra: Record<string, unknown> = {}) => ({ ...keys(), expenseDate: today, amount: "150000", categoryId, paymentMethod: "CASH", description: "Arriendo local", ...extra });

  stage = "CHECKS_AND_FKS_REJECT_INVALID_ROWS";
  const raw = (extra: Record<string, unknown>) => ({ ownerId: A.id, status: "CONFIRMED", expenseDate: new Date(`${today}T00:00:00Z`), amount: 1000n, categoryId: rentA.id, paymentMethod: "CASH",
    description: "Synthetic", confirmedAt: new Date(), ...extra }) as unknown as Prisma.ExpenseUncheckedCreateInput;
  for (const extra of [{ amount: 0n }, { amount: 1000000000001n }, { currency: "USD" }, { taxMode: "IVA" }, { expenseDate: new Date("1999-12-31T00:00:00Z") },
    { paymentMethod: "OTHER" }, { paymentMethodNote: "Nota sin OTHER" }, { paymentReference: "x".repeat(101) }, { description: "   " },
    { status: "VOIDED" }, { status: "PENDING_CONFIRMATION" }, { source: "RECURRING" }, { categoryId: rentB.id }, { confirmedAt: null }])
    await assert.rejects(database.expense.create({ data: raw(extra) }), `accepted: ${JSON.stringify(extra, (_k, v) => typeof v === "bigint" ? v.toString() : v)}`);
  await assert.rejects(database.expenseCategory.create({ data: { ownerId: A.id, name: "Arriendo", normalizedKey: "arriendo" } }), "duplicate normalized name");
  assert.equal(await database.expense.count(), 0);
  pass(stage);

  stage = "SERVICE_FLOWS_TWO_ACCOUNTS";
  const created = (await service.createExpense(A.id, body(rentA.id, { paymentReference: "TRX-PRIVATE" })) as unknown as { expense: { id: string; version: number } }).expense;
  const replay = await service.createExpense(A.id, { ...body(rentA.id), operationId: randomUUID() }) as unknown as { idempotent: boolean };
  assert.equal(replay.idempotent, false);
  const reclassified = (await service.reclassifyExpense(A.id, created.id, { ...keys(), expectedVersion: 1, categoryId: utilA.id, description: "Servicios del local" }) as unknown as { expense: { version: number; categoryNameSnapshot: string } }).expense;
  assert.equal(reclassified.categoryNameSnapshot, "Servicios públicos");
  const voided = await service.voidExpense(A.id, created.id, { ...keys(), expectedVersion: reclassified.version, reason: "Monto equivocado",
    replacement: { expenseDate: today, amount: "160000", categoryId: utilA.id, paymentMethod: "OTHER", paymentMethodNote: "Corresponsal bancario", description: "Servicios del local" } }) as unknown as { voided: { status: string }; replacement: { id: string } };
  assert.equal(voided.voided.status, "VOIDED");
  for (const attempt of [() => service.detail(B.id, created.id), () => service.voidExpense(B.id, voided.replacement.id, { ...keys(), expectedVersion: 1, reason: "Ajeno" }),
    () => service.reclassifyExpense(A.id, voided.replacement.id, { ...keys(), expectedVersion: 1, categoryId: rentB.id }), () => service.createExpense(B.id, body(rentA.id))])
    await assert.rejects(attempt(), /NOT_FOUND/);
  const shared = keys();
  const a = await service.createExpense(A.id, { ...body(rentA.id, { amount: "1" }), ...shared }) as unknown as { expense: { id: string } };
  const b = await service.createExpense(B.id, { ...body(rentB.id, { amount: "2" }), ...shared }) as unknown as { expense: { id: string }; idempotent: boolean };
  assert.notEqual(a.expense.id, b.expense.id); assert.equal(b.idempotent, false);
  const list = await service.listExpenses(A.id, { from: today, to: today }) as unknown as { items: Record<string, unknown>[] };
  assert.ok(list.items.every(i => !("paymentReference" in i)));
  assert.equal(((await service.detail(A.id, created.id)) as unknown as { expense: { paymentReference: string } }).expense.paymentReference, "TRX-PRIVATE");
  pass(stage);

  stage = "TRIGGERS_PROTECT_HISTORY";
  const replacementId = voided.replacement.id;
  for (const data of [{ amount: 1n }, { expenseDate: new Date("2026-01-01T00:00:00Z") }, { paymentMethod: "CARD" as const }, { supplierName: "Otro" }, { paymentReference: "R" }])
    await assert.rejects(database.expense.update({ where: { id: replacementId }, data }), `CONFIRMED accepted ${Object.keys(data)[0]}`);
  await database.expense.update({ where: { id: replacementId }, data: { description: "Reclasificado directo", version: { increment: 1 } } }); // allowed: reclassify fields
  await database.expense.update({ where: { id: replacementId }, data: { paymentMethodNote: "Nota nueva", version: { increment: 1 } } });
  await assert.rejects(database.expense.update({ where: { id: created.id }, data: { description: "Cambio en anulado" } }), "VOIDED is terminal");
  await assert.rejects(database.expense.update({ where: { id: created.id }, data: { status: "CONFIRMED", voidedAt: null, voidReason: null } }), "no reopening");
  await assert.rejects(database.expense.delete({ where: { id: replacementId } }), "no deletes");
  await assert.rejects(database.expenseCategory.delete({ where: { id: rentA.id } }), "no category deletes");
  await assert.rejects(database.expenseCategory.update({ where: { id: rentA.id }, data: { seedKey: "changed" } }), "seedKey is identity");
  const event = await database.expenseEvent.findFirstOrThrow({ where: { ownerId: A.id } });
  await assert.rejects(database.expenseEvent.update({ where: { id: event.id }, data: { eventType: "X" } }), "events immutable");
  await assert.rejects(database.$executeRaw`DELETE FROM expense_operations WHERE "ownerId" = ${A.id}`, "receipts immutable");
  pass(stage);

  stage = "CONCURRENCY_RECLASSIFY_AND_SAME_KEY";
  const contested = (await service.createExpense(A.id, body(rentA.id, { amount: "5000" })) as unknown as { expense: { id: string } }).expense;
  const race = await Promise.allSettled([1, 2].map(n => service.reclassifyExpense(A.id, contested.id, { ...keys(), expectedVersion: 1, description: `Concurrente ${n}` })));
  assert.deepEqual(race.map(outcome).sort(), ["OK", "VERSION_CONFLICT"], `outcomes: ${race.map(outcome).join(",")}`);
  const same = body(rentA.id, { amount: "6000" });
  const twins = await Promise.all([service.createExpense(A.id, same), service.createExpense(A.id, { ...same, requestId: randomUUID() })]) as unknown as { expense: { id: string } }[];
  assert.equal(twins[0].expense.id, twins[1].expense.id, "same key, one expense");
  assert.equal(await database.expense.count({ where: { ownerId: A.id, amount: 6000n } }), 1);
  pass(stage);

  stage = "VOID_REPLACE_FAILURE_ROLLS_BACK";
  // Test harness only: a throwaway trigger that fails the REPLACED event inside this schema.
  await database.$executeRawUnsafe(`CREATE FUNCTION "${schema}".expense_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."eventType" = 'REPLACED' THEN RAISE EXCEPTION 'fixture failure'; END IF; RETURN NEW; END $$`);
  await database.$executeRawUnsafe(`CREATE TRIGGER expense_test_failure BEFORE INSERT ON "${schema}".expense_events FOR EACH ROW EXECUTE FUNCTION "${schema}".expense_test_fail()`);
  const victim = (await service.createExpense(A.id, body(rentA.id, { amount: "7000" })) as unknown as { expense: { id: string } }).expense;
  const countsBefore = [await database.expense.count(), await database.expenseOperation.count(), await database.expenseEvent.count()];
  const failing = { ...keys(), expectedVersion: 1, reason: "Fallo inyectado", replacement: { expenseDate: today, amount: "7100", categoryId: rentA.id, paymentMethod: "CASH" as const, description: "Reemplazo" } };
  await assert.rejects(service.voidExpense(A.id, victim.id, failing));
  assert.deepEqual([await database.expense.count(), await database.expenseOperation.count(), await database.expenseEvent.count()], countsBefore);
  assert.equal((await database.expense.findUniqueOrThrow({ where: { id: victim.id } })).status, "CONFIRMED");
  await database.$executeRawUnsafe(`DROP TRIGGER expense_test_failure ON "${schema}".expense_events`);
  assert.equal(((await service.voidExpense(A.id, victim.id, failing)) as unknown as { voided: { status: string } }).voided.status, "VOIDED", "the same key succeeds after the rollback");
  pass(stage);

  stage = "CLOSED_ACCOUNT_DURING_MUTATION";
  await database.user.update({ where: { id: B.id }, data: { closedAt: new Date(), sessionVersion: { increment: 1 } } });
  await assert.rejects(service.createExpense(B.id, body(rentB.id)), /ACCOUNT_CLOSED/);
  await assert.rejects(service.seedCategories(B.id, keys()), /ACCOUNT_CLOSED/);
  pass(stage);

  stage = "EXPLAIN_WITH_VOLUME";
  await database.$executeRaw`INSERT INTO expenses (id, "ownerId", status, "expenseDate", amount, "categoryId", "categoryNameSnapshot", "paymentMethod", description, "confirmedAt", "updatedAt")
    SELECT gen_random_uuid()::text, ${A.id}, 'CONFIRMED', (CURRENT_DATE - (g % 1500)), (1000 + g)::bigint, ${rentA.id}, 'Arriendo', 'CASH', 'Volumen sintético', now(), now()
    FROM generate_series(1, 20000) g`;
  await database.$executeRawUnsafe(`ANALYZE "${schema}".expenses`);
  const from = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const plan = async (sql: string) => (await database.$queryRawUnsafe<{ "QUERY PLAN": string }[]>(`EXPLAIN (ANALYZE, FORMAT TEXT) ${sql}`)).map(r => r["QUERY PLAN"]);
  const listPlan = await plan(`SELECT * FROM "${schema}".expenses WHERE "ownerId" = '${A.id}' AND status = 'CONFIRMED' AND "expenseDate" BETWEEN '${from}' AND '${today}' ORDER BY "expenseDate" DESC, "recordedAt" DESC, id DESC LIMIT 26`);
  const sumPlan = await plan(`SELECT "categoryId", sum(amount), count(*) FROM "${schema}".expenses WHERE "ownerId" = '${A.id}' AND status = 'CONFIRMED' AND "expenseDate" BETWEEN '${from}' AND '${today}' GROUP BY "categoryId"`);
  const ms = (lines: string[]) => Number(lines.find(l => l.startsWith("Execution Time"))?.match(/([\d.]+) ms/)?.[1] ?? NaN);
  console.log(`EXPLAIN list: ${listPlan.some(l => /Index/.test(l)) ? "index" : "seq"} scan, ${ms(listPlan)} ms; summary: ${sumPlan.some(l => /Index/.test(l)) ? "index" : "seq"} scan, ${ms(sumPlan)} ms (20000 rows)`);
  assert.ok(ms(listPlan) < 500 && ms(sumPlan) < 500, "list and summary stay under 500 ms with 20000 rows");
  pass(stage);

  stage = "TOTALS_RECONCILE";
  const yearAgo = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
  const summary = await service.summary(A.id, { from: yearAgo, to: today }) as unknown as { confirmedTotal: string; confirmedCount: number };
  const [sql] = await database.$queryRaw<{ total: string; n: bigint }[]>`SELECT coalesce(sum(amount), 0)::text AS total, count(*) AS n FROM expenses WHERE "ownerId" = ${A.id} AND status = 'CONFIRMED' AND "expenseDate" BETWEEN ${yearAgo}::date AND ${today}::date`;
  assert.equal(summary.confirmedTotal, sql.total, `summary ${summary.confirmedTotal} vs SQL ${sql.total}`); assert.equal(summary.confirmedCount, Number(sql.n));
  pass(stage);

  stage = "MIGRATION_LEDGER";
  const ledger = await database.$queryRaw<{ migration_name: string }[]>`SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name`;
  assert.deepEqual(ledger.map(v => v.migration_name), names); pass(stage);
  console.log(JSON.stringify({ passed: passed.length, schema, migrations: ledger.length, manualSchemaChanges: false, retainedSyntheticData: true, productionAccess: false }));
}

if (require.main === module) main().catch(error => {
  // Only assertion text is printed; driver errors may describe the connection target.
  console.error(`FAIL ${stage}: ${error instanceof assert.AssertionError ? error.message.slice(0, 200) : error instanceof Error ? error.name : "ERROR"}`);
  process.exitCode = 1;
}).finally(async () => { await db?.$disconnect(); });
