import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { cp, mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { Prisma, PrismaClient } from "@prisma/client";
import { makeSaleService } from "../services/sale.service";

// Rehearsal of migration 20261126100000_sale_payments_ledger (Pagos de la venta F2a-1,
// docs/sales-payments-cartera-contract.md) on a local throwaway PostgreSQL. Never production.
// Usage: '<postgresql://user@127.0.0.1:port/catalogo_test>' | node dist/scripts/verify-sale-payments-postgres.js
const MIGRATION = "20261126100000_sale_payments_ledger";
const moduleRequire = createRequire(__filename);
const runId = randomUUID().replaceAll("-", "");
const schema = `sale_payments_verify_${runId}`;
const results: string[] = [];
const observations: Record<string, unknown> = {};
let stage = "INPUT_VALIDATION";
let database: PrismaClient | undefined;
let schemaCreated = false;
let folder: string | undefined;
const loopback = (host: string) => host === "::1" || /^127(?:\.\d{1,3}){3}$/.test(host);
const passed = (check: string) => { results.push(check); console.error(`PASS ${stage}`); };
/** Expects a failure whose message (or Postgres code) matches. Messages never include data. */
async function rejects(work: () => Promise<unknown>, pattern: RegExp, label: string) {
  try { await work(); } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    // On mismatch, show the last line of the database error (constraint or trigger name, never row data).
    assert.match(text, pattern, `${label}: ${text.split("\n").map(line => line.trim()).filter(Boolean).pop()?.slice(0, 200) ?? ""}`); return;
  }
  assert.fail(`${label}: expected a failure`);
}

/** The read-only preflight query, split into its SELECT statements. */
async function preflightStatements() {
  const sql = await readFile(path.resolve("../docs/sql/verify-sale-payments-preflight.sql"), "utf8");
  assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|TRUNCATE|GRANT)\b/i, "preflight must stay read-only");
  const body = sql.slice(sql.indexOf("BEGIN TRANSACTION READ ONLY;") + "BEGIN TRANSACTION READ ONLY;".length, sql.lastIndexOf("ROLLBACK;"));
  const statements = body.split(";").map(part => part.split("\n").filter(line => !line.trim().startsWith("--")).join("\n").trim()).filter(Boolean);
  assert.equal(statements.length, 7, "seven numbered checks");
  return statements;
}
async function runPreflight(db: PrismaClient) {
  const statements = await preflightStatements();
  return db.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const out: Record<string, unknown>[][] = [];
    for (const statement of statements) out.push(await tx.$queryRawUnsafe<Record<string, unknown>[]>(statement));
    return out;
  });
}

