import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { PrismaClient } from "@prisma/client";

// Rehearsal of GET /api/dashboard/summary SQL on a local throwaway PostgreSQL (never production).
// Usage: '<postgresql://user@127.0.0.1:port/catalogo_test>' | node dist/scripts/verify-dashboard-postgres.js
const moduleRequire = createRequire(__filename);
const runId = randomUUID().replaceAll("-", "");
const schema = `dashboard_verify_${runId}`;
const results: string[] = [];
const observations: Record<string, unknown> = {};
let stage = "INPUT_VALIDATION";
let database: PrismaClient | undefined;
let schemaCreated = false;
let folder: string | undefined;
const loopback = (host: string) => host === "::1" || /^127(?:\.\d{1,3}){3}$/.test(host);
const passed = (check: string) => results.push(check);

async function main() {
  let input = "";
  for await (const chunk of process.stdin) { input += String(chunk); assert.ok(input.length <= 8192); }
  const target = new URL(input.trim());
  const host = target.hostname.replace(/^\[|\]$/g, "");
  assert.ok(["postgres:", "postgresql:"].includes(target.protocol));
  assert.ok(["localhost", "127.0.0.1", "::1"].includes(host));
  assert.equal(target.pathname, "/catalogo_test");
  assert.ok([...target.searchParams.keys()].every(key => key === "schema"));
  assert.ok((await lookup(host, { all: true })).every(address => loopback(address.address)));
  target.search = ""; target.searchParams.set("schema", schema); target.searchParams.set("connection_limit", "4");
  process.env.DATABASE_URL = target.toString();
  database = new PrismaClient({ datasources: { db: { url: target.toString() } }, log: [] });
  const db = database;
  const [identity] = await db.$queryRaw<{ db: string; address: string }[]>`SELECT current_database() AS db, host(inet_server_addr()) AS address`;
  assert.ok(identity && identity.db === "catalogo_test" && loopback(identity.address));
  await db.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`); schemaCreated = true;
  await db.$disconnect();

  stage = "ALL_MIGRATIONS";
  folder = await mkdtemp(path.join(tmpdir(), "vitrinaya-dashboard-"));
  await writeFile(path.join(folder, "schema.prisma"), await readFile("prisma/schema.prisma"));
  await cp(path.resolve("prisma/migrations"), path.join(folder, "migrations"), { recursive: true });
  const child = spawnSync(process.execPath, [moduleRequire.resolve("prisma/build/index.js"), "migrate", "deploy", "--schema", path.join(folder, "schema.prisma")],
    { cwd: folder, env: { ...process.env, DATABASE_URL: target.toString() }, encoding: "utf8", timeout: 180000, maxBuffer: 1024 * 1024 });
  // CLI output may include connection details: only the Prisma code is reported.
  assert.equal(child.status, 0, `MIGRATION_DEPLOY_FAILED ${`${child.stdout}${child.stderr}`.match(/\bP\d{4}\b/)?.[0] ?? ""}`);
  const [applied] = await db.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "${schema}"._prisma_migrations WHERE finished_at IS NOT NULL`);
  observations.migrations = Number(applied?.n);
  passed(`${observations.migrations} migrations applied`);

  const { dashboardSummarySql, dashboardExpensesSql, readDashboardSummary } = await import("../repositories/dashboard-summary.repository.js");
  const { presentSummary } = await import("../services/dashboard-summary.js");
  async function summaryAt(ownerId: string, asOf: Date, days: 7 | 30 | 90, expenses = false) {
    const [row] = await db.$queryRaw<{ data: unknown }[]>(dashboardSummarySql(ownerId, asOf, days));
    const expenseRow = expenses ? (await db.$queryRaw<{ data: unknown }[]>(dashboardExpensesSql(ownerId, asOf)))[0]?.data : null;
    return presentSummary(row?.data, expenseRow ?? null, asOf, days);
  }

  stage = "FIXTURES";
  const [a, b, c] = await Promise.all(["a", "b", "c"].map(name => db.user.create({ data: { email: `${runId}-${name}@example.invalid` }, select: { id: true } })));
  assert.ok(a && b && c);
  const item = (userId: string, sku: string, stock: number, minimumStock: number) => db.inventoryItem.create({ data: { userId, name: `Artículo ${sku}`, sku, stock, minimumStock }, select: { id: true } });
  const items = { x: await item(a.id, "X", 5, 10), y: await item(a.id, "Y", 0, 3), z: await item(a.id, "Z", 3, 3), w: await item(a.id, "W", 0, 0), v: await item(a.id, "V", 50, 0), bItem: await item(b.id, "B", 1, 0) };
  type Line = { item: string; quantity: number; unitPrice: bigint; unitDiscount?: bigint; unitCost: bigint | null };
  async function sale(userId: string, status: "DRAFT" | "CONFIRMED" | "DELIVERED" | "CANCELLED" | "RETURNED", confirmedAt: string | null, lines: Line[], customerNameSnapshot: string | null = null) {
    const rows = lines.map(l => ({ ...l, unitDiscount: l.unitDiscount ?? 0n }));
    const subtotal = rows.reduce((sum, l) => sum + l.unitPrice * BigInt(l.quantity), 0n), discountTotal = rows.reduce((sum, l) => sum + l.unitDiscount * BigInt(l.quantity), 0n);
    return db.sale.create({ data: { userId, status, confirmedAt: confirmedAt ? new Date(confirmedAt) : null, subtotal, discountTotal, total: subtotal - discountTotal, customerNameSnapshot,
      lines: { create: rows.map(l => ({ inventoryItemId: l.item, quantity: l.quantity, itemName: "Línea", sku: "SKU", unitPrice: l.unitPrice, unitDiscount: l.unitDiscount, unitCost: l.unitCost,
        lineTotal: (l.unitPrice - l.unitDiscount) * BigInt(l.quantity), commercialTermsVersion: 1 })) } }, include: { lines: true } });
  }
  async function giveBack(userId: string, saleId: string, lineId: string, at: string, resellable: number, damaged: number) {
    await db.saleReturn.create({ data: { saleId, userId, operationId: randomUUID(), reason: "Prueba", createdAt: new Date(at),
      lines: { create: [{ saleLineId: lineId, receivedQuantity: resellable + damaged, resellableQuantity: resellable, damagedQuantity: damaged }] } } });
  }
  // asOf: 2026-03-01 10:00 in Bogotá (UTC−5). Today = Mar 1, yesterday = Feb 28 (28-day month), previous month = February.
  const asOf = new Date("2026-03-01T15:00:00.000Z");
  const big = 9007199254740993000n;
  await sale(a.id, "DELIVERED", "2026-03-01T05:00:00.000Z", [{ item: items.x.id, quantity: 2, unitPrice: 50000n, unitCost: 30000n }], "Cliente A"); // 00:00 today
  await sale(a.id, "CONFIRMED", "2026-03-01T04:59:59.999Z", [{ item: items.y.id, quantity: 1, unitPrice: 7000n, unitCost: null }]); // 23:59:59.999 Feb 28
  await sale(a.id, "CANCELLED", "2026-03-01T13:00:00.000Z", [{ item: items.z.id, quantity: 1, unitPrice: 999999n, unitCost: 1n }]);
  await sale(a.id, "DRAFT", null, [{ item: items.w.id, quantity: 1, unitPrice: 5555n, unitCost: 1n }]);
  const s5 = await sale(a.id, "RETURNED", "2026-02-10T17:00:00.000Z", [{ item: items.v.id, quantity: 1, unitPrice: big, unitCost: 1n }]);
  await giveBack(a.id, s5.id, s5.lines[0]!.id, "2026-03-01T15:00:00.000Z", 1, 0); // returned today: −big, cost back 1
  const s6 = await sale(a.id, "DELIVERED", "2026-02-01T04:00:00.000Z", [{ item: items.x.id, quantity: 3, unitPrice: 1000n, unitDiscount: 100n, unitCost: 400n }]); // Jan 31 23:00
  await giveBack(a.id, s6.id, s6.lines[0]!.id, "2026-02-15T12:00:00.000Z", 0, 1); // damaged: −900 on Feb 15, no cost back
  await sale(a.id, "CONFIRMED", "2026-03-01T14:00:00.000Z", [{ item: items.y.id, quantity: 1, unitPrice: 1000n, unitCost: 10n }, { item: items.z.id, quantity: 1, unitPrice: 2000n, unitCost: null }]);
  await sale(b.id, "DELIVERED", "2026-03-01T14:30:00.000Z", [{ item: items.bItem.id, quantity: 1, unitPrice: 123n, unitCost: 100n }]);
  const catalogA = await db.catalog.create({ data: { userId: a.id, name: "A", slug: `a-${runId}` }, select: { id: true } });
  const catalogB = await db.catalog.create({ data: { userId: b.id, name: "B", slug: `b-${runId}`, active: false }, select: { id: true } });
  await db.product.create({ data: { catalogId: catalogA.id, name: "Producto", slug: `p-${runId}`, price: 1000 } });
  const order = (catalogId: string, status: "PENDING" | "CONFIRMED", anonymizedAt: Date | null = null) =>
    db.order.create({ data: { catalogId, customerName: "PRIVATE_CANARY", customerPhone: "3000000000", total: 1000, status, anonymizedAt } });
  await order(catalogA.id, "PENDING"); await order(catalogA.id, "PENDING", new Date()); await order(catalogA.id, "CONFIRMED"); await order(catalogB.id, "PENDING");
  passed("Fixtures: three accounts, border-time sales, cancelled/draft, returns on other days, big amounts, stock and orders");

  stage = "OWNER_A_7_DAYS";
  const sumA = await summaryAt(a.id, asOf, 7);
  assert.deepEqual(sumA.today, { date: "2026-03-01", salesTotal: (100000n + 3000n - big).toString(), salesCount: 2, yesterdaySalesTotal: "7000" });
  assert.equal(sumA.month.salesTotal, (103000n - big).toString());
  assert.equal(sumA.month.costOfSales, "60009", "60000 + 10 − 1 resellable cost returned");
  assert.equal(sumA.month.salesWithoutCostCount, 1);
  assert.equal(sumA.month.estimatedProfit, (103000n - big - 60009n).toString());
  assert.deepEqual(sumA.month.previousMonth, { salesTotal: (7000n + big - 900n).toString(), expensesTotal: null, estimatedProfit: (7000n + big - 900n - 1n).toString() });
  assert.deepEqual(sumA.salesSeries, [["2026-02-23", "0"], ["2026-02-24", "0"], ["2026-02-25", "0"], ["2026-02-26", "0"], ["2026-02-27", "0"], ["2026-02-28", "7000"], ["2026-03-01", (103000n - big).toString()]].map(([date, total]) => ({ date, total })));
  assert.deepEqual(sumA.attention, { lowStockCount: 2, outOfStockCount: 2, pendingOrdersCount: 1 });
  assert.deepEqual(sumA.recent.map(r => [r.status, r.total, r.at]), [["CONFIRMED", "3000", "2026-03-01T14:00:00.000Z"], ["CANCELLED", "999999", "2026-03-01T13:00:00.000Z"],
    ["DELIVERED", "100000", "2026-03-01T05:00:00.000Z"], ["CONFIRMED", "7000", "2026-03-01T04:59:59.999Z"], ["RETURNED", big.toString(), "2026-02-10T17:00:00.000Z"]]);
  assert.equal(sumA.recent[2]?.customerName, "Cliente A");
  assert.deepEqual(sumA.setup, { hasInventoryItems: true, hasPublishedCatalog: true, hasSales: true });
  assert.deepEqual(sumA.modules, { expenses: false });
  passed("Owner A: 23:59:59.999/00:00 Bogotá borders, cancelled and drafts excluded, return subtracted on its own day, resellable cost back, damaged cost kept, sale without cost counted once, BigInt beyond 2^53, low/out stock, pending non-anonymized orders, recent 5 by confirmation");

  stage = "OWNER_A_30_DAYS";
  const sum30 = await summaryAt(a.id, asOf, 30);
  assert.equal(sum30.salesSeries.length, 30); assert.equal(sum30.salesSeries[0]?.date, "2026-01-31");
  assert.equal(sum30.salesSeries[0]?.total, "2700", "Jan 31 23:00 Bogotá is Feb 1 in UTC but belongs to Jan 31");
  assert.equal(sum30.salesSeries.find(p => p.date === "2026-02-15")?.total, "-900");
  assert.equal(sum30.salesSeries.find(p => p.date === "2026-02-10")?.total, big.toString());
  assert.equal(sum30.month.previousMonth.salesTotal, sumA.month.previousMonth.salesTotal, "the range does not change the months");
  const sum90 = await summaryAt(a.id, asOf, 90);
  assert.equal(sum90.salesSeries.length, 90); assert.equal(sum90.salesSeries.filter(p => p.total !== "0").length, 5);
  passed("30/90 days: series with every day filled, Bogotá day of a UTC-next-day sale, months independent of the range");

  stage = "MONTH_BORDERS";
  const endOfMonth = await summaryAt(a.id, new Date("2026-03-01T04:59:59.999Z"), 7); // Feb 28 23:59:59.999 Bogotá
  assert.equal(endOfMonth.today.date, "2026-02-28");
  assert.equal(endOfMonth.today.salesTotal, "7000"); assert.equal(endOfMonth.month.salesTotal, (7000n + big - 900n).toString(), "February to date");
  assert.equal(endOfMonth.month.previousMonth.salesTotal, "2700", "January (31 days) contains the Jan 31 23:00 sale");
  const leap = await summaryAt(a.id, new Date("2028-03-01T05:00:00.000Z"), 7);
  assert.equal(leap.today.date, "2028-03-01"); assert.equal(leap.salesSeries[0]?.date, "2028-02-24"); assert.equal(leap.month.previousMonth.salesTotal, "0");
  const midMonth = await summaryAt(a.id, new Date("2026-04-30T23:00:00.000Z"), 7); // Apr 30 18:00: 30-day month, March is previous
  assert.equal(midMonth.month.previousMonth.salesTotal, (103000n - big).toString());
  passed("Month borders: 23:59:59.999 of the last day, 28/29/30/31-day months and leap year");

  stage = "ISOLATION";
  const sumB = await summaryAt(b.id, asOf, 7);
  assert.deepEqual(sumB.today, { date: "2026-03-01", salesTotal: "123", salesCount: 1, yesterdaySalesTotal: "0" });
  assert.equal(sumB.month.costOfSales, "100");
  assert.deepEqual(sumB.attention, { lowStockCount: 0, outOfStockCount: 0, pendingOrdersCount: 1 });
  assert.deepEqual(sumB.setup, { hasInventoryItems: true, hasPublishedCatalog: false, hasSales: true }, "inactive catalog is not published");
  assert.equal(sumB.recent.length, 1);
  const sumC = await summaryAt(c.id, asOf, 7);
  assert.deepEqual({ today: sumC.today, month: sumC.month, attention: sumC.attention, recent: sumC.recent, setup: sumC.setup },
    { today: { date: "2026-03-01", salesTotal: "0", salesCount: 0, yesterdaySalesTotal: "0" },
      month: { salesTotal: "0", costOfSales: "0", salesWithoutCostCount: 0, expensesTotal: null, estimatedProfit: "0", previousMonth: { salesTotal: "0", expensesTotal: null, estimatedProfit: "0" } },
      attention: { lowStockCount: 0, outOfStockCount: 0, pendingOrdersCount: 0 }, recent: [], setup: { hasInventoryItems: false, hasPublishedCatalog: false, hasSales: false } });
  assert.ok(sumC.salesSeries.every(p => p.total === "0"));
  passed("Two accounts isolated (B never sees A and vice versa); new account all zeros with setup false");

  stage = "EXPENSES_PROVIDER";
  // Real F1a rows (migration 20261125000000_operating_expenses, with its CHECKs and triggers).
  const category = (ownerId: string) => db.expenseCategory.create({ data: { ownerId, name: "Servicios", normalizedKey: "servicios" }, select: { id: true } });
  const [categoryA, categoryB] = [await category(a.id), await category(b.id)];
  const spend = (ownerId: string, categoryId: string, amount: bigint, day: string, voided = false) => db.expense.create({ data: {
    ownerId, categoryId, amount, expenseDate: new Date(`${day}T00:00:00.000Z`), paymentMethod: "CASH", description: "Gasto de prueba", categoryNameSnapshot: "Servicios",
    confirmedAt: new Date("2026-03-01T15:00:00.000Z"), ...(voided ? { status: "VOIDED" as const, voidedAt: new Date("2026-03-01T15:30:00.000Z"), voidReason: "Registrado dos veces" } : {}) } });
  await spend(a.id, categoryA.id, 500n, "2026-03-01");
  await spend(a.id, categoryA.id, 999n, "2026-03-01", true);
  await spend(a.id, categoryA.id, 200n, "2026-02-28");
  await spend(a.id, categoryA.id, 50n, "2026-01-31");
  await spend(b.id, categoryB.id, 777n, "2026-03-01");
  const withExpenses = await summaryAt(a.id, asOf, 7, true);
  assert.equal(withExpenses.month.expensesTotal, "500", "the voided 999 is excluded"); assert.equal(withExpenses.month.previousMonth.expensesTotal, "200");
  assert.equal(withExpenses.month.estimatedProfit, (103000n - big - 60009n - 500n).toString());
  assert.equal(withExpenses.month.previousMonth.estimatedProfit, (7000n + big - 900n - 1n - 200n).toString());
  assert.equal(withExpenses.modules.expenses, true);
  const februaryEnd = await summaryAt(a.id, new Date("2026-03-01T04:59:59.999Z"), 7, true); // Feb 28 23:59:59.999 in Bogotá
  assert.equal(februaryEnd.month.expensesTotal, "200", "February to date"); assert.equal(februaryEnd.month.previousMonth.expensesTotal, "50", "January (31 days)");
  assert.equal((await summaryAt(b.id, asOf, 7, true)).month.expensesTotal, "777", "B only sees its own expenses");
  assert.equal((await summaryAt(c.id, asOf, 7, true)).month.expensesTotal, "0");
  passed("Expenses module on real F1a rows: only CONFIRMED (voided excluded) of the owner by expenseDate, Bogotá month borders, profit subtracts them, isolated per owner, zero for an account without expenses");

  stage = "RUNTIME_PATH";
  const bogotaToday = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date());
  await spend(a.id, categoryA.id, 321n, bogotaToday);
  const live = await readDashboardSummary(a.id, 30, { database: db });
  assert.equal(live.salesSeries.length, 30); assert.equal(live.modules.expenses, true);
  assert.equal(live.month.expensesTotal, "321", "runtime path (database clock) reads today's real F1a expense");
  passed("readDashboardSummary runs read-only in RepeatableRead against the real schema");

  stage = "EXPLAIN";
  await db.$executeRawUnsafe(`
    INSERT INTO "Sale" (id, "userId", status, total, subtotal, "discountTotal", "confirmedAt", "createdAt", "updatedAt")
    SELECT gen_random_uuid()::text, CASE WHEN g % 10 = 0 THEN '${a.id}' ELSE '${b.id}' END, 'DELIVERED', 1000, 1000, 0,
      timestamp '2026-03-01 05:00' - (g % 365) * interval '1 day', now(), now() FROM generate_series(1, 200000) g`);
  for (const table of ["Sale", "SaleLine", "SaleReturn", "SaleReturnLine", "inventory_items", "orders", "catalogs"]) await db.$executeRawUnsafe(`ANALYZE "${table}"`);
  const sql = dashboardSummarySql(a.id, asOf, 90);
  const plan = await db.$queryRawUnsafe<{ "QUERY PLAN": string }[]>(`EXPLAIN (ANALYZE, BUFFERS) ${sql.text}`, ...sql.values);
  const text = plan.map(row => row["QUERY PLAN"]).join("\n");
  observations.executionMs = Number(text.match(/Execution Time: ([\d.]+) ms/)?.[1]);
  observations.saleScans = [...new Set(text.match(/(Seq Scan|Index Scan|Bitmap Heap Scan|Index Only Scan)[^\n]* on "Sale"/g) ?? [])];
  const lines = text.split("\n");
  observations.saleSeqScans = lines.flatMap((line, i) => /Seq Scan on "Sale"/.test(line) ? [lines.slice(Math.max(0, i - 3), i + 3).map(l => l.trim()).join(" | ")] : []);
  const empty = dashboardSummarySql(c.id, asOf, 90);
  const emptyPlan = (await db.$queryRawUnsafe<{ "QUERY PLAN": string }[]>(`EXPLAIN (ANALYZE, BUFFERS) ${empty.text}`, ...empty.values)).map(row => row["QUERY PLAN"]).join("\n");
  observations.emptyAccountExecutionMs = Number(emptyPlan.match(/Execution Time: ([\d.]+) ms/)?.[1]);
  observations.emptyAccountSeqScansOnSale = (emptyPlan.match(/Seq Scan on "Sale"/g) ?? []).length;
  assert.equal(observations.emptyAccountSeqScansOnSale, 0, "an account without sales must not scan the whole sales table");
  passed(`EXPLAIN with 200,000 sales: owner with 20,000 sales ${observations.executionMs} ms; account without sales ${observations.emptyAccountExecutionMs} ms, no sequential scan on "Sale"`);
}

main().then(() => { console.log(JSON.stringify({ success: true, checks: results, observations, productionAccess: false }, null, 2)); })
  .catch(error => { process.exitCode = 1; console.log(JSON.stringify({ success: false, stage, error: error instanceof Error ? error.message.slice(0, 600) : "UNKNOWN", checks: results }, null, 2)); })
  .finally(async () => {
    try { if (database && schemaCreated) await database.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`); } catch { /* reported by the run */ }
    await database?.$disconnect();
    if (folder) await rm(folder, { recursive: true, force: true });
  });
