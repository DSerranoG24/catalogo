import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, cp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { Prisma, PrismaClient, type SaleMovementRole } from "@prisma/client";
import { inventoryTestTarget } from "./verify-inventory-postgres";
import { makeSaleService } from "../services/sale.service";

// Local rehearsal only: the URL comes from stdin, must be localhost/catalogo_test, and
// every object lives in a random schema. It applies the real migration chain; nothing
// in the schema is altered by hand. Never point this at production.
const requireModule = createRequire(__filename);
const schema = `sale_integrity_${randomBytes(8).toString("hex")}`;
const SALE_INTEGRITY = "20261124100000_sale_integrity_checks";
const SALE_ORIGIN = "20261124200000_inventory_movements_allow_sale_origin";
const SALE_RULES = "20261124210000_sale_partial_returns_and_movement_roles";
const CHECKS = ["Sale_currency_check", "Sale_amounts_nonnegative_check", "Sale_discount_within_subtotal_check", "Sale_total_equation_check",
  "SaleLine_quantity_positive_check", "SaleLine_amounts_nonnegative_check", "SaleLine_discount_within_price_check", "SaleLine_total_equation_check",
  "SaleReturnLine_received_positive_check", "SaleReturnLine_split_nonnegative_check", "SaleReturnLine_split_equation_check"];
const ORIGIN_CHECKS = ["inventory_movements_origin_check", "inventory_movements_batch_check"];
const ROLE_CHECK = "inventory_movements_sale_role_type_check";
const DIAGNOSTICS = ["Sale_subtotal_matches_lines", "SaleReturnLine_cumulative_within_sold", "SaleReturnLine_line_belongs_to_return_sale",
  "Returned_sale_fully_returned", "Delivered_sale_fully_returned"];
let stage = "TARGET_GUARD";
let db: PrismaClient | undefined;
const passed: string[] = [];
function pass(name: string) { passed.push(name); console.log(`PASS ${name}`); }
class Rollback extends Error {}