async function main() {
  let input = "";
  for await (const chunk of process.stdin) { input += String(chunk); assert.ok(input.length <= 8192); }
  const target = new URL(input.trim()); input = "";
  const host = target.hostname.replace(/^\[|\]$/g, "");
  assert.ok(["postgres:", "postgresql:"].includes(target.protocol));
  assert.ok(["localhost", "127.0.0.1", "::1"].includes(host));
  assert.equal(target.pathname, "/catalogo_test");
  assert.ok([...target.searchParams.keys()].every(key => key === "schema"));
  assert.ok((await lookup(host, { all: true })).every(address => loopback(address.address)));
  target.search = ""; target.searchParams.set("schema", schema); target.searchParams.set("connection_limit", "8");
  process.env.DATABASE_URL = target.toString(); process.env.NODE_ENV = "test";
  database = new PrismaClient({ datasources: { db: { url: target.toString() } }, log: [] });
  const db = database;
  const [identity] = await db.$queryRaw<{ db: string; address: string }[]>`SELECT current_database() AS db, host(inet_server_addr()) AS address`;
  assert.ok(identity && identity.db === "catalogo_test" && loopback(identity.address));
  await db.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`); schemaCreated = true;
  await db.$disconnect();

  // ---- Migration over existing data ----
  stage = "BASELINE_MIGRATIONS";
  folder = await mkdtemp(path.join(tmpdir(), "sale-payments-"));
  const migrationRoot = path.resolve("prisma/migrations");
  const names = (await readdir(migrationRoot, { withFileTypes: true })).filter(v => v.isDirectory()).map(v => v.name).sort();
  const position = names.indexOf(MIGRATION);
  assert.ok(position > 0, "MIGRATION_MISSING");
  await writeSchema(folder);
  await mkdir(path.join(folder, "migrations"));
  await cp(path.join(migrationRoot, "migration_lock.toml"), path.join(folder, "migrations/migration_lock.toml"));
  for (const name of names.slice(0, position)) await cp(path.join(migrationRoot, name), path.join(folder, "migrations", name), { recursive: true });
  const cli = (...args: string[]) => spawnSync(process.execPath, [moduleRequire.resolve("prisma/build/index.js"), ...args],
    { cwd: folder, env: { ...process.env, DATABASE_URL: target.toString() }, encoding: "utf8", timeout: 180000, maxBuffer: 1024 * 1024, windowsHide: true });
  // CLI output may include connection details: only the Prisma code is reported.
  const deploy = () => { const run = cli("migrate", "deploy", "--schema", path.join(folder!, "schema.prisma")); return run.status === 0 ? "" : `${run.stdout}${run.stderr}`.match(/\bP\d{4}\b/)?.[0] ?? "FAILED"; };
  assert.equal(deploy(), "", "baseline migrations");
  passed(`${position} migrations before F2a-1 applied`);

  // Production-shaped sales before the migration, written with plain SQL (the current client already names the new columns).
  stage = "LEGACY_FIXTURES";
  const owner = await db.user.create({ data: { email: `${runId}-legacy@example.invalid` }, select: { id: true } });
  const item = await db.inventoryItem.create({ data: { userId: owner.id, name: "Funda", sku: `L-${runId.slice(0, 8)}`, stock: 50 }, select: { id: true } });
  const legacyIds: string[] = [];
  for (const [status, delivered, cancelled] of [["DRAFT", false, false], ["CONFIRMED", false, false], ["DELIVERED", true, false], ["CANCELLED", false, true], ["RETURNED", true, false]] as const) {
    const id = randomUUID(); legacyIds.push(id);
    await db.$executeRaw`INSERT INTO "Sale" (id, "userId", status, subtotal, total, "confirmedAt", "deliveredAt", "cancelledAt", "returnedAt", "updatedAt")
      VALUES (${id}, ${owner.id}, ${status}::"SaleStatus", 1000, 1000, ${status === "DRAFT" ? null : new Date()}, ${delivered ? new Date() : null},
              ${cancelled ? new Date() : null}, ${status === "RETURNED" ? new Date() : null}, TIMESTAMP '2026-11-01 12:00:00')`;
    await db.$executeRaw`INSERT INTO "SaleLine" (id, "saleId", "inventoryItemId", quantity, "itemName", sku, "unitPrice", "lineTotal", "commercialTermsVersion")
      VALUES (${randomUUID()}, ${id}, ${item.id}, 1, 'Funda', 'L', 1000, 1000, 1)`;
  }
  passed("Five sales before the migration: draft, confirmed, delivered, cancelled and returned");

  stage = "PREFLIGHT_BEFORE";
  const before = await runPreflight(db);
  assert.equal(before[0]!.length, 0, "no objects of the migration yet");
  assert.equal(before[1]!.length, 0, "no new Sale columns yet");
  assert.equal(before[2]!.length, 0, "no ledger row for the migration");
  assert.deepEqual(before[3]!.map(r => [r.aplicada, r.revertida]), [[true, false]], "F1b applied");
  assert.equal(before[5]!.length, 0, "no repeated (id, userId)");
  observations.salesByStatus = Object.fromEntries(before[4]!.map(r => [String(r.status), Number(r.ventas)]));
  passed("Read-only preflight before the migration: nothing exists yet, F1b applied, no repeated (id, userId)");

  stage = "MIGRATION_APPLIES";
  for (const name of names.slice(position)) await cp(path.join(migrationRoot, name), path.join(folder, "migrations", name), { recursive: true });
  const started = Date.now();
  assert.equal(deploy(), "", "F2a-1 migration");
  observations.migrationMs = Date.now() - started;
  const drift = cli("migrate", "diff", "--from-url", target.toString(), "--to-schema-datamodel", path.join(folder, "schema.prisma"), "--exit-code");
  assert.equal(drift.status, 0, "schema.prisma and the migrated database differ");
  const [applied] = await db.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "${schema}"._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`);
  observations.migrations = Number(applied?.n);
  assert.equal(observations.migrations, names.length);
  passed(`${names.length} migrations applied from scratch; no drift against schema.prisma`);

  stage = "LEGACY_SALES_UNTOUCHED";
  const legacyRows = await db.$queryRaw<{ id: string; paymentMode: string; paymentTermDays: number | null; paymentDueDate: Date | null; version: number; updatedAt: Date }[]>`
    SELECT id, "paymentMode"::text AS "paymentMode", "paymentTermDays", "paymentDueDate", version, "updatedAt" FROM "Sale" WHERE id = ANY(${legacyIds})`;
  assert.equal(legacyRows.length, 5);
  for (const row of legacyRows) {
    assert.deepEqual([row.paymentMode, row.paymentTermDays, row.paymentDueDate, row.version], ["LEGACY", null, null, 1], "existing sales become LEGACY without a rewrite");
    assert.equal(row.updatedAt.toISOString(), "2026-11-01T12:00:00.000Z", "updatedAt unchanged");
  }
  const after = await runPreflight(db);
  assert.equal(after[0]!.length, 21, "4 tables, 4 types, 8 functions, 1 index, 1 constraint and 3 Sale/return triggers");
  assert.equal(after[1]!.length, 3); assert.equal(after[2]!.length, 1);
  const [defaults] = await db.$queryRaw<{ mode: string }[]>`SELECT column_default AS mode FROM information_schema.columns WHERE table_schema = ${schema} AND table_name = 'Sale' AND column_name = 'paymentMode'`;
  assert.match(defaults?.mode ?? "", /'LEGACY'/, "the default stays LEGACY until the F2a-2 API marks sales TRACKED on confirm");
  passed("Existing sales are LEGACY with no term or due date, version and updatedAt unchanged; the preflight sees every new object; default LEGACY");

  await schemaStages(db);
  await compatibilityStage(db);
}

async function writeSchema(target: string) {
  await cp("prisma/schema.prisma", path.join(target, "schema.prisma"));
}

type Db = PrismaClient;
const key = () => randomUUID();

