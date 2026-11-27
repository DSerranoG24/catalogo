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
import { makeSaleMoneyService } from "../services/sale-money.service";
import { closurePreview, requestAccountClosure } from "../services/account-closure.service";

// Rehearsal of the payments API of a sale (F2a-2b, docs/sales-payments-cartera-contract.md) on a local throwaway
// PostgreSQL with the real migrations and triggers. Never production.
// Usage: '<postgresql://user@127.0.0.1:port/catalogo_test>' | node dist/scripts/verify-sale-payments-api-postgres.js
const moduleRequire = createRequire(__filename);
const runId = randomUUID().replaceAll("-", "");
const schema = `sale_payments_api_${runId}`;
const results: string[] = [];
let stage = "INPUT_VALIDATION";
let database: PrismaClient | undefined;
let schemaCreated = false;
let folder: string | undefined;
const loopback = (host: string) => host === "::1" || /^127(?:\.\d{1,3}){3}$/.test(host);
const passed = (check: string) => { results.push(check); console.error(`PASS ${stage}`); };
const message = (reason: unknown) => reason instanceof Error ? reason.message : String(reason);
async function rejects(work: () => Promise<unknown>, code: string, label: string) {
  try { await work(); } catch (error) { assert.match(message(error), new RegExp(`\\b${code}\\b`), `${label}: ${message(error).split("\n").pop()?.slice(0, 160)}`); return; }
  assert.fail(`${label}: expected ${code}`);
}
const keys = () => ({ operationId: randomUUID(), requestId: randomUUID() });
const cash = (amount: string, cashReceived?: string) => ({ method: "CASH" as const, amount, ...(cashReceived ? { cashReceived } : {}) });
type Payments = { mode: string; paid: string; balance: string; refundDue: string; effectiveTotal: string; stage: string | null; entries?: { kind: string; amount: string; change: string | null; voided: boolean }[]; customerCredit?: string | null };
type SaleView = { id: string; status: string; version: number; total: string; paymentMode: string; paymentDueDate: string | null; customerId: string | null; customerNameSnapshot: string | null; lines: { id: string }[]; payments: Payments };
const json = <T>(value: unknown) => JSON.parse(JSON.stringify(value, (_k, v) => typeof v === "bigint" ? v.toString() : v)) as T;

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
  target.search = ""; target.searchParams.set("schema", schema); target.searchParams.set("connection_limit", "10");
  process.env.DATABASE_URL = target.toString(); process.env.NODE_ENV = "test";
  database = new PrismaClient({ datasources: { db: { url: target.toString() } }, log: [] });
  const [identity] = await database.$queryRaw<{ db: string; address: string }[]>`SELECT current_database() AS db, host(inet_server_addr()) AS address`;
  assert.ok(identity && identity.db === "catalogo_test" && loopback(identity.address));
  await database.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`); schemaCreated = true;
  stage = "ALL_MIGRATIONS";
  folder = await mkdtemp(path.join(tmpdir(), "sale-payments-api-"));
  await writeFile(path.join(folder, "schema.prisma"), await readFile("prisma/schema.prisma"));
  await cp(path.resolve("prisma/migrations"), path.join(folder, "migrations"), { recursive: true });
  const deploy = spawnSync(process.execPath, [moduleRequire.resolve("prisma/build/index.js"), "migrate", "deploy", "--schema", path.join(folder, "schema.prisma")],
    { cwd: folder, env: { ...process.env, DATABASE_URL: target.toString() }, encoding: "utf8", timeout: 180000, maxBuffer: 1024 * 1024, windowsHide: true });
  assert.equal(deploy.status, 0, `MIGRATION_DEPLOY_FAILED ${`${deploy.stdout}${deploy.stderr}`.match(/\bP\d{4}\b/)?.[0] ?? ""}`);
  passed("All migrations applied");
  return database;
}

async function main() {
  const db = await prepare();
  const sales = makeSaleService(db), money = makeSaleMoneyService(db);
  const owner = async (tag: string) => (await db.user.create({ data: { email: `${runId}-${tag}@example.invalid` }, select: { id: true } })).id;
  const item = async (ownerId: string, price: bigint, stock = 50) => {
    const row = await db.inventoryItem.create({ data: { userId: ownerId, name: `Art ${price}`, sku: `S-${randomUUID().slice(0, 8)}`, stock } });
    await db.itemCommercialTerms.create({ data: { itemId: row.id, userId: ownerId, unitSalePrice: price } });
    return row.id;
  };
  const customer = async (ownerId: string, name: string) => (await db.customer.create({ data: { ownerId, fullName: name, phone: "3001234567" }, select: { id: true } })).id;
  /** A draft with one line of `quantity` units of `itemId`, optionally linked to a customer. */
  const draft = async (ownerId: string, itemId: string, quantity = 1, customerId?: string) => {
    const created = await sales.create(ownerId, { ...keys(), ...(customerId ? { customerId } : {}) }) as unknown as { id: string; version: number };
    return await sales.updateDraft(ownerId, created.id, { operationId: randomUUID(), expectedVersion: created.version, lines: [{ inventoryItemId: itemId, quantity, unitDiscount: "0" }] }) as unknown as { id: string; version: number };
  };
  const get = async (ownerId: string, saleId: string) => json<SaleView>(await sales.get(ownerId, saleId));
  const stockOf = async (itemId: string) => (await db.inventoryItem.findUniqueOrThrow({ where: { id: itemId } })).stock;
  const credit = async (ownerId: string, customerId: string) => json<{ balance: string }>(await money.customerCredit(ownerId, customerId)).balance;

  const a = await owner("a"), b = await owner("b");
  const ana = await customer(a, "Ana"), beto = await customer(a, "Beto");

  stage = "MIXED_PAYMENT";
  const phone = await item(a, 85000n);
  let d = await draft(a, phone);
  let sale = json<SaleView>(await sales.confirm(a, d.id, { ...keys(), expectedVersion: d.version, deliverImmediately: true,
    payments: [{ method: "NEQUI", amount: "50000" }, cash("35000", "50000")] }));
  assert.deepEqual([sale.status, sale.paymentMode, sale.payments.paid, sale.payments.balance, sale.payments.stage, sale.paymentDueDate], ["DELIVERED", "TRACKED", "85000", "0", "PAID", null]);
  assert.deepEqual(sale.payments.entries?.map(e => [e.kind, e.amount, e.change]), [["PAYMENT", "50000", null], ["PAYMENT", "35000", "15000"]], "cash received is stored, the change only shown");
  passed("Mixed payment at confirm and deliver: 50.000 Nequi + 35.000 cash (received 50.000, change 15.000); TRACKED, paid, no due date (fiado off)");

  stage = "ADVANCE_THEN_DELIVERY";
  const tv = await item(a, 400000n);
  d = await draft(a, tv, 1, ana);
  sale = json<SaleView>(await sales.confirm(a, d.id, { ...keys(), expectedVersion: d.version, deliverImmediately: false, payments: [] }));
  assert.deepEqual([sale.status, sale.paymentMode, sale.payments.balance, sale.payments.stage], ["CONFIRMED", "TRACKED", "400000", "PENDING_ORDER"], "payments: [] makes the sale TRACKED");
  let advanced = json<{ result: SaleView; idempotent: boolean }>(await money.advance(a, sale.id, { ...keys(), expectedVersion: sale.version, payments: [{ method: "BANK_TRANSFER", amount: "150000" }] }));
  assert.deepEqual([advanced.result.payments.paid, advanced.result.payments.balance], ["150000", "250000"]);
  await rejects(() => sales.transition(a, sale.id, { ...keys(), expectedVersion: advanced.result.version }), "SALE_BALANCE_DUE", "delivery with a balance and fiado off");
  await rejects(() => sales.transition(a, sale.id, { ...keys(), expectedVersion: advanced.result.version, payments: [cash("250001")] }), "PAYMENT_EXCEEDS_BALANCE", "paying more than owed");
  sale = json<SaleView>(await sales.transition(a, sale.id, { ...keys(), expectedVersion: advanced.result.version, payments: [cash("250000")] }));
  assert.deepEqual([sale.status, sale.payments.paid, sale.payments.balance], ["DELIVERED", "400000", "0"]);
  passed("Advance on CONFIRMED, then delivery: a balance is rejected (SALE_BALANCE_DUE), over-payment too; paying the rest delivers");

  stage = "DELIVER_WITH_BALANCE_ROLLS_BACK";
  const before = await stockOf(phone);
  d = await draft(a, phone);
  await rejects(() => sales.confirm(a, d.id, { ...keys(), expectedVersion: d.version, deliverImmediately: true, payments: [cash("10000")] }), "SALE_BALANCE_DUE", "confirm and deliver with a balance");
  assert.equal(await stockOf(phone), before, "nothing written: stock unchanged");
  assert.equal((await get(a, d.id)).status, "DRAFT");
  passed("Confirm-and-deliver with a balance is rejected atomically: no stock movement, still a draft");

  stage = "CANCEL_WITH_ADVANCE";
  d = await draft(a, tv, 1, ana);
  sale = json<SaleView>(await sales.confirm(a, d.id, { ...keys(), expectedVersion: d.version, payments: [{ method: "BANK_TRANSFER", amount: "200000" }] }));
  sale = json<SaleView>(await sales.cancel(a, sale.id, { ...keys(), expectedVersion: sale.version, reason: "Cliente desistió" }));
  assert.deepEqual([sale.status, sale.payments.paid, sale.payments.stage], ["CANCELLED", "0", "SETTLED"]);
  assert.equal(await credit(a, ana), "200000", "with a customer the advance becomes credit");
  d = await draft(a, tv);
  sale = json<SaleView>(await sales.confirm(a, d.id, { ...keys(), expectedVersion: d.version, payments: [cash("120000")] }));
  const walkIn = json<SaleView>(await sales.cancel(a, sale.id, { ...keys(), expectedVersion: sale.version, reason: "Desistió" }));
  assert.deepEqual([walkIn.payments.refundDue, walkIn.payments.stage], ["120000", "REFUND_DUE"], "without a customer the money stays «por devolver»");
  await rejects(() => money.refundSale(a, walkIn.id, { ...keys(), expectedVersion: walkIn.version, amount: "120001", method: "CASH", reason: "Devuelto" }), "REFUND_EXCEEDS_DUE", "refund above what is due");
  const refunded = json<{ result: SaleView }>(await money.refundSale(a, walkIn.id, { ...keys(), expectedVersion: walkIn.version, amount: "120000", method: "CASH", reason: "Devuelto en caja" }));
  assert.deepEqual([refunded.result.payments.refundDue, refunded.result.payments.stage], ["0", "SETTLED"]);
  d = await draft(a, tv);
  sale = json<SaleView>(await sales.confirm(a, d.id, { ...keys(), expectedVersion: d.version, payments: [cash("50000")] }));
  sale = json<SaleView>(await sales.cancel(a, sale.id, { ...keys(), expectedVersion: sale.version, reason: "Desistió", refundNow: { method: "NEQUI" } }));
  assert.deepEqual([sale.payments.refundDue, sale.payments.entries?.map(e => e.kind)], ["0", ["PAYMENT", "SALE_REFUND"]], "«Devolver ahora» refunds in the same operation");
  d = await draft(a, tv, 1, beto);
  sale = json<SaleView>(await sales.confirm(a, d.id, { ...keys(), expectedVersion: d.version, payments: [] }));
  await rejects(() => sales.cancel(a, sale.id, { ...keys(), expectedVersion: sale.version, reason: "Desistió", refundNow: { method: "CASH" } }), "REFUND_NOW_REQUIRES_NO_CUSTOMER", "refundNow with a customer");
  passed("Cancel with an advance: with a customer → credit (200.000); without → «por devolver», refunded later or with «Devolver ahora»; refundNow rejected with a customer");

  stage = "RETURNS";
  const speaker = await item(a, 150000n);
  d = await draft(a, speaker, 2, beto);
  sale = json<SaleView>(await sales.confirm(a, d.id, { ...keys(), expectedVersion: d.version, deliverImmediately: true, payments: [cash("300000")] }));
  const lineId = sale.lines[0]!.id;
  sale = json<SaleView>(await sales.returnSale(a, sale.id, { ...keys(), expectedVersion: sale.version, reason: "Una no sirvió", lines: [{ saleLineId: lineId, receivedQuantity: 1, resellableQuantity: 0, damagedQuantity: 1 }] }));
  assert.deepEqual([sale.status, sale.payments.effectiveTotal, sale.payments.paid], ["DELIVERED", "150000", "150000"], "the damaged unit counts at sale value (decision 9)");
  assert.equal(await credit(a, beto), "150000");
  sale = json<SaleView>(await sales.returnSale(a, sale.id, { ...keys(), expectedVersion: sale.version, reason: "La otra también", lines: [{ saleLineId: lineId, receivedQuantity: 1, resellableQuantity: 1, damagedQuantity: 0 }] }));
  assert.deepEqual([sale.status, sale.payments.effectiveTotal, sale.payments.paid, sale.payments.stage], ["RETURNED", "0", "0", "SETTLED"]);
  assert.equal(await credit(a, beto), "300000", "partial then total return: all of the 300.000 paid is credit");
  d = await draft(a, speaker, 2);
  sale = json<SaleView>(await sales.confirm(a, d.id, { ...keys(), expectedVersion: d.version, deliverImmediately: true, payments: [cash("300000")] }));
  sale = json<SaleView>(await sales.returnSale(a, sale.id, { ...keys(), expectedVersion: sale.version, reason: "Una", lines: [{ saleLineId: sale.lines[0]!.id, receivedQuantity: 1, resellableQuantity: 1, damagedQuantity: 0 }] }));
  assert.deepEqual([sale.payments.refundDue, sale.payments.stage], ["150000", "REFUND_DUE"], "without a customer a partial return leaves 150.000 «por devolver»");
  passed("Partial and total returns: with a customer the excess goes to credit (150.000, then 300.000); without, a partial return leaves 150.000 «por devolver»");

  stage = "CREDIT_USE_AND_REFUND";
  d = await draft(a, phone, 1, beto);
  sale = json<SaleView>(await sales.confirm(a, d.id, { ...keys(), expectedVersion: d.version, deliverImmediately: true, customerCreditAmount: "70000", payments: [cash("15000")] }));
  assert.deepEqual([sale.payments.paid, sale.payments.customerCredit], ["85000", "230000"], "credit used as a payment method");
  d = await draft(a, phone, 1, beto);
  await rejects(() => sales.confirm(a, d.id, { ...keys(), expectedVersion: d.version, customerCreditAmount: "230001" }), "PAYMENT_EXCEEDS_BALANCE", "credit above the sale balance");
  d = await draft(a, tv, 1, beto);
  await rejects(() => sales.confirm(a, d.id, { ...keys(), expectedVersion: d.version, customerCreditAmount: "230001" }), "CREDIT_INSUFFICIENT", "more credit than the customer has");
  d = await draft(a, phone);
  await rejects(() => sales.confirm(a, d.id, { ...keys(), expectedVersion: d.version, customerCreditAmount: "1" }), "CUSTOMER_REQUIRED_FOR_CREDIT", "credit without a customer");
  await rejects(() => money.refundCredit(a, beto, { ...keys(), amount: "230001", method: "CASH", reason: "Devolución" }), "CREDIT_INSUFFICIENT", "refunding more than the balance");
  const refund = json<{ result: { entryId: string; balance: string } }>(await money.refundCredit(a, beto, { ...keys(), amount: "30000", method: "NEQUI", reason: "Pidió su dinero" }));
  assert.equal(refund.result.balance, "200000");
  const restored = json<{ result: { balance: string } }>(await money.voidCreditRefund(a, beto, refund.result.entryId, { ...keys(), reason: "No se envió" }));
  assert.equal(restored.result.balance, "230000");
  await rejects(() => money.voidCreditRefund(a, beto, refund.result.entryId, { ...keys(), reason: "Otra vez" }), "PAYMENT_ALREADY_VOIDED", "voiding twice");
  passed("Credit: used as a payment method (70.000), never above the sale balance or the customer's credit, only with a customer; «Devolver dinero» and its void; never negative");

  stage = "VOID_PAYMENT";
  d = await draft(a, tv, 1, ana);
  sale = json<SaleView>(await sales.confirm(a, d.id, { ...keys(), expectedVersion: d.version, payments: [] }));
  advanced = json<{ result: SaleView; idempotent: boolean }>(await money.advance(a, sale.id, { ...keys(), expectedVersion: sale.version, payments: [cash("100000")] }));
  const entryId = (await db.salePaymentEntry.findFirstOrThrow({ where: { saleId: sale.id, kind: "PAYMENT" } })).id;
  let voided = json<{ result: SaleView }>(await money.voidPayment(a, sale.id, entryId, { ...keys(), expectedVersion: advanced.result.version, reason: "Transferencia rechazada" }));
  assert.deepEqual([voided.result.payments.paid, voided.result.payments.balance, voided.result.payments.entries?.map(e => [e.kind, e.voided])], ["0", "400000", [["PAYMENT", true], ["REVERSAL", false]]]);
  await rejects(() => money.voidPayment(a, sale.id, entryId, { ...keys(), expectedVersion: voided.result.version, reason: "Otra vez" }), "PAYMENT_ALREADY_VOIDED", "voiding twice");
  // A cancelled sale whose advance became credit that the customer then spent: voiding the advance cannot take it back.
  const cancelledWithCredit = await db.sale.findFirstOrThrow({ where: { userId: a, customerId: ana, status: "CANCELLED", paymentMode: "TRACKED" } });
  const anaCredit = await credit(a, ana);
  d = await draft(a, tv, 1, ana);
  sale = json<SaleView>(await sales.confirm(a, d.id, { ...keys(), expectedVersion: d.version, deliverImmediately: true, customerCreditAmount: anaCredit, payments: [cash(String(400000n - BigInt(anaCredit)))] }));
  const advance = (await db.salePaymentEntry.findFirstOrThrow({ where: { saleId: cancelledWithCredit.id, kind: "PAYMENT" } })).id;
  await rejects(() => money.voidPayment(a, cancelledWithCredit.id, advance, { ...keys(), expectedVersion: cancelledWithCredit.version, reason: "No llegó" }), "CREDIT_ALREADY_USED", "the credit from that advance was already used");
  passed("Void a payment with a reason: balance comes back, history keeps both rows, once only; cannot claw back credit already used (CREDIT_ALREADY_USED)");

  stage = "VOID_AND_REPLACE";
  // F2a-3c: on a delivered sale a payment is voided only together with its replacement, for the same amount.
  d = await draft(a, phone);
  sale = json<SaleView>(await sales.confirm(a, d.id, { ...keys(), expectedVersion: d.version, deliverImmediately: true, payments: [{ method: "NEQUI", amount: "85000" }] }));
  const nequi = (await db.salePaymentEntry.findFirstOrThrow({ where: { saleId: sale.id, kind: "PAYMENT" } })).id;
  await rejects(() => money.voidPayment(a, sale.id, nequi, { ...keys(), expectedVersion: sale.version, reason: "Era en efectivo" }), "VOID_REQUIRES_REPLACEMENT", "plain void on a delivered sale");
  await rejects(() => money.replacePayment(a, sale.id, nequi, { ...keys(), expectedVersion: sale.version, reason: "Era en efectivo", payment: cash("80000") }), "REPLACEMENT_AMOUNT_MISMATCH", "replacement for another amount");
  assert.equal(await db.salePaymentEntry.count({ where: { saleId: sale.id } }), 1, "rejections write nothing");
  const replaceOp = keys(), replaceBody = { expectedVersion: sale.version, reason: "Era en efectivo", payment: cash("85000", "100000") };
  const replaced = json<{ result: SaleView; idempotent: boolean }>(await money.replacePayment(a, sale.id, nequi, { ...replaceOp, ...replaceBody }));
  assert.deepEqual([replaced.result.status, replaced.result.payments.paid, replaced.result.payments.balance, replaced.result.payments.stage], ["DELIVERED", "85000", "0", "PAID"]);
  assert.deepEqual(replaced.result.payments.entries?.map(e => [e.kind, e.amount, e.voided, e.change]), [["PAYMENT", "85000", true, null], ["REVERSAL", "85000", false, null], ["PAYMENT", "85000", false, "15000"]],
    "the Nequi payment voided with its reason, the cash one below it (change only shown)");
  const replayed = json<{ result: SaleView; idempotent: boolean }>(await money.replacePayment(a, sale.id, nequi, { ...replaceOp, requestId: randomUUID(), ...replaceBody }));
  assert.equal(replayed.idempotent, true);
  assert.equal(await db.salePaymentEntry.count({ where: { saleId: sale.id } }), 3, "the retry duplicates nothing");
  await rejects(() => money.replacePayment(a, sale.id, nequi, { ...keys(), expectedVersion: replaced.result.version, reason: "Otra vez", payment: cash("85000") }), "PAYMENT_ALREADY_VOIDED", "replacing twice");
  // A delivered sale left with a balance by a plain void before this rule: it can be paid down, never above the balance.
  d = await draft(a, phone);
  sale = json<SaleView>(await sales.confirm(a, d.id, { ...keys(), expectedVersion: d.version, deliverImmediately: true, payments: [cash("85000")] }));
  const old = await db.salePaymentEntry.findFirstOrThrow({ where: { saleId: sale.id, kind: "PAYMENT" } });
  await db.salePaymentEntry.create({ data: { ownerId: a, saleId: sale.id, operationId: randomUUID(), position: 1, kind: "REVERSAL", amount: 85000n, reversesEntryId: old.id, reason: "Anulación anterior a F2a-3c" } });
  sale = await get(a, sale.id);
  assert.deepEqual([sale.status, sale.payments.balance], ["DELIVERED", "85000"]);
  await rejects(() => money.advance(a, sale.id, { ...keys(), expectedVersion: sale.version, payments: [cash("85001")] }), "PAYMENT_EXCEEDS_BALANCE", "repair above the balance");
  const repaired = json<{ result: SaleView }>(await money.advance(a, sale.id, { ...keys(), expectedVersion: sale.version, payments: [cash("85000")] }));
  assert.deepEqual([repaired.result.status, repaired.result.payments.balance], ["DELIVERED", "0"]);
  await rejects(() => money.advance(a, sale.id, { ...keys(), expectedVersion: repaired.result.version, payments: [cash("1")] }), "INVALID_PAYMENT_STATE", "no new balance on a paid delivered sale");
  passed("Void and replace on a DELIVERED sale: plain void rejected (VOID_REQUIRES_REPLACEMENT), other amount rejected, Nequi → cash keeps the balance at 0 with the voided payment and its replacement, the retry duplicates nothing; an old balance is paid down only up to it");

  stage = "IDEMPOTENCY";
  d = await draft(a, tv);
  sale = json<SaleView>(await sales.confirm(a, d.id, { ...keys(), expectedVersion: d.version, payments: [] }));
  const op = keys();
  const body = { expectedVersion: sale.version, payments: [cash("10000")] };
  const first = json<{ result: SaleView; idempotent: boolean }>(await money.advance(a, sale.id, { ...op, ...body }));
  const again = json<{ result: SaleView; idempotent: boolean }>(await money.advance(a, sale.id, { ...op, requestId: randomUUID(), ...body }));
  assert.deepEqual([first.idempotent, again.idempotent, again.result.payments.paid], [false, true, "10000"]);
  assert.equal(await db.salePaymentEntry.count({ where: { saleId: sale.id } }), 1, "one movement for the repeated operation");
  await rejects(() => money.advance(a, sale.id, { ...op, requestId: randomUUID(), expectedVersion: sale.version, payments: [cash("20000")] }), "IDEMPOTENCY_CONFLICT", "same key, other content");
  const confirmKeys = keys();
  d = await draft(a, phone);
  const confirmBody = { expectedVersion: d.version, deliverImmediately: true, payments: [cash("85000")] };
  await sales.confirm(a, d.id, { ...confirmKeys, ...confirmBody });
  await sales.confirm(a, d.id, { ...confirmKeys, requestId: randomUUID(), ...confirmBody });
  assert.equal(await db.salePaymentEntry.count({ where: { saleId: d.id } }), 1, "a repeated confirmation records its payments once");
  passed("Idempotency: same operationId with a new requestId replays the receipt (one movement, also for confirm with payments); other content conflicts");

  stage = "CONCURRENT_PAYMENTS";
  for (let round = 0; round < 6; round += 1) {
    d = await draft(a, await item(a, 100000n));
    sale = json<SaleView>(await sales.confirm(a, d.id, { ...keys(), expectedVersion: d.version, payments: [] }));
    const settled = await Promise.allSettled([0, 1].map(() => money.advance(a, sale.id, { ...keys(), expectedVersion: sale.version, payments: [cash("60000")] })));
    const outcomes = settled.map(r => r.status === "fulfilled" ? "OK" : message(r.reason).match(/\b[A-Z_]{6,}\b/g)?.pop());
    assert.deepEqual(outcomes.sort(), ["OK", "VERSION_CONFLICT"], `round ${round}: ${outcomes}`);
    assert.equal((await get(a, sale.id)).payments.paid, "60000");
  }
  // Same version on purpose is the realistic race; with fresh versions the balance check stops the second.
  d = await draft(a, await item(a, 100000n));
  sale = json<SaleView>(await sales.confirm(a, d.id, { ...keys(), expectedVersion: d.version, payments: [cash("60000")] }));
  await rejects(() => money.advance(a, sale.id, { ...keys(), expectedVersion: sale.version, payments: [cash("60000")] }), "PAYMENT_EXCEEDS_BALANCE", "together above the total");
  passed("Two simultaneous advances that together exceed the total, 6 rounds: one succeeds, the other fails cleanly (VERSION_CONFLICT); a later one above the balance gets PAYMENT_EXCEEDS_BALANCE");

  stage = "LEGACY_UNCHANGED";
  d = await draft(a, phone);
  sale = json<SaleView>(await sales.confirm(a, d.id, { ...keys(), expectedVersion: d.version, deliverImmediately: false }));
  assert.equal(sale.paymentMode, "LEGACY"); assert.equal((sale as unknown as { payments?: unknown }).payments, undefined, "LEGACY mutation responses are unchanged");
  await rejects(() => money.advance(a, sale.id, { ...keys(), expectedVersion: sale.version, payments: [cash("1")] }), "LEGACY_SALE_PAYMENTS_UNSUPPORTED", "payment on a LEGACY sale");
  await rejects(() => sales.transition(a, sale.id, { ...keys(), expectedVersion: sale.version, payments: [cash("1")] }), "LEGACY_SALE_PAYMENTS_UNSUPPORTED", "paying at the delivery of a LEGACY sale");
  sale = json<SaleView>(await sales.transition(a, sale.id, { ...keys(), expectedVersion: sale.version }));
  assert.equal(sale.status, "DELIVERED", "a LEGACY sale is delivered as before, without payments");
  assert.deepEqual((await get(a, sale.id)).payments, { mode: "LEGACY", customerCredit: null });
  passed("LEGACY: confirm without payments stays LEGACY with the same response; payments rejected (LEGACY_SALE_PAYMENTS_UNSUPPORTED); delivery as before");

  stage = "LINK_CUSTOMER";
  d = await draft(a, tv);
  sale = json<SaleView>(await sales.confirm(a, d.id, { ...keys(), expectedVersion: d.version, payments: [] }));
  const linked = json<{ result: SaleView }>(await money.linkCustomer(a, sale.id, { ...keys(), expectedVersion: sale.version, customerId: ana }));
  assert.deepEqual([linked.result.customerId, linked.result.customerNameSnapshot], [ana, "Ana"], "the customer's data is copied");
  const rebound = json<{ result: SaleView }>(await money.linkCustomer(a, sale.id, { ...keys(), expectedVersion: linked.result.version, customerId: beto }));
  assert.deepEqual([rebound.result.customerId, rebound.result.customerNameSnapshot], [beto, "Beto"], "changed while CONFIRMED");
  const paidWithCredit = json<{ result: SaleView }>(await money.advance(a, sale.id, { ...keys(), expectedVersion: rebound.result.version, customerCreditAmount: "1000" }));
  await rejects(() => money.linkCustomer(a, sale.id, { ...keys(), expectedVersion: paidWithCredit.result.version, customerId: ana }), "CUSTOMER_CHANGE_BLOCKED", "change while paid with Beto's credit");
  d = await draft(a, phone, 1, ana);
  sale = json<SaleView>(await sales.confirm(a, d.id, { ...keys(), expectedVersion: d.version, deliverImmediately: true, payments: [cash("85000")] }));
  await rejects(() => money.linkCustomer(a, sale.id, { ...keys(), expectedVersion: sale.version, customerId: beto }), "CUSTOMER_CHANGE_BLOCKED", "after delivery");
  passed("Link or change the customer of a CONFIRMED sale with its data copied; blocked while it uses the previous customer's credit and after delivery");

  stage = "ORDER_CONVERSION_WITH_PAYMENTS";
  const catalog = await db.catalog.create({ data: { userId: a, name: "Tienda", slug: `t-${runId.slice(0, 8)}` } });
  const product = await db.product.create({ data: { catalogId: catalog.id, name: "Celular", slug: "celular", price: 85000, inventoryItemId: phone } });
  const order = async () => (await db.order.create({ data: { catalogId: catalog.id, customerName: "Comprador", customerPhone: "3000000000", total: 85000,
    items: { create: { productId: product.id, productName: "Celular", quantity: 1, unitPrice: 85000, subtotal: 85000 } } } })).id;
  const partial = await order();
  await rejects(() => sales.convertOrderToSale(a, partial, { ...keys(), mode: "DELIVERED", acceptPriceDifference: false, payments: [cash("40000")] } as never), "SALE_BALANCE_DUE", "delivered conversion with a balance");
  assert.equal(await db.sale.count({ where: { sourceOrderId: partial } }), 0, "nothing created");
  const converted = json<{ sale: SaleView }>(await sales.convertOrderToSale(a, partial, { ...keys(), mode: "DELIVERED", acceptPriceDifference: false, payments: [cash("40000"), { method: "CARD", amount: "45000" }] } as never));
  assert.deepEqual([converted.sale.status, converted.sale.paymentMode, converted.sale.payments.paid], ["DELIVERED", "TRACKED", "85000"]);
  const pending = json<{ sale: SaleView }>(await sales.convertOrderToSale(a, await order(), { ...keys(), mode: "CONFIRMED", acceptPriceDifference: false, payments: [cash("20000")] } as never));
  assert.deepEqual([pending.sale.status, pending.sale.payments.balance], ["CONFIRMED", "65000"]);
  passed("Order conversion accepts the payments of confirm: delivered only when fully paid (atomic rejection otherwise); confirmed with an advance");

  stage = "CROSS_ACCOUNT";
  const foreign = pending.sale.id, foreignEntry = (await db.salePaymentEntry.findFirstOrThrow({ where: { saleId: foreign } })).id;
  await rejects(() => sales.get(b, foreign), "NOT_FOUND", "read");
  await rejects(() => money.advance(b, foreign, { ...keys(), expectedVersion: pending.sale.version, payments: [cash("1")] }), "NOT_FOUND", "advance");
  await rejects(() => money.voidPayment(b, foreign, foreignEntry, { ...keys(), expectedVersion: pending.sale.version, reason: "Ajena" }), "NOT_FOUND", "void");
  await rejects(() => money.replacePayment(b, foreign, foreignEntry, { ...keys(), expectedVersion: pending.sale.version, reason: "Ajena", payment: cash("20000") }), "NOT_FOUND", "replace");
  await rejects(() => money.linkCustomer(b, foreign, { ...keys(), expectedVersion: pending.sale.version, customerId: ana }), "CUSTOMER_NOT_FOUND", "link another account's customer");
  await rejects(() => money.customerCredit(b, ana), "CUSTOMER_NOT_FOUND", "credit of another account");
  await rejects(() => money.refundCredit(b, ana, { ...keys(), amount: "1", method: "CASH", reason: "Ajena" }), "CUSTOMER_NOT_FOUND", "refund another account's credit");
  const bSale = await draft(b, await item(b, 1000n), 1, await customer(b, "Bea"));
  await rejects(() => sales.confirm(b, bSale.id, { ...keys(), expectedVersion: bSale.version, customerCreditAmount: "1" }), "CREDIT_INSUFFICIENT", "B cannot use A's credit balances");
  assert.equal((await money.customerCredit(a, ana)).balance >= 0n, true);
  passed("Another account sees and touches nothing: reads, advances, voids, customers, credit and refunds answer as not found");

  stage = "CLOSURE_PREVIEW";
  const preview = json<{ undeliveredSales: number; pendingOrderBalance: string; customerCredit: { total: string; customers: number }; refundDue: { total: string; sales: number }; requiresConfirmation: boolean; unresolvedOrders: number }>(await closurePreview(a, db));
  assert.ok(preview.requiresConfirmation && preview.undeliveredSales > 0 && BigInt(preview.pendingOrderBalance) > 0n && BigInt(preview.customerCredit.total) > 0n && BigInt(preview.refundDue.total) > 0n);
  const c = await owner("c"), cItem = await item(c, 5000n), cCustomer = await customer(c, "Carlos");
  d = await draft(c, cItem, 1, cCustomer);
  sale = json<SaleView>(await sales.confirm(c, d.id, { ...keys(), expectedVersion: d.version, payments: [cash("2000")] }));
  await sales.cancel(c, sale.id, { ...keys(), expectedVersion: sale.version, reason: "Desistió" });
  const cPreview = json<{ customerCredit: { total: string }; undeliveredSales: number; requiresConfirmation: boolean }>(await closurePreview(c, db));
  assert.deepEqual([cPreview.customerCredit.total, cPreview.undeliveredSales, cPreview.requiresConfirmation], ["2000", 0, true]);
  await rejects(() => requestAccountClosure(c, {}, db, async () => {}), "ACCOUNT_CLOSURE_REQUIRES_CONFIRMATION", "closing without confirming the preview");
  assert.equal((await db.user.findUniqueOrThrow({ where: { id: c } })).closedAt, null);
  await requestAccountClosure(c, { confirmOpenBalances: true }, db, async () => {});
  assert.ok((await db.user.findUniqueOrThrow({ where: { id: c } })).closedAt, "confirmed: the account closes");
  assert.equal(await db.customerCreditEntry.count({ where: { ownerId: c } }), 1, "closing deletes no money history (the FROM_SALE of the cancellation)");
  const empty = await owner("empty");
  assert.equal(json<{ requiresConfirmation: boolean }>(await closurePreview(empty, db)).requiresConfirmation, false);
  await requestAccountClosure(empty, {}, db, async () => {});
  passed("Closure preview: pending orders balance, credit, «por devolver» and undelivered sales; closing needs confirmOpenBalances when anything is open; an empty account closes as before");
}

main().then(() => { console.log(JSON.stringify({ success: true, checks: results, productionAccess: false }, null, 2)); })
  .catch(error => { process.exitCode = 1; console.log(JSON.stringify({ success: false, stage, error: message(error).replace(/postgres(?:ql)?:\/\/\S+/g, "<url>").slice(-700), checks: results }, null, 2)); })
  .finally(async () => {
    try { if (database && schemaCreated) await database.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`); } catch { /* reported by the run */ }
    await database?.$disconnect();
    if (folder) await rm(folder, { recursive: true, force: true });
  });
