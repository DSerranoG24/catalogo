import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { PrismaClient } from "@prisma/client";
import { makeSaleService } from "../services/sale.service";
import { requestAccountClosure } from "../services/account-closure.service";
import { makeExpenseRepository } from "../repositories/expense.repository";
import { makeScheduledExpenseRepository } from "../repositories/scheduled-expense.repository";
import { moveInventory } from "../repositories/inventory.repository";

// Concurrency rehearsal of the single account lock (F2a-2a, Agents.md and docs/sales-payments-cartera-contract.md 15.A)
// on a local throwaway PostgreSQL. Never production. Every pair runs several times; no 40P01 and no incoherent data.
// Usage: '<postgresql://user@127.0.0.1:port/catalogo_test>' | node dist/scripts/verify-account-lock-postgres.js
const ROUNDS = 8;
const moduleRequire = createRequire(__filename);
const runId = randomUUID().replaceAll("-", "");
const schema = `account_lock_verify_${runId}`;
const results: string[] = [];
const observations: Record<string, unknown> = {};
let stage = "INPUT_VALIDATION";
let database: PrismaClient | undefined;
let schemaCreated = false;
let folder: string | undefined;
const loopback = (host: string) => host === "::1" || /^127(?:\.\d{1,3}){3}$/.test(host);
const passed = (check: string) => { results.push(check); console.error(`PASS ${stage}`); };
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const message = (reason: unknown) => reason instanceof Error ? reason.message : String(reason);
const isDeadlock = (reason: unknown) => /40P01|deadlock/i.test(message(reason));
/** Outcome code of a settled call: OK, or the error code (last word-like token), never row data. */
const outcome = (r: PromiseSettledResult<unknown>) => r.status === "fulfilled" ? "OK" : isDeadlock(r.reason) ? "DEADLOCK" : (message(r.reason).match(/\b[A-Z][A-Z_]{3,}\b/g)?.pop() ?? "ERROR");
let deadlocks = 0;
function noDeadlock(label: string, settled: PromiseSettledResult<unknown>[]) {
  const found = settled.filter(r => r.status === "rejected" && isDeadlock(r.reason)).length;
  deadlocks += found;
  assert.equal(found, 0, `${label}: deadlock (40P01)`);
}

async function prepare() {
  let input = "";
  for await (const chunk of process.stdin) { input += String(chunk); assert.ok(input.length <= 8192); }
  const target = new URL(input.trim()); input = "";
  const host = target.hostname.replace(/^\[|\]$/g, "");
  assert.ok(["postgres:", "postgresql:"].includes(target.protocol));
  assert.ok(["localhost", "127.0.0.1", "::1"].includes(host));
  assert.equal(target.pathname, "/catalogo_test");
  assert.ok([...target.searchParams.keys()].every(key => key === "schema"));
  assert.ok((await lookup(host, { all: true })).every(address => loopback(address.address)));
  target.search = ""; target.searchParams.set("schema", schema); target.searchParams.set("connection_limit", "12");
  process.env.DATABASE_URL = target.toString(); process.env.NODE_ENV = "test";
  database = new PrismaClient({ datasources: { db: { url: target.toString() } }, log: [] });
  const db = database;
  const [identity] = await db.$queryRaw<{ db: string; address: string }[]>`SELECT current_database() AS db, host(inet_server_addr()) AS address`;
  assert.ok(identity && identity.db === "catalogo_test" && loopback(identity.address));
  await db.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`); schemaCreated = true;

  stage = "ALL_MIGRATIONS";
  folder = await mkdtemp(path.join(tmpdir(), "account-lock-"));
  await writeFile(path.join(folder, "schema.prisma"), await readFile("prisma/schema.prisma"));
  await cp(path.resolve("prisma/migrations"), path.join(folder, "migrations"), { recursive: true });
  const deploy = spawnSync(process.execPath, [moduleRequire.resolve("prisma/build/index.js"), "migrate", "deploy", "--schema", path.join(folder, "schema.prisma")],
    { cwd: folder, env: { ...process.env, DATABASE_URL: target.toString() }, encoding: "utf8", timeout: 180000, maxBuffer: 1024 * 1024, windowsHide: true });
  // CLI output may include connection details: only the Prisma code is reported.
  assert.equal(deploy.status, 0, `MIGRATION_DEPLOY_FAILED ${`${deploy.stdout}${deploy.stderr}`.match(/\bP\d{4}\b/)?.[0] ?? ""}`);
  const [applied] = await db.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "${schema}"._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`);
  observations.migrations = Number(applied?.n);
  passed(`${observations.migrations} migrations applied`);
  return db;
}

