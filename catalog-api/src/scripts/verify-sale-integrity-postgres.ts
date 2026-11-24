import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, cp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { inventoryTestTarget } from "./verify-inventory-postgres";
import { makeSaleService } from "../services/sale.service";

// Local rehearsal only: the URL comes from stdin, must be localhost/catalogo_test, and
// every object lives in a random schema. Never point this at production.
const requireModule = createRequire(__filename);
const schema = `sale_integrity_${randomBytes(8).toString("hex")}`;
const NEW_MIGRATION = "20261124100000_sale_integrity_checks";
const CHECKS = ["Sale_currency_check", "Sale_amounts_nonnegative_check", "Sale_discount_within_subtotal_check", "Sale_total_equation_check",
  "SaleLine_quantity_positive_check", "SaleLine_amounts_nonnegative_check", "SaleLine_discount_within_price_check", "SaleLine_total_equation_check",
  "SaleReturnLine_received_positive_check", "SaleReturnLine_split_nonnegative_check", "SaleReturnLine_split_equation_check"];
let stage = "TARGET_GUARD";
let db: PrismaClient | undefined;
const passed: string[] = [];
function pass(name: string) { passed.push(name); console.log(`PASS ${name}`); }

async function verificationQuery() {
  const sql = await readFile(path.resolve("../docs/sql/verify-sale-integrity.sql"), "utf8");
  const start = sql.indexOf("WITH rules AS"), end = sql.indexOf(";", sql.indexOf("ORDER BY c.kind, c.rule"));
  assert.ok(start > 0 && end > start, "VERIFY_SQL_NOT_FOUND");
  assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|TRUNCATE|GRANT)\b/i, "verification SQL must stay read-only");
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

  const folder = await mkdtemp(path.join(tmpdir(), "sale-integrity-migrations-"));
  const migrationRoot = path.resolve("prisma/migrations");
  const names = (await readdir(migrationRoot, { withFileTypes: true })).filter(v => v.isDirectory()).map(v => v.name).sort();
  assert.equal(names.at(-1), NEW_MIGRATION, "the integrity migration must be the latest one");
  await mkdir(path.join(folder, "migrations"));
  await cp("prisma/schema.prisma", path.join(folder, "schema.prisma"));
  await cp(path.join(migrationRoot, "migration_lock.toml"), path.join(folder, "migrations/migration_lock.toml"));
  for (const name of names.slice(0, -1)) await cp(path.join(migrationRoot, name), path.join(folder, "migrations", name), { recursive: true });
  const prismaCli = (...args: string[]) => spawnSync(process.execPath, [requireModule.resolve("prisma/build/index.js"), ...args, "--schema", path.join(folder, "schema.prisma")], {
    cwd: folder, env: { ...process.env, DATABASE_URL: target.toString() }, encoding: "utf8", timeout: 60000, windowsHide: true,
  });
  // Never echo Prisma output: it may contain connection details.
  const deploy = () => prismaCli("migrate", "deploy").status;

  stage = "BASELINE_MIGRATIONS"; assert.equal(deploy(), 0); pass(stage);

  const owner = await database.user.create({ data: { email: `sale_${randomUUID()}@example.invalid` } });
  async function item(stock: number, sku: string) {
    const row = await database.inventoryItem.create({ data: { userId: owner.id, name: `Item ${sku}`, sku, stock } });
    await database.itemCommercialTerms.create({ data: { itemId: row.id, userId: owner.id, unitSalePrice: 100n } });
    return row;
  }

  stage = "VERIFICATION_QUERY_FLAGS_INVALID_LEGACY_ROWS";
  const query = await verificationQuery();
  const legacyItem = await item(10, "LEGACY");
  const valid = await database.sale.create({ data: { userId: owner.id, status: "DELIVERED", subtotal: 200n, discountTotal: 20n, total: 180n,
    lines: { create: { inventoryItemId: legacyItem.id, quantity: 2, itemName: "Legacy", sku: "LEGACY", unitPrice: 100n, unitDiscount: 10n, lineTotal: 180n, commercialTermsVersion: 1 } } }, include: { lines: true } });
  const count = async () => Object.fromEntries((await database.$queryRawUnsafe<{ regla: string; violaciones: bigint }[]>(query)).map(row => [row.regla, Number(row.violaciones)]));
  let report = await count();
  for (const name of CHECKS) assert.equal(report[name], 0, `valid data flagged by ${name}`);
  const corrupt = await database.sale.create({ data: { userId: owner.id, subtotal: 100n, discountTotal: 0n, total: 999n,
    lines: { create: { inventoryItemId: legacyItem.id, quantity: 1, itemName: "Bad", sku: "LEGACY", unitPrice: 100n, unitDiscount: 0n, lineTotal: 7n, commercialTermsVersion: 1 } } } });
  report = await count();
  assert.equal(report.Sale_total_equation_check, 1); assert.equal(report.SaleLine_total_equation_check, 1); pass(stage);

  stage = "MIGRATION_FAILS_ATOMICALLY_ON_INVALID_DATA";
  await cp(path.join(migrationRoot, NEW_MIGRATION), path.join(folder, "migrations", NEW_MIGRATION), { recursive: true });
  assert.notEqual(deploy(), 0, "migration must refuse invalid existing rows");
  const constraintsAfterFailure = await database.$queryRaw<{ conname: string }[]>`SELECT conname FROM pg_constraint WHERE connamespace = ${schema}::regnamespace AND conname = ANY(${CHECKS})`;
  assert.equal(constraintsAfterFailure.length, 0, "a failed migration must not leave partial constraints");
  // Prisma records the failure; it must be marked rolled back before a new deploy.
  assert.notEqual(deploy(), 0, "Prisma blocks redeploy until the failed migration is resolved");
  assert.equal(prismaCli("migrate", "resolve", "--rolled-back", NEW_MIGRATION).status, 0);
  await database.$executeRaw`DELETE FROM "SaleLine" WHERE "saleId" = ${corrupt.id}`;
  await database.$executeRaw`DELETE FROM "Sale" WHERE id = ${corrupt.id}`;
  pass(stage);

  stage = "MIGRATION_APPLIES_OVER_VALID_DATA";
  assert.equal(deploy(), 0);
  const constraints = await database.$queryRaw<{ conname: string; validated: boolean }[]>`SELECT conname, convalidated AS validated FROM pg_constraint WHERE connamespace = ${schema}::regnamespace AND conname = ANY(${CHECKS})`;
  assert.deepEqual(constraints.map(c => c.conname).sort(), [...CHECKS].sort()); assert.ok(constraints.every(c => c.validated));
  assert.equal((await database.sale.findUniqueOrThrow({ where: { id: valid.id } })).total, 180n, "existing valid rows are untouched");
  pass(stage);

  stage = "CONSTRAINTS_REJECT_INVALID_WRITES";
  const lineId = valid.lines[0].id;
  for (const data of [{ total: 1n }, { discountTotal: 300n, total: -100n }, { currency: "USD" }]) await assert.rejects(database.sale.update({ where: { id: valid.id }, data }));
  for (const data of [{ quantity: 0, lineTotal: 0n }, { lineTotal: 181n }, { unitDiscount: 101n, lineTotal: -2n }, { unitCost: -1n }]) await assert.rejects(database.saleLine.update({ where: { id: lineId }, data }));
  const ret = await database.saleReturn.create({ data: { saleId: valid.id, userId: owner.id, operationId: randomUUID(), reason: "Synthetic" } });
  for (const data of [{ receivedQuantity: 2, resellableQuantity: 1, damagedQuantity: 0 }, { receivedQuantity: 0, resellableQuantity: 0, damagedQuantity: 0 }, { receivedQuantity: 2, resellableQuantity: 3, damagedQuantity: -1 }])
    await assert.rejects(database.saleReturnLine.create({ data: { returnId: ret.id, saleLineId: lineId, ...data } }));
  await database.saleReturnLine.create({ data: { returnId: ret.id, saleLineId: lineId, receivedQuantity: 2, resellableQuantity: 1, damagedQuantity: 1 } });
  pass(stage);

  // Pre-existing blocker found by this rehearsal: inventory_movements_origin_check and
  // inventory_movements_batch_check (migration 20261119000000_inventory_batches) only allow
  // MANUAL and INVENTORY_BATCH origins, while the sales service writes origin 'SALE'. Detect
  // it; if present, widen both in THIS throwaway schema only so locking/replay can be
  // exercised. This is not a migration and does not change any shared database.
  stage = "SALE_MOVEMENT_ORIGIN_ALLOWED_BY_SCHEMA";
  const originChecks = await database.$queryRaw<{ name: string; definition: string }[]>`SELECT conname AS name, pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE connamespace = ${schema}::regnamespace AND conname IN ('inventory_movements_origin_check', 'inventory_movements_batch_check')`;
  assert.equal(originChecks.length, 2, "both origin constraints are expected in the applied chain");
  const saleOriginBlocked = originChecks.some(check => !check.definition.includes("'SALE'"));
  if (saleOriginBlocked) {
    await database.$executeRawUnsafe(`ALTER TABLE "${schema}".inventory_movements DROP CONSTRAINT inventory_movements_origin_check, ADD CONSTRAINT inventory_movements_origin_check CHECK (origin IN ('MANUAL','INVENTORY_BATCH','SALE'))`);
    await database.$executeRawUnsafe(`ALTER TABLE "${schema}".inventory_movements DROP CONSTRAINT inventory_movements_batch_check, ADD CONSTRAINT inventory_movements_batch_check CHECK (
      (origin = 'MANUAL' AND "batchId" IS NULL AND "batchRowId" IS NULL AND "batchOperationId" IS NULL)
      OR (origin = 'INVENTORY_BATCH' AND "batchId" IS NOT NULL AND "batchRowId" IS NOT NULL AND "batchOperationId" IS NOT NULL AND "actorUserId" IS NOT NULL)
      OR (origin = 'SALE' AND "saleId" IS NOT NULL AND "saleLineId" IS NOT NULL AND "saleMovementRole" IS NOT NULL AND "actorUserId" IS NOT NULL AND "batchId" IS NULL AND "batchRowId" IS NULL AND "batchOperationId" IS NULL))`);
    console.log("WARN SALE_MOVEMENT_ORIGIN_BLOCKED: the applied schema rejects origin 'SALE'; widened in the throwaway schema only");
  }
  pass(stage);

  const service = makeSaleService(database);
  async function draft(itemId: string, quantity: number) {
    const sale = await service.create(owner.id, { operationId: randomUUID(), requestId: randomUUID() });
    return service.updateDraft(owner.id, sale.id, { operationId: randomUUID(), expectedVersion: sale.version, lines: [{ inventoryItemId: itemId, quantity, unitDiscount: "0" }] });
  }
  const confirm = (sale: { id: string; version: number }, extra = {}) => service.confirm(owner.id, sale.id, { operationId: randomUUID(), requestId: randomUUID(), expectedVersion: sale.version, deliverImmediately: false, ...extra });

  stage = "CONCURRENT_CONFIRMATIONS_LAST_UNIT";
  const last = await item(1, "LAST");
  const [a, b] = [await draft(last.id, 1), await draft(last.id, 1)];
  const race = await Promise.allSettled([confirm(a), confirm(b)]);
  const outcome = (r: PromiseSettledResult<unknown>) => r.status === "fulfilled" ? "OK" : r.reason instanceof Error ? (/^[A-Z_]+$/.test(r.reason.message) ? r.reason.message : String((r.reason as { code?: string }).code ?? r.reason.name)) : "ERROR";
  assert.equal(race.filter(r => r.status === "fulfilled").length, 1, `outcomes: ${race.map(outcome).join(",")}`);
  assert.ok(race.some(r => r.status === "rejected" && r.reason instanceof Error && r.reason.message === "STOCK_INSUFFICIENT"));
  assert.equal((await database.inventoryItem.findUniqueOrThrow({ where: { id: last.id } })).stock, 0);
  assert.equal(await database.inventoryMovement.count({ where: { itemId: last.id } }), 1); pass(stage);

  stage = "CONCURRENT_CONFIRMATIONS_LEDGER_CHAIN";
  const many = await item(10, "MANY");
  const drafts = await Promise.all(Array.from({ length: 6 }, () => draft(many.id, 1)));
  await Promise.all(drafts.map(sale => confirm(sale)));
  const chain = await database.inventoryMovement.findMany({ where: { itemId: many.id }, orderBy: { resultingStock: "desc" } });
  assert.deepEqual(chain.map(m => [m.previousStock, m.resultingStock]), [[10, 9], [9, 8], [8, 7], [7, 6], [6, 5], [5, 4]]);
  assert.equal((await database.inventoryItem.findUniqueOrThrow({ where: { id: many.id } })).stock, 4); pass(stage);

  stage = "REPLAY_BEFORE_VERSION_AND_JSON_RECEIPTS";
  const replayItem = await item(5, "REPLAY"); const sale = await draft(replayItem.id, 2);
  const command = { operationId: randomUUID(), requestId: randomUUID(), expectedVersion: sale.version, deliverImmediately: false };
  const first = await service.confirm(owner.id, sale.id, command);
  const retry = await service.confirm(owner.id, sale.id, command) as unknown as { id: string; status: string; total: string };
  assert.equal(retry.id, sale.id); assert.equal(retry.status, "CONFIRMED"); assert.equal(retry.total, "200");
  await assert.rejects(service.confirm(owner.id, sale.id, { ...command, deliverImmediately: true }), /IDEMPOTENCY_CONFLICT/);
  const cancel = { operationId: randomUUID(), requestId: randomUUID(), expectedVersion: first.version, reason: "Synthetic cancel" };
  await service.cancel(owner.id, sale.id, cancel); await service.cancel(owner.id, sale.id, cancel);
  assert.equal((await database.inventoryItem.findUniqueOrThrow({ where: { id: replayItem.id } })).stock, 5);
  assert.equal(await database.inventoryMovement.count({ where: { saleId: sale.id } }), 2);
  const delivered = await confirm(await draft(replayItem.id, 1), { deliverImmediately: true });
  const deliveredLine = await database.saleLine.findFirstOrThrow({ where: { saleId: delivered.id } });
  const returning = { operationId: randomUUID(), requestId: randomUUID(), expectedVersion: delivered.version, reason: "Synthetic return", lines: [{ saleLineId: deliveredLine.id, receivedQuantity: 1, resellableQuantity: 1, damagedQuantity: 0 }] };
  await service.returnSale(owner.id, delivered.id, returning); await service.returnSale(owner.id, delivered.id, returning);
  assert.equal((await database.inventoryItem.findUniqueOrThrow({ where: { id: replayItem.id } })).stock, 5);
  assert.equal(await database.saleReturn.count({ where: { saleId: delivered.id } }), 1); pass(stage);

  stage = "MIGRATION_LEDGER";
  const ledger = await database.$queryRaw<{ migration_name: string }[]>`SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name`;
  assert.deepEqual(ledger.map(v => v.migration_name), names); pass(stage);
  console.log(JSON.stringify({ passed: passed.length, schema, migrations: ledger.length, saleOriginBlockedBySchema: saleOriginBlocked, retainedSyntheticData: true, productionAccess: false }));
}

if (require.main === module) main().catch(error => {
  // Only assertion text is printed; driver errors may describe the connection target.
  console.error(`FAIL ${stage}: ${error instanceof assert.AssertionError ? error.message.slice(0, 160) : error instanceof Error ? error.name : "ERROR"}`);
  process.exitCode = 1;
}).finally(async () => { await db?.$disconnect(); });