async function verificationQuery() {
  const sql = await readFile(path.resolve("../docs/sql/verify-sale-integrity.sql"), "utf8");
  const start = sql.indexOf("WITH rules AS"), end = sql.indexOf(";", sql.indexOf("ORDER BY c.kind, c.rule"));
  assert.ok(start > 0 && end > start, "VERIFY_SQL_NOT_FOUND");
  assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|TRUNCATE|GRANT)\b/i, "verification SQL must stay read-only");
  return sql.slice(start, end);
}
const outcome = (r: PromiseSettledResult<unknown>) => r.status === "fulfilled" ? "OK" : r.reason instanceof Error ? (/^[A-Z_]+$/.test(r.reason.message) ? r.reason.message : String((r.reason as { code?: string }).code ?? r.reason.name)) : "ERROR";

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
  assert.deepEqual(names.slice(-3), [SALE_INTEGRITY, SALE_ORIGIN, SALE_RULES], "the three sales migrations must be the latest ones, in this order");
  await mkdir(path.join(folder, "migrations"));
  await cp("prisma/schema.prisma", path.join(folder, "schema.prisma"));
  await cp(path.join(migrationRoot, "migration_lock.toml"), path.join(folder, "migrations/migration_lock.toml"));
  const add = (name: string) => cp(path.join(migrationRoot, name), path.join(folder, "migrations", name), { recursive: true });
  for (const name of names.slice(0, -3)) await add(name);
  const prismaCli = (...args: string[]) => spawnSync(process.execPath, [requireModule.resolve("prisma/build/index.js"), ...args, "--schema", path.join(folder, "schema.prisma")], {
    cwd: folder, env: { ...process.env, DATABASE_URL: target.toString() }, encoding: "utf8", timeout: 60000, windowsHide: true,
  });
  // Never echo Prisma output: it may contain connection details.
  const deploy = () => prismaCli("migrate", "deploy").status;

  stage = "BASELINE_MIGRATIONS"; assert.equal(deploy(), 0); pass(stage);

  const owner = await database.user.create({ data: { email: `sale_${randomUUID()}@example.invalid` } });
  const opening = new Map<string, number>();
  async function item(stock: number, sku: string) {
    const row = await database.inventoryItem.create({ data: { userId: owner.id, name: `Item ${sku}`, sku, stock } });
    await database.itemCommercialTerms.create({ data: { itemId: row.id, userId: owner.id, unitSalePrice: 100n } });
    opening.set(row.id, stock); return row;
  }
  const legacyItem = await item(10, "LEGACY");
  const valid = await database.sale.create({ data: { userId: owner.id, status: "DELIVERED", subtotal: 200n, discountTotal: 20n, total: 180n,
    lines: { create: { inventoryItemId: legacyItem.id, quantity: 2, itemName: "Legacy", sku: "LEGACY", unitPrice: 100n, unitDiscount: 10n, lineTotal: 180n, commercialTermsVersion: 1 } } }, include: { lines: true } });
  // Raw movement rows on purpose: these probe the database constraints, not the service.
  const saleMovement = (extra: Record<string, unknown> = {}) => ({ itemId: legacyItem.id, key: randomUUID(), type: "OUT", quantity: 1, previousStock: 10, resultingStock: 9, reason: "Synthetic",
    origin: "SALE", saleId: valid.id, saleLineId: valid.lines[0].id, saleMovementRole: "SALE_CONFIRMATION", actorUserId: owner.id, ...extra }) as unknown as Prisma.InventoryMovementUncheckedCreateInput;
  const query = await verificationQuery();
  const count = async (client: Pick<PrismaClient, "$queryRawUnsafe"> = database) => Object.fromEntries((await client.$queryRawUnsafe<{ regla: string; violaciones: bigint }[]>(query)).map(row => [row.regla, Number(row.violaciones)]));

  stage = "SALE_MOVEMENT_REJECTED_BEFORE_FIX";
  await assert.rejects(database.inventoryMovement.create({ data: saleMovement() }), "the applied chain must reproduce the production blocker");
  pass(stage);

  stage = "VERIFICATION_QUERY_FLAGS_INVALID_ROWS";
  let report = await count();
  for (const name of [...CHECKS, ...ORIGIN_CHECKS, ROLE_CHECK]) assert.equal(report[name], 0, `valid data flagged by ${name}`);
  // The movement ledger is immutable, so rows that would block a migration are probed inside a rollback.
  await assert.rejects(database.$transaction(async tx => {
    await tx.inventoryMovement.create({ data: saleMovement({ origin: "MANUAL", actorUserId: null }) });
    assert.equal((await count(tx)).inventory_movements_batch_check, 1);
    throw new Rollback();
  }), Rollback);
  assert.equal(await database.inventoryMovement.count({ where: { itemId: legacyItem.id } }), 0);
  const corrupt = await database.sale.create({ data: { userId: owner.id, subtotal: 100n, discountTotal: 0n, total: 999n,
    lines: { create: { inventoryItemId: legacyItem.id, quantity: 1, itemName: "Bad", sku: "LEGACY", unitPrice: 100n, unitDiscount: 0n, lineTotal: 7n, commercialTermsVersion: 1 } } } });
  report = await count();
  assert.equal(report.Sale_total_equation_check, 1); assert.equal(report.SaleLine_total_equation_check, 1); pass(stage);

  stage = "MIGRATION_FAILS_ATOMICALLY_AND_P3009_RECOVERY";
  await add(SALE_INTEGRITY);
  assert.notEqual(deploy(), 0, "migration must refuse invalid existing rows");
  const leftovers = await database.$queryRaw<{ conname: string }[]>`SELECT conname FROM pg_constraint WHERE connamespace = ${schema}::regnamespace AND conname = ANY(${CHECKS})`;
  assert.equal(leftovers.length, 0, "a failed migration must not leave partial constraints");
  assert.notEqual(deploy(), 0, "Prisma blocks redeploy until the failed migration is resolved (P3009)");
  assert.equal(prismaCli("migrate", "resolve", "--rolled-back", SALE_INTEGRITY).status, 0);
  await database.$executeRaw`DELETE FROM "SaleLine" WHERE "saleId" = ${corrupt.id}`;
  await database.$executeRaw`DELETE FROM "Sale" WHERE id = ${corrupt.id}`;
  pass(stage);

  stage = "F0_MIGRATIONS_APPLY_OVER_VALID_DATA";
  await add(SALE_ORIGIN);
  assert.equal(deploy(), 0);
  pass(stage);

  // Production shape before the new rules: a sale delivered and then cancelled (like the
  // test sale 29b2435… found on 2026-11-24). Written directly because the service now refuses it.
  stage = "LEGACY_DELIVERED_THEN_CANCELLED_BEFORE_RULES";
  const legacy = await item(5, "LEGACY-CANCELLED");
  const cancelledAfterDelivery = await database.sale.create({ data: { userId: owner.id, status: "DELIVERED", subtotal: 100n, total: 100n, confirmedAt: new Date(), deliveredAt: new Date(),
    lines: { create: { inventoryItemId: legacy.id, quantity: 1, itemName: "Legacy", sku: "LEGACY-CANCELLED", unitPrice: 100n, lineTotal: 100n, commercialTermsVersion: 1 } } }, include: { lines: true } });
  const legacyRefs = { itemId: legacy.id, saleId: cancelledAfterDelivery.id, saleLineId: cancelledAfterDelivery.lines[0].id, actorUserId: owner.id, origin: "SALE", reason: "Legacy" };
  await database.inventoryMovement.create({ data: { ...legacyRefs, key: randomUUID(), type: "OUT", quantity: 1, previousStock: 5, resultingStock: 4, saleMovementRole: "SALE_CONFIRMATION" } });
  await database.inventoryMovement.create({ data: { ...legacyRefs, key: randomUUID(), type: "IN", quantity: 1, previousStock: 4, resultingStock: 5, saleMovementRole: "SALE_CANCELLATION" } });
  await database.sale.update({ where: { id: cancelledAfterDelivery.id }, data: { status: "CANCELLED", cancelledAt: new Date(), version: { increment: 2 } } });
  // A damaged-return movement would block the new CHECK; probe it inside a rollback.
  await assert.rejects(database.$transaction(async tx => {
    await tx.inventoryMovement.create({ data: { ...legacyRefs, key: randomUUID(), type: "IN", quantity: 1, previousStock: 5, resultingStock: 6, saleMovementRole: "SALE_RETURN_DAMAGED" } as Prisma.InventoryMovementUncheckedCreateInput });
    assert.equal((await count(tx))[ROLE_CHECK], 1);
    throw new Rollback();
  }), Rollback);
  report = await count();
  for (const name of [...CHECKS, ...ORIGIN_CHECKS, ROLE_CHECK]) assert.equal(report[name], 0, `${name} before the rules migration`);
  assert.equal(report.Sale_cancelled_after_delivery, 1, "the legacy delivered-then-cancelled sale is detected");
  pass(stage);

  stage = "RULES_MIGRATION_APPLIES_WITH_LEGACY_DATA";
  await add(SALE_RULES);
  assert.equal(deploy(), 0, "the rules migration must not be broken by a sale cancelled after delivery");
  const constraints = await database.$queryRaw<{ conname: string; validated: boolean; definition: string }[]>`SELECT conname, convalidated AS validated, pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE connamespace = ${schema}::regnamespace AND conname = ANY(${[...CHECKS, ...ORIGIN_CHECKS, ROLE_CHECK]})`;
  assert.deepEqual(constraints.map(c => c.conname).sort(), [...CHECKS, ...ORIGIN_CHECKS, ROLE_CHECK].sort()); assert.ok(constraints.every(c => c.validated));
  for (const name of ORIGIN_CHECKS) assert.match(constraints.find(c => c.conname === name)!.definition, /'SALE'/);
  const triggers = await database.$queryRaw<{ tgname: string }[]>`SELECT t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid WHERE c.relnamespace = ${schema}::regnamespace AND t.tgname IN ('sale_return_line_guard', 'sale_status_transition_guard')`;
  assert.deepEqual(triggers.map(t => t.tgname).sort(), ["sale_return_line_guard", "sale_status_transition_guard"]);
  const kept = await database.sale.findUniqueOrThrow({ where: { id: cancelledAfterDelivery.id } });
  assert.equal(kept.status, "CANCELLED"); assert.ok(kept.deliveredAt, "historical rows are not rewritten");
  assert.equal((await database.sale.findUniqueOrThrow({ where: { id: valid.id } })).total, 180n);
  pass(stage);

  stage = "DB_RULES_REJECT_INVALID_WRITES";
  for (const extra of [{ origin: "UNKNOWN" }, { saleLineId: null }, { saleMovementRole: null }, { saleId: null }, { actorUserId: null },
    { batchOperationId: randomUUID() }, { origin: "MANUAL" }, { origin: "MANUAL", saleId: null, saleLineId: null },
    { type: "IN", resultingStock: 11 }, { saleMovementRole: "SALE_CANCELLATION" }, { saleMovementRole: "SALE_RETURN_RESELLABLE" },
    { saleMovementRole: "SALE_RETURN_DAMAGED" }, { saleMovementRole: "SALE_RETURN_DAMAGED", type: "IN", resultingStock: 11 }])
    await assert.rejects(database.inventoryMovement.create({ data: saleMovement(extra) }), `movement accepted: ${JSON.stringify(extra)}`);
  assert.equal(await database.inventoryMovement.count({ where: { itemId: legacyItem.id } }), 0);
  const lineId = valid.lines[0].id;
  for (const data of [{ total: 1n }, { discountTotal: 300n, total: -100n }, { currency: "USD" }]) await assert.rejects(database.sale.update({ where: { id: valid.id }, data }));
  for (const data of [{ quantity: 0, lineTotal: 0n }, { lineTotal: 181n }, { unitDiscount: 101n, lineTotal: -2n }, { unitCost: -1n }]) await assert.rejects(database.saleLine.update({ where: { id: lineId }, data }));
  for (const status of ["CANCELLED", "DRAFT", "CONFIRMED"] as const) await assert.rejects(database.sale.update({ where: { id: valid.id }, data: { status } }), `DELIVERED -> ${status} accepted`);
  await assert.rejects(database.sale.update({ where: { id: cancelledAfterDelivery.id }, data: { status: "RETURNED" } }), "CANCELLED is terminal");
  await database.sale.update({ where: { id: valid.id }, data: { version: { increment: 1 } } }); // same-status updates are allowed
  const ret = await database.saleReturn.create({ data: { saleId: valid.id, userId: owner.id, operationId: randomUUID(), reason: "Synthetic" } });
  for (const data of [{ receivedQuantity: 2, resellableQuantity: 1, damagedQuantity: 0 }, { receivedQuantity: 0, resellableQuantity: 0, damagedQuantity: 0 }, { receivedQuantity: 2, resellableQuantity: 3, damagedQuantity: -1 }])
    await assert.rejects(database.saleReturnLine.create({ data: { returnId: ret.id, saleLineId: lineId, ...data } }));
  await assert.rejects(database.saleReturnLine.create({ data: { returnId: ret.id, saleLineId: lineId, receivedQuantity: 3, resellableQuantity: 3, damagedQuantity: 0 } }), "trigger: more than sold");
  await assert.rejects(database.saleReturnLine.create({ data: { returnId: ret.id, saleLineId: cancelledAfterDelivery.lines[0].id, receivedQuantity: 1, resellableQuantity: 1, damagedQuantity: 0 } }), "trigger: line of another sale");
  await database.saleReturnLine.create({ data: { returnId: ret.id, saleLineId: lineId, receivedQuantity: 1, resellableQuantity: 1, damagedQuantity: 0 } });
  const ret2 = await database.saleReturn.create({ data: { saleId: valid.id, userId: owner.id, operationId: randomUUID(), reason: "Synthetic 2" } });
  await assert.rejects(database.saleReturnLine.create({ data: { returnId: ret2.id, saleLineId: lineId, receivedQuantity: 2, resellableQuantity: 2, damagedQuantity: 0 } }), "trigger: cumulative more than sold");
  await database.saleReturnLine.create({ data: { returnId: ret2.id, saleLineId: lineId, receivedQuantity: 1, resellableQuantity: 0, damagedQuantity: 1 } });
  await database.sale.update({ where: { id: valid.id }, data: { status: "RETURNED", returnedAt: new Date() } }); // DELIVERED -> RETURNED is allowed
  pass(stage);

  const service = makeSaleService(database);
  const keys = () => ({ operationId: randomUUID(), requestId: randomUUID() });
  const stockOf = async (id: string) => (await database.inventoryItem.findUniqueOrThrow({ where: { id } })).stock;
  async function draft(lines: { itemId: string; quantity: number }[]) {
    const sale = await service.create(owner.id, keys());
    return service.updateDraft(owner.id, sale.id, { operationId: randomUUID(), expectedVersion: sale.version, lines: lines.map(l => ({ inventoryItemId: l.itemId, quantity: l.quantity, unitDiscount: "0" })) });
  }
  // Exactly one movement for this item and operation, with the expected balances and role.
  async function step(itemId: string, operationId: string, role: SaleMovementRole, before: number, after: number) {
    const rows = await database.inventoryMovement.findMany({ where: { itemId, key: operationId } });
    assert.equal(rows.length, 1, `${role}: one movement per item and operation`);
    const [m] = rows;
    assert.deepEqual([m.origin, m.saleMovementRole, m.type, m.previousStock, m.resultingStock, m.actorUserId], ["SALE", role, after < before ? "OUT" : "IN", before, after, owner.id]);
    assert.ok(m.saleId && m.saleLineId);
    assert.equal(await stockOf(itemId), after);
  }
  async function noMovement(itemId: string, operationId: string, stock: number) {
    assert.equal(await database.inventoryMovement.count({ where: { itemId, key: operationId } }), 0);
    assert.equal(await stockOf(itemId), stock);
  }
  type Result = { status: string; version: number; lines: unknown[]; returns: { reason: string }[]; returnedAt: Date | null; confirmedAt: Date | null; deliveredAt: Date | null };
  const confirm = async (sale: { id: string; version: number }, deliverImmediately = false) => { const k = { ...keys(), expectedVersion: sale.version, deliverImmediately }; return { r: await service.confirm(owner.id, sale.id, k) as unknown as Result, k }; };

  const a = await item(10, "FLOW-A"), b = await item(4, "FLOW-B");

  stage = "FLOW_CONFIRM_THEN_DELIVER";
  const s1 = await draft([{ itemId: a.id, quantity: 3 }, { itemId: b.id, quantity: 1 }]);
  const c1 = await confirm(s1);
  assert.equal(c1.r.status, "CONFIRMED"); assert.equal(c1.r.lines.length, 2, "confirm response includes lines");
  await step(a.id, c1.k.operationId, "SALE_CONFIRMATION", 10, 7); await step(b.id, c1.k.operationId, "SALE_CONFIRMATION", 4, 3);
  const d1k = { ...keys(), expectedVersion: c1.r.version };
  const d1 = await service.transition(owner.id, s1.id, d1k) as unknown as Result;
  assert.equal(d1.status, "DELIVERED"); assert.equal(d1.lines.length, 2, "deliver response includes lines");
  await noMovement(a.id, d1k.operationId, 7); await noMovement(b.id, d1k.operationId, 3);
  pass(stage);

  stage = "FLOW_CONFIRM_AND_DELIVER_IMMEDIATELY";
  const s2 = await draft([{ itemId: a.id, quantity: 2 }]);
  const c2 = await confirm(s2, true);
  assert.equal(c2.r.status, "DELIVERED"); assert.ok(c2.r.confirmedAt && c2.r.deliveredAt);
  await step(a.id, c2.k.operationId, "SALE_CONFIRMATION", 7, 5); pass(stage);

  stage = "FLOW_CANCEL_CONFIRMED_WITH_NEW_REQUEST_ID_RETRY";
  const s3 = await draft([{ itemId: a.id, quantity: 1 }, { itemId: b.id, quantity: 2 }]);
  const c3 = await confirm(s3);
  await step(a.id, c3.k.operationId, "SALE_CONFIRMATION", 5, 4); await step(b.id, c3.k.operationId, "SALE_CONFIRMATION", 3, 1);
  const x3 = { ...keys(), expectedVersion: c3.r.version, reason: "Synthetic cancellation" };
  const cancelled = await service.cancel(owner.id, s3.id, x3) as unknown as Result;
  assert.equal(cancelled.status, "CANCELLED"); assert.equal(cancelled.lines.length, 2, "cancel response includes lines");
  await step(a.id, x3.operationId, "SALE_CANCELLATION", 4, 5); await step(b.id, x3.operationId, "SALE_CANCELLATION", 1, 3);
  assert.equal((await service.cancel(owner.id, s3.id, { ...x3, requestId: randomUUID() }) as unknown as Result).status, "CANCELLED", "same key, same content, new requestId replays");
  await step(a.id, x3.operationId, "SALE_CANCELLATION", 4, 5);
  await assert.rejects(service.cancel(owner.id, s3.id, { ...x3, requestId: randomUUID(), reason: "Otro motivo" }), /IDEMPOTENCY_CONFLICT/);
  pass(stage);

  stage = "FLOW_CANCEL_DELIVERED_IS_REJECTED";
  await assert.rejects(service.cancel(owner.id, s2.id, { ...keys(), expectedVersion: c2.r.version, reason: "Cancelar una entregada" }), /INVALID_TRANSITION/);
  assert.equal((await database.sale.findUniqueOrThrow({ where: { id: s2.id } })).status, "DELIVERED");
  assert.equal(await stockOf(a.id), 5); pass(stage);

  stage = "FLOW_PARTIAL_RETURNS_IN_TWO_STEPS_TO_RETURNED";
  const lines1 = await database.saleLine.findMany({ where: { saleId: s1.id } });
  const lineA = lines1.find(l => l.inventoryItemId === a.id)!, lineB = lines1.find(l => l.inventoryItemId === b.id)!;
  const r1 = { ...keys(), expectedVersion: d1.version, reason: "Primera devolución", lines: [{ saleLineId: lineA.id, receivedQuantity: 1, resellableQuantity: 1, damagedQuantity: 0 }] };
  const after1 = await service.returnSale(owner.id, s1.id, r1) as unknown as Result;
  assert.equal(after1.status, "DELIVERED"); assert.equal(after1.returnedAt, null); assert.equal(after1.returns.length, 1); assert.equal(after1.lines.length, 2);
  await step(a.id, r1.operationId, "SALE_RETURN_RESELLABLE", 5, 6);
  await assert.rejects(service.returnSale(owner.id, s1.id, { ...keys(), expectedVersion: after1.version, reason: "De más", lines: [{ saleLineId: lineA.id, receivedQuantity: 3, resellableQuantity: 3, damagedQuantity: 0 }] }), /RETURN_EXCEEDS_SOLD/);
  assert.equal(await database.saleReturn.count({ where: { saleId: s1.id } }), 1); assert.equal(await stockOf(a.id), 6);
  const r2 = { ...keys(), expectedVersion: after1.version, reason: "Segunda devolución", lines: [
    { saleLineId: lineA.id, receivedQuantity: 2, resellableQuantity: 1, damagedQuantity: 1 },
    { saleLineId: lineB.id, receivedQuantity: 1, resellableQuantity: 0, damagedQuantity: 1 },
  ] };
  const after2 = await service.returnSale(owner.id, s1.id, r2) as unknown as Result;
  assert.equal(after2.status, "RETURNED"); assert.ok(after2.returnedAt); assert.deepEqual(after2.returns.map(r => r.reason), ["Primera devolución", "Segunda devolución"]);
  await step(a.id, r2.operationId, "SALE_RETURN_RESELLABLE", 6, 7); await noMovement(b.id, r2.operationId, 3);
  assert.equal((await service.returnSale(owner.id, s1.id, { ...r2, requestId: randomUUID() }) as unknown as Result).status, "RETURNED", "return retry with new requestId replays");
  assert.equal(await database.saleReturn.count({ where: { saleId: s1.id } }), 2);
  pass(stage);

  stage = "FLOW_RETURN_ALL_DAMAGED";
  const [line2] = await database.saleLine.findMany({ where: { saleId: s2.id } });
  const rd = { ...keys(), expectedVersion: c2.r.version, reason: "Synthetic damaged return", lines: [{ saleLineId: line2.id, receivedQuantity: 2, resellableQuantity: 0, damagedQuantity: 2 }] };
  assert.equal((await service.returnSale(owner.id, s2.id, rd) as unknown as Result).status, "RETURNED");
  await noMovement(a.id, rd.operationId, 7); pass(stage);

  stage = "CONCURRENT_RETURNS_SAME_SALE";
  const cr = await item(5, "CONC-RETURN"); const sr = await draft([{ itemId: cr.id, quantity: 2 }]); const srd = await confirm(sr, true);
  const [lineR] = await database.saleLine.findMany({ where: { saleId: sr.id } });
  const body = () => ({ ...keys(), expectedVersion: srd.r.version, reason: "Concurrente", lines: [{ saleLineId: lineR.id, receivedQuantity: 2, resellableQuantity: 2, damagedQuantity: 0 }] });
  const returns = await Promise.allSettled([service.returnSale(owner.id, sr.id, body()), service.returnSale(owner.id, sr.id, body())]);
  assert.deepEqual(returns.map(outcome).sort(), ["INVALID_TRANSITION", "OK"], `outcomes: ${returns.map(outcome).join(",")}`);
  assert.equal(await stockOf(cr.id), 5); assert.equal(await database.saleReturnLine.count({ where: { saleLineId: lineR.id } }), 1);
  pass(stage);

  const catalog = await database.catalog.create({ data: { userId: owner.id, name: "Synthetic catalog", slug: `synthetic-${randomUUID().slice(0, 8)}` } });
  async function productFor(row: { id: string; sku: string }) { return database.product.create({ data: { catalogId: catalog.id, name: `Product ${row.sku}`, slug: `p-${row.sku.toLowerCase()}`, price: 100, inventoryItemId: row.id } }); }
  const order = (productId: string, quantity: number) => database.order.create({ data: { catalogId: catalog.id, customerName: "Synthetic buyer", customerPhone: "3000000000", total: 100 * quantity,
    items: { create: { productId, productName: "Synthetic product", quantity, unitPrice: 100, subtotal: 100 * quantity } } } });
  type Converted = { sale: Result & { id: string; sourceOrderId: string; lines: { unitPrice: bigint }[] }; idempotent: boolean };
  const convert = (orderId: string, mode: "DRAFT" | "CONFIRMED" | "DELIVERED", k = keys()) => service.convertOrderToSale(owner.id, orderId, { ...k, mode, acceptPriceDifference: false }) as unknown as Promise<Converted>;

  stage = "FLOW_ORDER_CONVERSION_CONFIRMED_AND_DELIVERED";
  const c = await item(6, "FLOW-C"); const product = await productFor(c);
  const o1 = await order(product.id, 2), o2 = await order(product.id, 1), o3 = await order(product.id, 1);
  const k1 = keys();
  const v1 = await convert(o1.id, "CONFIRMED", k1);
  assert.equal(v1.sale.status, "CONFIRMED"); assert.equal(v1.sale.sourceOrderId, o1.id); assert.equal(v1.sale.lines[0].unitPrice, 100n);
  await step(c.id, k1.operationId, "SALE_CONFIRMATION", 6, 4);
  assert.equal((await convert(o1.id, "CONFIRMED", { ...k1, requestId: randomUUID() })).idempotent, true, "conversion retry with new requestId replays");
  await step(c.id, k1.operationId, "SALE_CONFIRMATION", 6, 4);
  await assert.rejects(convert(o1.id, "CONFIRMED"), /ORDER_ALREADY_CONVERTED/);
  const k2 = keys();
  const v2 = await convert(o2.id, "DELIVERED", k2);
  assert.equal(v2.sale.status, "DELIVERED"); assert.ok(v2.sale.deliveredAt);
  await step(c.id, k2.operationId, "SALE_CONFIRMATION", 4, 3);
  const k3 = keys();
  assert.equal((await convert(o3.id, "DRAFT", k3)).sale.status, "DRAFT");
  await noMovement(c.id, k3.operationId, 3);
  assert.equal((await database.order.findUniqueOrThrow({ where: { id: o1.id } })).status, "PENDING", "conversion does not modify the order");
  pass(stage);

  stage = "CONCURRENT_CONVERSIONS";
  const lastConv = await item(1, "LAST-CONV"), lastProduct = await productFor(lastConv);
  const [lo1, lo2] = [await order(lastProduct.id, 1), await order(lastProduct.id, 1)];
  const lastRace = await Promise.allSettled([convert(lo1.id, "CONFIRMED"), convert(lo2.id, "DELIVERED")]);
  assert.deepEqual(lastRace.map(outcome).sort(), ["OK", "STOCK_INSUFFICIENT"], `outcomes: ${lastRace.map(outcome).join(",")}`);
  assert.equal(await stockOf(lastConv.id), 0); assert.equal(await database.inventoryMovement.count({ where: { itemId: lastConv.id } }), 1);
  const manyConv = await item(10, "MANY-CONV"), manyProduct = await productFor(manyConv);
  const orders = await Promise.all(Array.from({ length: 6 }, () => order(manyProduct.id, 1)));
  await Promise.all(orders.map(o => convert(o.id, "CONFIRMED")));
  const convChain = await database.inventoryMovement.findMany({ where: { itemId: manyConv.id }, orderBy: { resultingStock: "desc" } });
  assert.deepEqual(convChain.map(m => [m.previousStock, m.resultingStock]), [[10, 9], [9, 8], [8, 7], [7, 6], [6, 5], [5, 4]]);
  const sameOrder = await order(manyProduct.id, 1);
  const sameRace = await Promise.allSettled([convert(sameOrder.id, "CONFIRMED"), convert(sameOrder.id, "CONFIRMED")]);
  assert.deepEqual(sameRace.map(outcome).sort(), ["OK", "ORDER_ALREADY_CONVERTED"], `outcomes: ${sameRace.map(outcome).join(",")}`);
  assert.equal(await database.sale.count({ where: { sourceOrderId: sameOrder.id } }), 1); assert.equal(await stockOf(manyConv.id), 3);
  pass(stage);

  stage = "CONCURRENT_CONFIRMATIONS_LAST_UNIT";
  const last = await item(1, "LAST");
  const [l1, l2] = [await draft([{ itemId: last.id, quantity: 1 }]), await draft([{ itemId: last.id, quantity: 1 }])];
  const race = await Promise.allSettled([confirm(l1), confirm(l2)]);
  assert.deepEqual(race.map(outcome).sort(), ["OK", "STOCK_INSUFFICIENT"], `outcomes: ${race.map(outcome).join(",")}`);
  assert.equal(await stockOf(last.id), 0);
  assert.equal(await database.inventoryMovement.count({ where: { itemId: last.id } }), 1); pass(stage);

  stage = "CONCURRENT_CONFIRMATIONS_LEDGER_CHAIN";
  const many = await item(10, "MANY");
  const drafts = await Promise.all(Array.from({ length: 6 }, () => draft([{ itemId: many.id, quantity: 1 }])));
  await Promise.all(drafts.map(sale => confirm(sale)));
  const chain = await database.inventoryMovement.findMany({ where: { itemId: many.id }, orderBy: { resultingStock: "desc" } });
  assert.deepEqual(chain.map(m => [m.previousStock, m.resultingStock]), [[10, 9], [9, 8], [8, 7], [7, 6], [6, 5], [5, 4]]);
  assert.equal(await stockOf(many.id), 4); pass(stage);

  stage = "REPLAY_WITH_NEW_REQUEST_ID_AND_JSON_RECEIPTS";
  const replayItem = await item(5, "REPLAY"); const sale = await draft([{ itemId: replayItem.id, quantity: 2 }]);
  const command = { ...keys(), expectedVersion: sale.version, deliverImmediately: false };
  const first = await service.confirm(owner.id, sale.id, command);
  const retry = await service.confirm(owner.id, sale.id, { ...command, requestId: randomUUID() }) as unknown as { id: string; status: string; total: string; lines: { unitPrice: string }[] };
  assert.equal(retry.id, sale.id); assert.equal(retry.status, "CONFIRMED"); assert.equal(retry.total, "200"); assert.equal(retry.lines[0].unitPrice, "100");
  await assert.rejects(service.confirm(owner.id, sale.id, { ...command, requestId: randomUUID(), deliverImmediately: true }), /IDEMPOTENCY_CONFLICT/);
  await step(replayItem.id, command.operationId, "SALE_CONFIRMATION", 5, 3);
  assert.ok(first.version > sale.version); pass(stage);

  stage = "LEDGER_RECONCILES_PER_ITEM";
  for (const row of [a, b, c, cr, lastConv, manyConv, last, many, replayItem, legacy]) {
    const movements = await database.inventoryMovement.findMany({ where: { itemId: row.id } });
    assert.equal(opening.get(row.id)! + movements.reduce((sum, m) => sum + m.delta, 0), await stockOf(row.id), `ledger of ${row.sku}`);
  }
  pass(stage);

  stage = "FINAL_VERIFICATION_QUERY";
  report = await count();
  for (const name of [...CHECKS, ...ORIGIN_CHECKS, ROLE_CHECK, ...DIAGNOSTICS]) assert.equal(report[name], 0, `${name} after the full flow`);
  assert.equal(report.Sale_cancelled_after_delivery, 1, "only the legacy sale was cancelled after delivery");
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