type Db = PrismaClient;
const keys = () => ({ operationId: randomUUID(), requestId: randomUUID() });
const noReauth = async () => {};

/** An account with an inventory item (with price) published in a catalog, and an optional PENDING order of it. */
async function account(db: Db, stock: number, withOrder: boolean) {
  const owner = await db.user.create({ data: { email: `${runId}-${randomUUID().slice(0, 8)}@example.invalid` }, select: { id: true } });
  const item = await db.inventoryItem.create({ data: { userId: owner.id, name: "Cargador", sku: `C-${randomUUID().slice(0, 8)}`, stock } });
  await db.itemCommercialTerms.create({ data: { itemId: item.id, userId: owner.id, unitSalePrice: 20000n } });
  let orderId: string | null = null;
  if (withOrder) {
    const catalog = await db.catalog.create({ data: { userId: owner.id, name: "Tienda", slug: `t-${randomUUID().slice(0, 8)}` } });
    const product = await db.product.create({ data: { catalogId: catalog.id, name: "Cargador", slug: `p-${randomUUID().slice(0, 8)}`, price: 20000, inventoryItemId: item.id } });
    const order = await db.order.create({ data: { catalogId: catalog.id, customerName: "Comprador", customerPhone: "3000000000", total: 20000,
      items: { create: { productId: product.id, productName: "Cargador", quantity: 1, unitPrice: 20000, subtotal: 20000 } } } });
    orderId = order.id;
  }
  return { ownerId: owner.id, itemId: item.id, orderId };
}
/** Stock equals opening + the ledger: no lost or doubled movement. */
async function ledgerMatches(db: Db, itemId: string, opening: number) {
  const item = await db.inventoryItem.findUniqueOrThrow({ where: { id: itemId } });
  const movements = await db.inventoryMovement.findMany({ where: { itemId } });
  assert.equal(opening + movements.reduce((sum, m) => sum + m.delta, 0), item.stock, "stock reconciles with the ledger");
  assert.ok(item.stock >= 0);
  return item.stock;
}