/** Database-level guarantees of the migration. */
async function schemaStages(db: Db) {
  stage = "FIXTURES";
  const [a, b] = await Promise.all(["a", "b"].map(tag => db.user.create({ data: { email: `${runId}-${tag}@example.invalid` }, select: { id: true } })));
  assert.ok(a && b);
  const customer = (ownerId: string, name: string) => db.customer.create({ data: { ownerId, fullName: name, phone: "3000000000" }, select: { id: true } });
  const [ana, beto, otherB] = [await customer(a.id, "Ana"), await customer(a.id, "Beto"), await customer(b.id, "Carla")];
  const items = new Map<string, string>();
  const itemOf = async (ownerId: string) => {
    if (!items.has(ownerId)) items.set(ownerId, (await db.inventoryItem.create({ data: { userId: ownerId, name: "Cargador", sku: `C-${ownerId.slice(0, 8)}`, stock: 100 }, select: { id: true } })).id);
    return items.get(ownerId)!;
  };
  /** A sale with one line (quantity x unitPrice), confirmed by the F2a-2 flow: DRAFT -> CONFIRMED and LEGACY -> TRACKED in one update. */
  async function sale(ownerId: string, opts: { customerId?: string; quantity?: number; unitPrice?: bigint; deliver?: boolean; dueDate?: string; legacy?: boolean } = {}) {
    const quantity = opts.quantity ?? 1, unitPrice = opts.unitPrice ?? 100000n, total = unitPrice * BigInt(quantity);
    const created = await db.sale.create({ data: { userId: ownerId, customerId: opts.customerId ?? null, subtotal: total, total,
      lines: { create: { inventoryItemId: await itemOf(ownerId), quantity, itemName: "Cargador", sku: "C", unitPrice, lineTotal: total, commercialTermsVersion: 1 } } }, include: { lines: true } });
    if (opts.legacy) return created;
    const now = new Date();
    return db.sale.update({ where: { id: created.id }, include: { lines: true }, data: { status: opts.deliver ? "DELIVERED" : "CONFIRMED", paymentMode: "TRACKED", paymentTermDays: 30,
      confirmedAt: now, deliveredAt: opts.deliver ? now : null, paymentDueDate: opts.deliver ? new Date(`${opts.dueDate ?? "2026-12-26"}T00:00:00Z`) : null, version: { increment: 1 } } });
  }
  type Entry = Omit<Prisma.SalePaymentEntryUncheckedCreateInput, "ownerId" | "saleId" | "operationId" | "position"> & { operationId?: string; position?: number };
  const entry = (ownerId: string, saleId: string, data: Entry, client: Prisma.TransactionClient | Db = db) =>
    client.salePaymentEntry.create({ data: { ownerId, saleId, operationId: data.operationId ?? key(), position: data.position ?? 1, ...data } });
  type Credit = Omit<Prisma.CustomerCreditEntryUncheckedCreateInput, "ownerId" | "operationId" | "position"> & { operationId?: string; position?: number };
  const credit = (ownerId: string, data: Credit, client: Prisma.TransactionClient | Db = db) =>
    client.customerCreditEntry.create({ data: { ownerId, operationId: data.operationId ?? key(), position: data.position ?? 1, ...data } });
  const creditBalance = async (customerId: string) => {
    const [row] = await db.$queryRaw<{ balance: bigint }[]>`SELECT coalesce(sum(CASE WHEN c.kind = 'FROM_SALE' THEN c.amount WHEN c.kind IN ('USED', 'REFUND') THEN -c.amount
      WHEN o.kind = 'FROM_SALE' THEN -c.amount ELSE c.amount END), 0)::bigint AS balance FROM customer_credit_entries c LEFT JOIN customer_credit_entries o ON o.id = c."reversesEntryId" WHERE c."customerId" = ${customerId}`;
    return row!.balance;
  };
  passed("Fixtures: two accounts, customers in each and an inventory item per account");

  stage = "SALE_COLUMN_RULES";
  const legacy = await sale(a.id, { legacy: true });
  await rejects(() => db.sale.update({ where: { id: legacy.id }, data: { paymentTermDays: 30 } }), /Sale_payment_columns_check|23514/, "LEGACY with a term");
  const tracked = await sale(a.id, { customerId: ana.id });
  await rejects(() => db.sale.update({ where: { id: tracked.id }, data: { paymentTermDays: 366 } }), /Sale_payment_columns_check|23514/, "term over 365");
  await rejects(() => db.sale.update({ where: { id: tracked.id }, data: { paymentMode: "LEGACY" } }), /SALE_PAYMENT_MODE_IMMUTABLE/, "TRACKED -> LEGACY");
  await rejects(() => db.sale.update({ where: { id: tracked.id }, data: { paymentDueDate: new Date("2026-12-01T00:00:00Z") } }), /SALE_PAYMENT_DUE_DATE_INVALID|Sale_payment_columns_check/, "due date before delivery");
  const legacyConfirmed = await db.sale.update({ where: { id: legacy.id }, data: { status: "CONFIRMED", confirmedAt: new Date() } });
  await rejects(() => db.sale.update({ where: { id: legacyConfirmed.id }, data: { paymentMode: "TRACKED" } }), /SALE_PAYMENT_MODE_IMMUTABLE/, "a confirmed LEGACY sale stays LEGACY");
  await db.sale.update({ where: { id: tracked.id }, data: { paymentTermDays: 15, version: { increment: 1 } } });
  await db.sale.update({ where: { id: tracked.id }, data: { customerId: beto.id } });
  await db.sale.update({ where: { id: tracked.id }, data: { customerId: ana.id } });
  passed("Sale columns: LEGACY carries no term, term 0–365, TRACKED is final, a due date needs a delivery, a confirmed LEGACY sale cannot switch; term and customer editable while CONFIRMED (correction B)");

  stage = "DELIVERY_AND_DUE_DATE";
  const delivered = await db.sale.update({ where: { id: tracked.id }, data: { status: "DELIVERED", deliveredAt: new Date(), paymentDueDate: new Date("2026-12-11T00:00:00Z") } });
  await db.sale.update({ where: { id: delivered.id }, data: { paymentDueDate: new Date("2026-12-20T00:00:00Z") } });
  await rejects(() => db.sale.update({ where: { id: delivered.id }, data: { paymentDueDate: null } }), /SALE_PAYMENT_DUE_DATE_INVALID/, "clearing the due date");
  await rejects(() => db.sale.update({ where: { id: delivered.id }, data: { paymentTermDays: 60 } }), /SALE_PAYMENT_TERM_LOCKED/, "term after delivery");
  await rejects(() => db.sale.update({ where: { id: delivered.id }, data: { customerId: beto.id } }), /SALE_CUSTOMER_LOCKED/, "customer after delivery");
  const legacyDelivered = await db.sale.update({ where: { id: legacyConfirmed.id }, data: { status: "DELIVERED", deliveredAt: new Date() } });
  await db.sale.update({ where: { id: legacyDelivered.id }, data: { customerId: ana.id } });
  passed("Delivery sets the due date; it can change later (decision 5) but never be cleared; term and customer are frozen after delivery on TRACKED; LEGACY keeps today's behaviour");

  stage = "LEDGER_CHECKS";
  const s1 = await sale(a.id, { customerId: ana.id, unitPrice: 85000n });
  await entry(a.id, s1.id, { kind: "PAYMENT", amount: 50000n, method: "NEQUI" });
  await entry(a.id, s1.id, { kind: "PAYMENT", amount: 35000n, method: "CASH", cashReceived: 50000n, position: 2 });
  for (const [data, label] of [
    [{ kind: "PAYMENT", amount: 1n, method: "OTHER" }, "OTHER without note"],
    [{ kind: "PAYMENT", amount: 1n, method: "CASH", methodNote: "Caja" }, "note without OTHER"],
    [{ kind: "PAYMENT", amount: 1n, method: "OTHER", methodNote: "ab" }, "note under 3 characters"],
    [{ kind: "PAYMENT", amount: 10n, method: "CASH", cashReceived: 9n }, "cash received below the amount"],
    [{ kind: "PAYMENT", amount: 10n, method: "NEQUI", cashReceived: 10n }, "cash received outside CASH"],
    [{ kind: "PAYMENT", amount: 0n, method: "CASH" }, "amount 0"],
    [{ kind: "PAYMENT", amount: 1000000000001n, method: "CASH" }, "amount over 1e12"],
    [{ kind: "PAYMENT", amount: 1n, method: "CASH", reason: "Por qué" }, "reason on a payment"],
    [{ kind: "PAYMENT", amount: 1n }, "payment without method"],
    [{ kind: "CREDIT_USE", amount: 1n }, "credit use without its credit entry"],
    [{ kind: "PAYMENT", amount: 1n, method: "CASH", position: 0 }, "position 0"],
  ] as [Entry, string][]) await rejects(() => entry(a.id, s1.id, data), /sale_payment_entries_(valid|kind)_check|23514/, label);
  await rejects(() => entry(a.id, s1.id, { kind: "PAYMENT", amount: 1n, method: "CASH" }), /SALE_PAYMENT_BALANCE_INVALID/, "paying above the total (checked at commit)");
  passed("Ledger CHECKs: method and note, cash received only on CASH and >= amount, amounts 1..1e12, columns per kind; mixed payment 50.000 Nequi + 35.000 cash; over-payment rejected at commit");

  stage = "ONLY_TRACKED_SALES";
  const draftRow = await db.sale.create({ data: { userId: a.id, subtotal: 0n, total: 0n } });
  const draft = await db.sale.update({ where: { id: draftRow.id }, data: { paymentMode: "TRACKED" } }); // allowed while DRAFT
  await rejects(() => entry(a.id, legacyDelivered.id, { kind: "PAYMENT", amount: 1n, method: "CASH" }), /SALE_PAYMENTS_NOT_TRACKED/, "payment on a LEGACY sale");
  await rejects(() => entry(a.id, draft.id, { kind: "PAYMENT", amount: 1n, method: "CASH" }), /SALE_PAYMENTS_NOT_TRACKED/, "payment on a draft");
  passed("No entries on LEGACY sales or drafts");

  stage = "APPEND_ONLY";
  const firstEntry = await db.salePaymentEntry.findFirstOrThrow({ where: { saleId: s1.id } });
  await rejects(() => db.salePaymentEntry.update({ where: { id: firstEntry.id }, data: { amount: 1n } }), /MONEY_LEDGER_APPEND_ONLY/, "update an entry");
  await rejects(() => db.salePaymentEntry.delete({ where: { id: firstEntry.id } }), /MONEY_LEDGER_APPEND_ONLY/, "delete an entry");
  await rejects(() => db.$executeRawUnsafe(`TRUNCATE "${schema}".sale_payment_entries CASCADE`), /MONEY_LEDGER_APPEND_ONLY/, "truncate the ledger");
  const receipt = await db.saleMoneyOperation.create({ data: { ownerId: a.id, operationId: key(), requestId: key(), kind: "SALE_ADVANCE", resourceId: s1.id, requestHash: "a".repeat(64), responseSnapshot: {} } });
  await rejects(() => db.saleMoneyOperation.update({ where: { ownerId_operationId: { ownerId: a.id, operationId: receipt.operationId } }, data: { kind: "X" } }), /MONEY_LEDGER_APPEND_ONLY/, "update a receipt");
  await rejects(() => db.saleMoneyOperation.delete({ where: { ownerId_operationId: { ownerId: a.id, operationId: receipt.operationId } } }), /MONEY_LEDGER_APPEND_ONLY/, "delete a receipt");
  passed("Append-only: ledger entries and receipts reject UPDATE, DELETE and TRUNCATE");

  stage = "REVERSALS";
  await rejects(() => entry(a.id, s1.id, { kind: "REVERSAL", amount: 49999n, reversesEntryId: firstEntry.id, reason: "Monto equivocado" }), /SALE_PAYMENT_REVERSAL_INVALID/, "partial reversal");
  await rejects(() => entry(a.id, s1.id, { kind: "REVERSAL", amount: firstEntry.amount, reversesEntryId: firstEntry.id }), /kind_check|23514/, "reversal without reason");
  const reversal = await entry(a.id, s1.id, { kind: "REVERSAL", amount: firstEntry.amount, reversesEntryId: firstEntry.id, reason: "Nequi no llegó" });
  await rejects(() => entry(a.id, s1.id, { kind: "REVERSAL", amount: firstEntry.amount, reversesEntryId: firstEntry.id, reason: "Otra vez" }), /Unique constraint|23505/, "reversing twice");
  await rejects(() => entry(a.id, s1.id, { kind: "REVERSAL", amount: reversal.amount, reversesEntryId: reversal.id, reason: "Deshacer" }), /SALE_PAYMENT_REVERSAL_INVALID/, "reversing a reversal");
  const s2 = await sale(a.id, { customerId: ana.id });
  const cashEntry = await db.salePaymentEntry.findFirstOrThrow({ where: { saleId: s1.id, method: "CASH" } });
  await rejects(() => entry(a.id, s2.id, { kind: "REVERSAL", amount: cashEntry.amount, reversesEntryId: cashEntry.id, reason: "De otra venta" }), /Foreign key|23503/, "reversing an entry of another sale");
  await entry(a.id, s1.id, { kind: "PAYMENT", amount: 50000n, method: "BANK_TRANSFER" });
  passed("Reversals: same amount, a reason, once, never of a reversal, same sale only; paying again after a reversal");

  stage = "CROSS_ACCOUNT";
  const saleB = await sale(b.id, { customerId: otherB.id });
  await rejects(() => entry(a.id, saleB.id, { kind: "PAYMENT", amount: 1n, method: "CASH" }), /Foreign key|23503/, "entry on another account's sale");
  await rejects(() => entry(b.id, s2.id, { kind: "PAYMENT", amount: 1n, method: "CASH" }), /Foreign key|23503/, "another owner on A's sale");
  await rejects(() => credit(a.id, { customerId: otherB.id, kind: "REFUND", amount: 1n, method: "CASH" }), /Foreign key|23503/, "credit of another account's customer");
  await rejects(() => credit(a.id, { customerId: ana.id, kind: "FROM_SALE", amount: 1n, saleId: saleB.id }), /Foreign key|23503/, "credit pointing to another account's sale");
  passed("Composite FKs reject every mix of accounts: sale, owner, customer and sale of the credit entry");

  stage = "EXAMPLE_300K";
  // Contract 5.3: $300.000 sale, 100.000 paid in cash and 200.000 on credit; returns of 150.000 and then the rest.
  const big = await sale(a.id, { customerId: beto.id, quantity: 2, unitPrice: 150000n, deliver: true });
  await entry(a.id, big.id, { kind: "PAYMENT", amount: 100000n, method: "CASH", cashReceived: 100000n });
  const ret = async (quantity: number, finish: boolean, tx: Prisma.TransactionClient) => {
    const r = await tx.saleReturn.create({ data: { saleId: big.id, userId: a.id, operationId: key(), reason: "Devolución" } });
    await tx.saleReturnLine.create({ data: { returnId: r.id, saleLineId: big.lines[0]!.id, receivedQuantity: quantity, resellableQuantity: quantity, damagedQuantity: 0 } });
    if (finish) await tx.sale.update({ where: { id: big.id }, data: { status: "RETURNED", returnedAt: new Date() } });
  };
  await db.$transaction(tx => ret(1, false, tx));
  // Debt now 50.000: paid 100.000 <= effective 150.000, nothing to move.
  await rejects(() => db.$transaction(tx => ret(1, true, tx)), /SALE_PAYMENT_BALANCE_INVALID/, "full return leaving the cash on a sale with customer");
  await db.$transaction(async tx => {
    await ret(1, true, tx);
    const op = key();
    const c = await credit(a.id, { customerId: beto.id, kind: "FROM_SALE", amount: 100000n, saleId: big.id, operationId: op }, tx);
    await entry(a.id, big.id, { kind: "EXCESS_TO_CREDIT", amount: 100000n, creditEntryId: c.id, operationId: op }, tx);
  });
  assert.equal(await creditBalance(beto.id), 100000n, "saldo a favor 100.000");
  passed("Example $300.000: partial return of 150.000 leaves 50.000 owed; the full return must move the 100.000 paid to the credit balance in the same transaction");

  stage = "CUSTOMER_CREDIT";
  const next = await sale(a.id, { customerId: beto.id, unitPrice: 90000n });
  await db.$transaction(async tx => {
    const op = key();
    const used = await credit(a.id, { customerId: beto.id, kind: "USED", amount: 70000n, saleId: next.id, operationId: op }, tx);
    await entry(a.id, next.id, { kind: "CREDIT_USE", amount: 70000n, creditEntryId: used.id, operationId: op }, tx);
    await entry(a.id, next.id, { kind: "PAYMENT", amount: 20000n, method: "CASH", operationId: op, position: 2 }, tx);
  });
  assert.equal(await creditBalance(beto.id), 30000n);
  await rejects(() => db.$transaction(async tx => {
    const s = await sale(a.id, { customerId: beto.id });
    const used = await credit(a.id, { customerId: beto.id, kind: "USED", amount: 30001n, saleId: s.id }, tx);
    await entry(a.id, s.id, { kind: "CREDIT_USE", amount: 30001n, creditEntryId: used.id }, tx);
  }), /CUSTOMER_CREDIT_NEGATIVE/, "using more credit than available");
  await rejects(() => credit(a.id, { customerId: beto.id, kind: "FROM_SALE", amount: 5n, saleId: next.id }), /CUSTOMER_CREDIT_UNPAIRED/, "credit from a sale without its sale entry");
  await rejects(() => db.$transaction(async tx => {
    const used = await credit(a.id, { customerId: beto.id, kind: "USED", amount: 10n, saleId: next.id }, tx);
    await entry(a.id, next.id, { kind: "CREDIT_USE", amount: 9n, creditEntryId: used.id }, tx);
  }), /SALE_PAYMENT_CREDIT_MISMATCH/, "credit use with another amount");
  await rejects(() => db.$transaction(async tx => {
    const used = await credit(a.id, { customerId: ana.id, kind: "USED", amount: 10n, saleId: next.id }, tx);
    await entry(a.id, next.id, { kind: "CREDIT_USE", amount: 10n, creditEntryId: used.id }, tx);
  }), /SALE_PAYMENT_CREDIT_MISMATCH/, "credit of another customer");
  const refund = await credit(a.id, { customerId: beto.id, kind: "REFUND", amount: 30000n, method: "NEQUI" });
  assert.equal(await creditBalance(beto.id), 0n, "«Devolver dinero» empties the balance");
  await rejects(() => credit(a.id, { customerId: beto.id, kind: "REFUND", amount: 1n, method: "CASH" }), /CUSTOMER_CREDIT_NEGATIVE/, "refunding more than the balance");
  await rejects(() => credit(a.id, { customerId: beto.id, kind: "REVERSAL", amount: 29999n, reversesEntryId: refund.id, reason: "No se entregó" }), /CUSTOMER_CREDIT_REVERSAL_INVALID/, "partial credit reversal");
  await credit(a.id, { customerId: beto.id, kind: "REVERSAL", amount: 30000n, reversesEntryId: refund.id, reason: "No se entregó" });
  assert.equal(await creditBalance(beto.id), 30000n, "voiding the refund restores the balance");
  const usedEntry = await db.salePaymentEntry.findFirstOrThrow({ where: { saleId: next.id, kind: "CREDIT_USE" } });
  await rejects(() => entry(a.id, next.id, { kind: "REVERSAL", amount: 70000n, reversesEntryId: usedEntry.id, reason: "Sin su par" }), /SALE_PAYMENT_REVERSAL_INVALID/, "reversing a credit use without reversing its credit entry");
  await db.$transaction(async tx => {
    const op = key();
    const back = await credit(a.id, { customerId: beto.id, kind: "REVERSAL", amount: 70000n, saleId: next.id, reversesEntryId: usedEntry.creditEntryId!, reason: "Error al cobrar", operationId: op }, tx);
    await entry(a.id, next.id, { kind: "REVERSAL", amount: 70000n, reversesEntryId: usedEntry.id, creditEntryId: back.id, reason: "Error al cobrar", operationId: op }, tx);
  });
  assert.equal(await creditBalance(beto.id), 100000n, "voiding a credit use gives the credit back");
  passed("Credit balance: use as a payment method, never negative, pairing with the sale (kind, amount, sale, customer), refund and its void, voiding a use returns the credit");

  stage = "CANCEL_WITH_ADVANCE";
  const advance = await sale(a.id, { customerId: ana.id, unitPrice: 500000n });
  await entry(a.id, advance.id, { kind: "PAYMENT", amount: 200000n, method: "BANK_TRANSFER" });
  await rejects(() => db.sale.update({ where: { id: advance.id }, data: { status: "CANCELLED", cancelledAt: new Date() } }), /SALE_PAYMENT_BALANCE_INVALID/, "cancelling and keeping the advance on the sale");
  await db.$transaction(async tx => {
    await tx.sale.update({ where: { id: advance.id }, data: { status: "CANCELLED", cancelledAt: new Date() } });
    const op = key();
    const c = await credit(a.id, { customerId: ana.id, kind: "FROM_SALE", amount: 200000n, saleId: advance.id, operationId: op }, tx);
    await entry(a.id, advance.id, { kind: "EXCESS_TO_CREDIT", amount: 200000n, creditEntryId: c.id, operationId: op }, tx);
  });
  assert.equal(await creditBalance(ana.id), 200000n);
  passed("Cancelling a CONFIRMED sale with an advance: all of it must move to the customer's credit balance");

  stage = "CUSTOMER_CHANGE_WITH_CREDIT";
  const withCredit = await sale(a.id, { customerId: ana.id, unitPrice: 50000n });
  await db.$transaction(async tx => {
    const op = key();
    const used = await credit(a.id, { customerId: ana.id, kind: "USED", amount: 50000n, saleId: withCredit.id, operationId: op }, tx);
    await entry(a.id, withCredit.id, { kind: "CREDIT_USE", amount: 50000n, creditEntryId: used.id, operationId: op }, tx);
  });
  await rejects(() => db.sale.update({ where: { id: withCredit.id }, data: { customerId: beto.id } }), /SALE_PAYMENT_CUSTOMER_MISMATCH/, "changing the customer of a sale paid with the previous customer's credit");
  await rejects(() => db.sale.update({ where: { id: withCredit.id }, data: { customerId: null } }), /SALE_PAYMENT_CUSTOMER_MISMATCH/, "unlinking it");
  passed("A CONFIRMED sale paid with a customer's credit cannot change customer until that use is voided");

  stage = "NO_CUSTOMER";
  const walkIn = await sale(a.id, { unitPrice: 60000n, deliver: true });
  await entry(a.id, walkIn.id, { kind: "PAYMENT", amount: 60000n, method: "CASH" });
  await db.$transaction(async tx => {
    const r = await tx.saleReturn.create({ data: { saleId: walkIn.id, userId: a.id, operationId: key(), reason: "No le sirvió" } });
    await tx.saleReturnLine.create({ data: { returnId: r.id, saleLineId: walkIn.lines[0]!.id, receivedQuantity: 1, resellableQuantity: 1, damagedQuantity: 0 } });
    await tx.sale.update({ where: { id: walkIn.id }, data: { status: "RETURNED", returnedAt: new Date() } });
  });
  // Without a customer the 60.000 stay on the sale as «por devolver» (decision 1) until refunded.
  await rejects(() => entry(a.id, walkIn.id, { kind: "SALE_REFUND", amount: 60001n, method: "CASH" }), /SALE_PAYMENT_BALANCE_INVALID/, "refunding more than received");
  await entry(a.id, walkIn.id, { kind: "SALE_REFUND", amount: 60000n, method: "CASH" });
  await rejects(() => entry(a.id, advance.id, { kind: "SALE_REFUND", amount: 1n, method: "CASH" }), /SALE_REFUND_REQUIRES_NO_CUSTOMER/, "direct refund on a sale with customer");
  passed("Without a customer: a returned paid sale keeps the money as «por devolver»; SALE_REFUND up to what was received; with a customer refunds go through the credit balance");

  stage = "IDEMPOTENCY";
  const op = key();
  const s3 = await sale(a.id, { unitPrice: 30000n });
  await entry(a.id, s3.id, { kind: "PAYMENT", amount: 10000n, method: "CASH", operationId: op, position: 1 });
  await rejects(() => entry(a.id, s3.id, { kind: "PAYMENT", amount: 10000n, method: "CASH", operationId: op, position: 1 }), /Unique constraint|23505/, "same operation, sale and position twice");
  await entry(a.id, s3.id, { kind: "PAYMENT", amount: 10000n, method: "NEQUI", operationId: op, position: 2 });
  const requestId = key();
  await db.saleMoneyOperation.create({ data: { ownerId: a.id, operationId: op, requestId, kind: "SALE_ADVANCE", resourceId: s3.id, requestHash: "b".repeat(64), responseSnapshot: { ok: true } } });
  await rejects(() => db.saleMoneyOperation.create({ data: { ownerId: a.id, operationId: op, requestId: key(), kind: "SALE_ADVANCE", resourceId: s3.id, requestHash: "b".repeat(64), responseSnapshot: {} } }), /Unique constraint|23505/, "same operationId twice");
  await rejects(() => db.saleMoneyOperation.create({ data: { ownerId: a.id, operationId: key(), requestId, kind: "SALE_ADVANCE", resourceId: s3.id, requestHash: "b".repeat(64), responseSnapshot: {} } }), /Unique constraint|23505/, "same requestId in another operation");
  await rejects(() => db.saleMoneyOperation.create({ data: { ownerId: a.id, operationId: key(), requestId: key(), kind: "SALE_ADVANCE", resourceId: s3.id, requestHash: "NOT-A-HASH", responseSnapshot: {} } }), /valid_check|23514/, "bad hash");
  await db.saleMoneyOperation.create({ data: { ownerId: b.id, operationId: op, requestId, kind: "SALE_ADVANCE", resourceId: saleB.id, requestHash: "c".repeat(64), responseSnapshot: {} } });
  const creditOp = key();
  await credit(a.id, { customerId: ana.id, kind: "REFUND", amount: 1n, method: "CASH", operationId: creditOp });
  await rejects(() => credit(a.id, { customerId: ana.id, kind: "REFUND", amount: 1n, method: "CASH", operationId: creditOp }), /Unique constraint|23505/, "credit entry repeated in one operation");
  await rejects(() => db.$transaction(async tx => {
    const c = await credit(a.id, { customerId: ana.id, kind: "FROM_SALE", amount: 1n, saleId: s3.id }, tx);
    await entry(a.id, s3.id, { kind: "EXCESS_TO_CREDIT", amount: 1n, creditEntryId: c.id }, tx);
    await entry(a.id, s3.id, { kind: "EXCESS_TO_CREDIT", amount: 1n, creditEntryId: c.id, position: 2 }, tx);
  }), /Unique constraint|23505|SALE_PAYMENT_CREDIT_MISMATCH/, "one credit entry paired twice");
  passed("Idempotency: (owner, operation, sale, position) and (owner, operation, position) unique; receipts by (owner, operationId) and (owner, requestId); the same keys in another account are independent; a credit entry pairs with one sale entry");

  stage = "SETTINGS";
  const settings = await db.receivableSettings.create({ data: { ownerId: a.id } });
  assert.equal(settings.defaultTermDays, 30, "default term of the business: 30 days");
  await db.receivableSettings.update({ where: { ownerId: a.id }, data: { defaultTermDays: 0, version: { increment: 1 } } });
  await rejects(() => db.receivableSettings.update({ where: { ownerId: a.id }, data: { defaultTermDays: 366 } }), /receivable_settings_valid_check|23514/, "term over 365");
  await rejects(() => db.receivableSettings.delete({ where: { ownerId: a.id } }), /RECEIVABLE_SETTINGS_GUARD/, "deleting the settings");
  passed("Receivable settings: 30 days by default, 0–365, edited but never deleted");

  observations.entries = await db.salePaymentEntry.count();
  observations.creditEntries = await db.customerCreditEntry.count();
}