/** Control: the old lock order of order conversion (users -> order) against account closure (order -> catalog -> users). */
async function controlStage(db: Db) {
  stage = "CONTROL_OLD_ORDER_DEADLOCKS";
  const { ownerId, orderId } = await account(db, 1, true);
  let arrived = 0; let release!: () => void; const both = new Promise<void>(resolve => { release = resolve; });
  const barrier = async () => { arrived += 1; if (arrived === 2) release(); await both; await sleep(50); };
  const settled = await Promise.allSettled([
    db.$transaction(async tx => { // old conversion
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${ownerId} FOR SHARE`;
      await barrier();
      await tx.$queryRaw`SELECT id FROM orders WHERE id = ${orderId} FOR UPDATE`;
    }, { timeout: 15000, maxWait: 5000 }),
    db.$transaction(async tx => { // closure
      await tx.$queryRaw`SELECT o.id FROM orders o JOIN catalogs c ON c.id = o."catalogId" WHERE c."userId" = ${ownerId} ORDER BY o.id FOR UPDATE OF o`;
      await barrier();
      await tx.$queryRaw`SELECT id FROM catalogs WHERE "userId" = ${ownerId} ORDER BY id FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${ownerId} FOR UPDATE`;
    }, { timeout: 15000, maxWait: 5000 }),
  ]);
  assert.equal(settled.filter(r => r.status === "rejected" && isDeadlock(r.reason)).length, 1, "the previous order deadlocks (PostgreSQL aborts one with 40P01)");
  passed("Control: the lock order used before F2a-2a (conversion users -> order, closure order -> catalog -> users) deadlocks when interleaved");
}

/** Account closure against order conversion, forced to interleave with a third transaction holding the order. */
async function closureVsConversion(db: Db) {
  stage = "CLOSURE_VS_CONVERSION";
  const service = makeSaleService(db);
  const seen = new Set<string>();
  for (let round = 0; round < ROUNDS; round += 1) {
    const { ownerId, itemId, orderId } = await account(db, 3, true);
    const conversion = () => service.convertOrderToSale(ownerId, orderId!, { ...keys(), mode: "CONFIRMED", acceptPriceDifference: false } as never);
    const closure = () => requestAccountClosure(ownerId, {}, db, noReauth);
    let unblock!: () => void; const blocked = new Promise<void>(resolve => { unblock = resolve; });
    let ready!: () => void; const holding = new Promise<void>(resolve => { ready = resolve; });
    const blocker = db.$transaction(async tx => { await tx.$queryRaw`SELECT id FROM orders WHERE id = ${orderId} FOR UPDATE`; ready(); await blocked; }, { timeout: 15000 });
    await holding;
    const closureFirst = round % 2 === 1;
    const first = closureFirst ? closure() : conversion();
    await sleep(150);
    const second = closureFirst ? conversion() : closure();
    await sleep(250);
    unblock(); await blocker;
    const settled = await Promise.allSettled(closureFirst ? [second, first] : [first, second]); // [conversion, closure]
    noDeadlock(`round ${round}`, settled);
    const [conv, close] = settled.map(outcome);
    seen.add(`${conv}/${close}`);
    assert.equal(conv, "OK", "the conversion completes");
    assert.equal(close, "ACCOUNT_ORDERS_REQUIRE_REVIEW", "closure fails cleanly: the order is still pending");
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: ownerId } })).closedAt, null);
    assert.equal(await ledgerMatches(db, itemId, 3), 2);
  }
  // And plainly in parallel, without the blocker.
  for (let round = 0; round < ROUNDS; round += 1) {
    const { ownerId, itemId, orderId } = await account(db, 3, true);
    const settled = await Promise.allSettled([service.convertOrderToSale(ownerId, orderId!, { ...keys(), mode: "CONFIRMED", acceptPriceDifference: false } as never), requestAccountClosure(ownerId, {}, db, noReauth)]);
    noDeadlock(`parallel round ${round}`, settled);
    assert.deepEqual(settled.map(outcome), ["OK", "ACCOUNT_ORDERS_REQUIRE_REVIEW"]);
    await ledgerMatches(db, itemId, 3);
  }
  observations.closureVsConversion = [...seen];
  passed(`Closure vs order conversion, ${ROUNDS} forced interleavings (both start orders) + ${ROUNDS} in parallel: conversion completes, closure fails cleanly (ACCOUNT_ORDERS_REQUIRE_REVIEW), no 40P01`);
}

/** Closure against money operations on an account without pending orders: closure wins or waits; the rest fail cleanly. */
async function closureVsMoney(db: Db) {
  stage = "CLOSURE_VS_MONEY";
  const service = makeSaleService(db), clock = () => new Date();
  const outcomes = new Set<string>();
  for (let round = 0; round < ROUNDS; round += 1) {
    const { ownerId, itemId } = await account(db, 5, false);
    const category = await db.expenseCategory.create({ data: { ownerId, name: "Varios", normalizedKey: "varios" } });
    const created = await service.create(ownerId, keys()) as { id: string; version: number };
    const draft = await service.updateDraft(ownerId, created.id, { operationId: randomUUID(), expectedVersion: created.version, lines: [{ inventoryItemId: itemId, quantity: 1, unitDiscount: "0" }] }) as { version: number };
    const closure = requestAccountClosure(ownerId, {}, db, noReauth);
    if (round % 2 === 1) await sleep(40); // odd rounds: closure holds the account lock before the others arrive
    const settled = await Promise.allSettled([
      closure,
      service.confirm(ownerId, created.id, { ...keys(), expectedVersion: draft.version, deliverImmediately: false }),
      makeExpenseRepository(db, clock).createExpense(ownerId, { ...keys(), expenseDate: new Date(Date.now() - 5 * 3600_000).toISOString().slice(0, 10), amount: "1000", categoryId: category.id, paymentMethod: "CASH", description: "Domicilio" }),
      moveInventory(ownerId, itemId, { key: randomUUID(), type: "IN", quantity: 1, reason: "Ingreso" }, db),
    ]);
    noDeadlock(`round ${round}`, settled);
    const [close, ...rest] = settled.map(outcome);
    assert.equal(close, "OK", "closure succeeds");
    for (const code of rest) assert.ok(["OK", "ACCOUNT_CLOSED"].includes(code), `money operation: ${code}`);
    outcomes.add(rest.join("/"));
    assert.ok((await db.user.findUniqueOrThrow({ where: { id: ownerId } })).closedAt);
    await ledgerMatches(db, itemId, 5);
  }
  observations.closureVsMoney = [...outcomes];
  passed(`Closure vs sale confirm + expense + stock movement, ${ROUNDS} rounds: closure succeeds; each other operation either finished before it or failed with ACCOUNT_CLOSED; no 40P01`);
}

/** Confirm and cancel of the same sale, in parallel. */
async function confirmVsCancel(db: Db) {
  stage = "CONFIRM_VS_CANCEL";
  const service = makeSaleService(db);
  const outcomes = new Set<string>();
  for (let round = 0; round < ROUNDS; round += 1) {
    const { ownerId, itemId } = await account(db, 4, false);
    const created = await service.create(ownerId, keys()) as { id: string; version: number };
    const draft = await service.updateDraft(ownerId, created.id, { operationId: randomUUID(), expectedVersion: created.version, lines: [{ inventoryItemId: itemId, quantity: 2, unitDiscount: "0" }] }) as { version: number };
    const settled = await Promise.allSettled([
      service.confirm(ownerId, created.id, { ...keys(), expectedVersion: draft.version, deliverImmediately: false }),
      service.cancel(ownerId, created.id, { ...keys(), expectedVersion: draft.version + 1, reason: "Cliente desistió" }),
    ]);
    noDeadlock(`round ${round}`, settled);
    const [confirm, cancel] = settled.map(outcome);
    assert.equal(confirm, "OK");
    assert.ok(["OK", "INVALID_TRANSITION"].includes(cancel), `cancel: ${cancel}`);
    outcomes.add(`${confirm}/${cancel}`);
    const sale = await db.sale.findUniqueOrThrow({ where: { id: created.id } });
    assert.equal(sale.status, cancel === "OK" ? "CANCELLED" : "CONFIRMED");
    assert.equal(await ledgerMatches(db, itemId, 4), cancel === "OK" ? 4 : 2);
  }
  observations.confirmVsCancel = [...outcomes];
  passed(`Confirm vs cancel of the same sale, ${ROUNDS} rounds: cancel either follows the confirmation or fails with INVALID_TRANSITION; stock and ledger agree; no 40P01`);
}

/** Voiding the expense that paid a scheduled payment, against paying that payment again. */
async function voidVsPay(db: Db) {
  stage = "VOID_VS_PAY";
  const clock = () => new Date();
  const expenses = makeExpenseRepository(db, clock), scheduled = makeScheduledExpenseRepository(db, clock);
  const today = new Date(Date.now() - 5 * 3600_000).toISOString().slice(0, 10); // Bogotá is UTC-5
  const outcomes = new Set<string>();
  for (let round = 0; round < ROUNDS; round += 1) {
    const owner = await db.user.create({ data: { email: `${runId}-x${round}@example.invalid` }, select: { id: true } });
    const category = await db.expenseCategory.create({ data: { ownerId: owner.id, name: "Arriendo", normalizedKey: "arriendo" } });
    const created = await scheduled.createScheduled(owner.id, { ...keys(), dueDate: today, plannedAmount: "500000", description: "Arriendo", categoryId: category.id, paymentMethod: "BANK_TRANSFER" }) as unknown as { payment: { id: string; version: number } };
    const paid = await scheduled.payScheduled(owner.id, created.payment.id, { ...keys(), expectedVersion: created.payment.version, amount: "500000", expenseDate: today, paymentMethod: "BANK_TRANSFER" }) as unknown as { expense: { id: string; version: number } };
    const payment = await db.scheduledExpensePayment.findUniqueOrThrow({ where: { id: created.payment.id } });
    const settled = await Promise.allSettled([
      expenses.voidExpense(owner.id, paid.expense.id, { ...keys(), expectedVersion: paid.expense.version, reason: "Pagado dos veces" }),
      // The version the payment will have once the void reopens it.
      scheduled.payScheduled(owner.id, payment.id, { ...keys(), expectedVersion: payment.version + 1, amount: "500000", expenseDate: today, paymentMethod: "NEQUI" }),
    ]);
    noDeadlock(`round ${round}`, settled);
    const [voided, payAgain] = settled.map(outcome);
    assert.equal(voided, "OK");
    assert.ok(["OK", "INVALID_SCHEDULED_TRANSITION"].includes(payAgain), `pay: ${payAgain}`);
    outcomes.add(`${voided}/${payAgain}`);
    const state = await db.scheduledExpensePayment.findUniqueOrThrow({ where: { id: payment.id } });
    const current = await db.expense.count({ where: { scheduledPaymentId: payment.id, status: "CONFIRMED" } });
    assert.equal(state.status, payAgain === "OK" ? "PAID" : "PENDING");
    assert.equal(current, payAgain === "OK" ? 1 : 0, "at most one current expense per scheduled payment");
  }
  observations.voidVsPay = [...outcomes];
  passed(`Void the paying expense vs pay the scheduled payment again, ${ROUNDS} rounds: pay follows the reopening or fails with INVALID_SCHEDULED_TRANSITION; payment and expenses stay coherent; no 40P01`);
}

/** Two sales of one product (plus a manual movement) on the last unit. */
async function twoSalesOneItem(db: Db) {
  stage = "TWO_SALES_ONE_ITEM";
  const service = makeSaleService(db);
  const outcomes = new Set<string>();
  for (let round = 0; round < ROUNDS; round += 1) {
    const { ownerId, itemId } = await account(db, 1, false);
    const drafts = [];
    for (let i = 0; i < 2; i += 1) {
      const created = await service.create(ownerId, keys()) as { id: string; version: number };
      const draft = await service.updateDraft(ownerId, created.id, { operationId: randomUUID(), expectedVersion: created.version, lines: [{ inventoryItemId: itemId, quantity: 1, unitDiscount: "0" }] }) as { version: number };
      drafts.push({ id: created.id, version: draft.version });
    }
    const settled = await Promise.allSettled([
      ...drafts.map(d => service.confirm(ownerId, d.id, { ...keys(), expectedVersion: d.version, deliverImmediately: round % 2 === 0 })),
      moveInventory(ownerId, itemId, { key: randomUUID(), type: "IN", quantity: 1, reason: "Reposición" }, db),
    ]);
    noDeadlock(`round ${round}`, settled);
    const codes = settled.map(outcome);
    for (const code of codes.slice(0, 2)) assert.ok(["OK", "STOCK_INSUFFICIENT"].includes(code), `confirm: ${code}`);
    assert.equal(codes[2], "OK");
    assert.ok(codes.slice(0, 2).includes("OK"), "at least one sale gets a unit");
    outcomes.add(codes.join("/"));
    const sold = codes.slice(0, 2).filter(code => code === "OK").length;
    assert.equal(await ledgerMatches(db, itemId, 1), 1 + 1 - sold);
  }
  observations.twoSalesOneItem = [...outcomes];
  passed(`Two sales of the last unit + a stock movement, ${ROUNDS} rounds: never below zero, the ledger reconciles, the loser gets STOCK_INSUFFICIENT; no 40P01`);
}

async function main() {
  const db = await prepare();
  await controlStage(db);
  await closureVsConversion(db);
  await closureVsMoney(db);
  await confirmVsCancel(db);
  await voidVsPay(db);
  await twoSalesOneItem(db);
  observations.deadlocksWithNewOrder = deadlocks;
}

main().then(() => { console.log(JSON.stringify({ success: true, checks: results, observations, productionAccess: false }, null, 2)); })
  .catch(error => { process.exitCode = 1; console.log(JSON.stringify({ success: false, stage, error: message(error).replace(/postgres(?:ql)?:\/\/\S+/g, "<url>").slice(-600), checks: results }, null, 2)); })
  .finally(async () => {
    try { if (database && schemaCreated) await database.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`); } catch { /* reported by the run */ }
    await database?.$disconnect();
    if (folder) await rm(folder, { recursive: true, force: true });
  });