/** The sales service published today keeps working on the new schema and produces LEGACY sales without entries. */
async function compatibilityStage(db: Db) {
  stage = "CURRENT_API_COMPATIBILITY";
  const owner = await db.user.create({ data: { email: `${runId}-compat@example.invalid` }, select: { id: true } });
  const itemRow = await db.inventoryItem.create({ data: { userId: owner.id, name: "Vidrio", sku: `V-${runId.slice(0, 8)}`, stock: 10 } });
  await db.itemCommercialTerms.create({ data: { itemId: itemRow.id, userId: owner.id, unitSalePrice: 20000n } });
  const service = makeSaleService(db);
  const keys = () => ({ operationId: randomUUID(), requestId: randomUUID() });
  const draft = async (quantity: number) => {
    const created = await service.create(owner.id, keys());
    return service.updateDraft(owner.id, created.id, { operationId: randomUUID(), expectedVersion: created.version, lines: [{ inventoryItemId: itemRow.id, quantity, unitDiscount: "0" }] });
  };
  const one = await draft(2) as unknown as { id: string; version: number };
  // Since F2a-3c every confirmation sends its payments: an advance of 0, then the rest at delivery.
  const confirmed = await service.confirm(owner.id, one.id, { ...keys(), expectedVersion: one.version, deliverImmediately: false, payments: [] }) as unknown as { version: number };
  const deliveredSale = await service.transition(owner.id, one.id, { ...keys(), expectedVersion: confirmed.version, payments: [{ method: "CASH", amount: "40000" }] }) as unknown as { version: number; lines: { id: string }[] };
  await service.returnSale(owner.id, one.id, { ...keys(), expectedVersion: deliveredSale.version, reason: "Partial", lines: [{ saleLineId: deliveredSale.lines[0]!.id, receivedQuantity: 1, resellableQuantity: 1, damagedQuantity: 0 }] });
  const two = await draft(1) as unknown as { id: string; version: number };
  const twoConfirmed = await service.confirm(owner.id, two.id, { ...keys(), expectedVersion: two.version, deliverImmediately: false, payments: [] }) as unknown as { version: number };
  await service.cancel(owner.id, two.id, { ...keys(), expectedVersion: twoConfirmed.version, reason: "Cliente desistió" });
  const rows = await db.sale.findMany({ where: { userId: owner.id }, select: { status: true, paymentMode: true, paymentTermDays: true, paymentDueDate: true } });
  assert.deepEqual(rows.map(r => r.status).sort(), ["CANCELLED", "DELIVERED"]);
  assert.ok(rows.every(r => r.paymentMode === "TRACKED" && r.paymentTermDays === null && r.paymentDueDate === null), "the current API (F2a-3c) creates TRACKED sales; no term while fiado is off");
  assert.equal(await db.salePaymentEntry.count({ where: { ownerId: owner.id } }), 1, "the delivery payment; the partial return leaves 20.000 «por devolver» (no customer)");
  assert.equal((await db.inventoryItem.findUniqueOrThrow({ where: { id: itemRow.id } })).stock, 9, "stock: 10 − 2 − 1 + 1 returned + 1 cancelled");
  passed("Current sales service on the new schema: confirm (payments required), deliver, partial return and cancel work, sales are TRACKED, stock unchanged in behaviour");
}

main().then(() => { console.log(JSON.stringify({ success: true, checks: results, observations, productionAccess: false }, null, 2)); })
  .catch(error => { process.exitCode = 1; console.log(JSON.stringify({ success: false, stage, error: error instanceof Error ? error.message.replace(/postgres(?:ql)?:\/\/\S+/g, "<url>").slice(-700) : "UNKNOWN", checks: results }, null, 2)); })
  .finally(async () => {
    try { if (database && schemaCreated) await database.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`); } catch { /* reported by the run */ }
    await database?.$disconnect();
    if (folder) await rm(folder, { recursive: true, force: true });
  });
