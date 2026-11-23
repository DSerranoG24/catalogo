import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import express from "express";
import jwt from "jsonwebtoken";
import { Prisma, SaleStatus, type User } from "@prisma/client";
import { prisma } from "../config/prisma";
import { makeCustomerSalesRepository } from "./customer-sales.repository";
import { makeCustomerSalesService } from "../services/customer-sales.service";
import { makeCustomerSalesController } from "../controllers/customer-sales.controller";
import { customerSalesQuerySchema } from "../schemas/customer-sales.schema";
import { makeSaleService } from "../services/sale.service";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const owner = id(1), otherOwner = id(2), customerId = id(3), otherCustomer = id(4);
function fixture() {
  let reads = 0;
  const customers = [
    { id: customerId, ownerId: owner, fullName: "Nombre actual", archivedAt: null as Date | null },
    { id: otherCustomer, ownerId: otherOwner, fullName: "Ajeno", archivedAt: null },
  ];
  const sales = Array.from({ length: 55 }, (_, index) => ({
    id: id(100 + index), userId: owner, customerId, status: Object.values(SaleStatus)[index % 5],
    version: 2, currency: "COP", total: 9007199254740993n, createdAt: new Date(index < 30 ? 2000 : 1000),
    sourceOrderId: index % 2 ? id(900) : null, customerNameSnapshot: "Comprador original" as string | null, customerName: "Antiguo" as string | null,
  }));
  sales.push({ ...sales[0], id: id(999), userId: otherOwner, customerId: otherCustomer });
  sales.push({ ...sales[0], id: id(998), customerId: id(8) });
  // A historical unlinked sale must not be inferred from the buyer's name.
  const unlinked = { ...sales[0], id: id(997), customerId: null };
  const rows = [...sales, unlinked];
  let failure = false;
  const matches = (row: typeof rows[number], where: Prisma.SaleWhereInput) => {
    assert.equal(typeof where.userId, "string"); assert.equal(typeof where.customerId, "string");
    return row.userId === where.userId && row.customerId === where.customerId
      && (!where.status || row.status === where.status) && (!where.id || row.id === where.id);
  };
  const db = new Proxy(prisma, { get(_target, key) {
    if (key === "$transaction") return async (fn: (tx: Prisma.TransactionClient) => Promise<unknown>) => fn(db);
    if (key === "customer") return { findFirst: async (args: Prisma.CustomerFindFirstArgs) => {
      reads++; assert.ok(args.where?.ownerId); assert.deepEqual(args.select, { id: true, fullName: true, archivedAt: true });
      const row = customers.find(c => c.id === args.where?.id && c.ownerId === args.where.ownerId);
      return row ? { id: row.id, fullName: row.fullName, archivedAt: row.archivedAt } : null;
    } };
    if (key === "sale") return {
      findFirst: async (args: Prisma.SaleFindFirstArgs) => { reads++; return rows.find(s => matches(s, args.where ?? {})) ?? null; },
      findMany: async (args: Prisma.SaleFindManyArgs) => {
        reads++; if (failure) throw new Error("sensitive database internals");
        assert.equal(args.take, 26); assert.equal(args.include, undefined);
        assert.deepEqual(args.orderBy, [{ createdAt: "desc" }, { id: "desc" }]);
        assert.deepEqual(Object.keys(args.select ?? {}).sort(), ["id", "status", "version", "currency", "total", "createdAt", "sourceOrderId", "customerNameSnapshot", "customerName"].sort());
        const clauses = args.where?.OR;
        const dateBound = clauses?.[0]?.createdAt;
        const tieId = clauses?.[1]?.id;
        const date = dateBound && typeof dateBound === "object" && "lt" in dateBound ? dateBound.lt : undefined;
        const tie = tieId && typeof tieId === "object" ? tieId.lt : undefined;
        return rows.filter(s => matches(s, args.where ?? {}))
          .filter(s => !(date instanceof Date) || s.createdAt < date || (s.createdAt.getTime() === date.getTime() && typeof tie === "string" && s.id < tie))
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id))
          .slice(0, args.take ?? 0).map(({ id, status, version, currency, total, createdAt, sourceOrderId, customerNameSnapshot, customerName }) => ({ id, status, version, currency, total, createdAt, sourceOrderId, customerNameSnapshot, customerName }));
      },
    };
    throw new Error(`Unexpected database operation: ${String(key)}`);
  } });
  const repository = makeCustomerSalesRepository(db);
  return { customers, rows, repository, service: makeCustomerSalesService(repository), reads: () => reads, fail: () => { failure = true; } };
}

test("repository: stable pagination, fixed queries, bigint snapshots and no inferred links or writes", async () => {
  const f = fixture(); const before = structuredClone(f.rows);
  const seen: string[] = []; let cursor: string | undefined;
  do {
    const start = f.reads(); const page = await f.service.list(owner, customerId, { status: "all", cursor });
    assert.ok(f.reads() - start <= 3);
    for (const s of page.sales) {
      assert.equal(s.total, "9007199254740993"); assert.equal(s.customerNameSnapshot, "Comprador original"); seen.push(s.id);
    }
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  assert.equal(seen.length, 55); assert.equal(new Set(seen).size, 55);
  assert.deepEqual(f.rows, before);
});
test("repository: archived customer, every status including cancellations and returns, and current name does not replace snapshot", async () => {
  const f = fixture(); f.customers[0].archivedAt = new Date(); f.customers[0].fullName = "Nombre editado";
  for (const status of Object.values(SaleStatus)) {
    const result = await f.service.list(owner, customerId, { status });
    assert.equal(result.sales.length, 11); assert.equal(result.customer.fullName, "Nombre editado");
    assert.ok(result.sales.every(s => s.status === status && s.customerNameSnapshot === "Comprador original"));
  }
});
test("repository/service: nonexistent/foreign customer and cursor outside owner/customer/status are indistinguishable", async () => {
  const f = fixture();
  for (const [who, customer, cursor, status] of [
    [owner, otherCustomer, undefined, "all"], [owner, id(88), undefined, "all"], [otherOwner, customerId, undefined, "all"],
    [owner, customerId, id(999), "all"], [owner, customerId, id(998), "all"], [owner, customerId, id(89), "all"],
    [owner, customerId, id(100), "DELIVERED"],
  ] as const) await assert.rejects(f.service.list(who, customer, { cursor, status }), /^Error: CUSTOMER_SALES_NOT_FOUND$/);
});
test("repository: no sales, exhausted cursor and missing historical buyer remain valid", async () => {
  const f = fixture();
  f.rows.splice(0); assert.deepEqual((await f.service.list(owner, customerId, { status: "all" })).sales, []);
  const g = fixture(); const final = g.rows.filter(s => s.customerId === customerId).sort((a,b) => a.createdAt.getTime()-b.createdAt.getTime() || a.id.localeCompare(b.id))[0];
  g.rows[0].customerNameSnapshot = null; g.rows[0].customerName = null;
  const missingBuyer = await g.service.list(owner, customerId, { status: "DRAFT" });
  assert.equal(missingBuyer.sales.find(s => s.id === g.rows[0].id)?.customerNameSnapshot, null);
  assert.equal(missingBuyer.sales.find(s => s.id === g.rows[0].id)?.customerName, null);
  assert.deepEqual((await g.service.list(owner, customerId, { status: "all", cursor: final.id })).sales, []);
});
test("service: validation rejects malformed ids, repeated/unknown params and repository failures propagate", async () => {
  const f = fixture();
  for (const query of [{ status: "PAID" }, { cursor: "bad" }, { status: ["all", "DRAFT"] }, { ownerId: owner }, { page: "2" }]) assert.equal(customerSalesQuerySchema.safeParse(query).success, false);
  await assert.rejects(f.service.list(owner, "bad", { status: "all" }));
  f.fail(); await assert.rejects(f.service.list(owner, customerId, { status: "all" }), /sensitive database internals/);
});

test("existing sale detail reads stored lines and snapshots without consulting current inventory or recalculating", async () => {
  const line = { id: id(700), itemName: "Producto histórico", sku: "OLD", quantity: 3, unitPrice: 101n, unitDiscount: 2n, lineTotal: 297n };
  const stored = { id: id(100), userId: owner, customerId, status: "RETURNED", total: 297n, lines: [line],
    customerNameSnapshot: "Comprador histórico", customerPhoneSnapshot: null, customerEmailSnapshot: null,
    customer: { id: customerId, fullName: "Nombre actual cambiado", archivedAt: new Date() } };
  const db = new Proxy(prisma, { get(_target, key) {
    if (key === "$transaction") return async (fn: (tx: Prisma.TransactionClient) => Promise<unknown>) => fn(db);
    if (key === "$queryRaw") return async () => [{ id: owner }];
    if (key === "sale") return { findFirst: async (args: Prisma.SaleFindFirstArgs) => {
      assert.equal(typeof args.where?.userId, "string");
      assert.equal(args.include?.lines, true);
      return args.where?.userId === owner && args.where.id === stored.id ? structuredClone(stored) : null;
    } };
    throw new Error(`Unexpected mutation or current product lookup: ${String(key)}`);
  } });
  const service = makeSaleService(db);
  const result = await service.get(owner, stored.id);
  assert.deepEqual(result.lines, [line]); assert.equal(result.total, 297n);
  assert.equal(result.customerNameSnapshot, "Comprador histórico"); assert.equal(result.status, "RETURNED");
  await assert.rejects(service.get(otherOwner, stored.id), /NOT_FOUND/);
  await assert.rejects(service.get(owner, id(999)), /NOT_FOUND/);
});

test("HTTP: real authentication, ownership, safe errors, strict queries and private no-store", async () => {
  process.env.JWT_SECRET = "synthetic-customer-history-test-secret-at-least-32";
  const { makeAuthenticate } = await import("../middlewares/auth.middleware.js");
  const { generateToken } = await import("../utils/jwt.js");
  const { makeCustomerRouter } = await import("../routes/customer.routes.js");
  const user: User = { id: owner, email: "fixture@example.invalid", passwordHash: null, googleId: null, emailVerifiedAt: null, sessionVersion: 0, closedAt: null, role: "USER", name: null, createdAt: new Date(0), updatedAt: new Date(0) };
  const f = fixture(); const app = express();
  app.use("/api/customers", makeCustomerRouter(undefined, makeAuthenticate(async userId => userId === owner ? user : null), makeCustomerSalesController(f.service)));
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const token = generateToken({ userId: owner, email: user.email });
  const get = (path: string, auth: string | null = token) => fetch(`http://127.0.0.1:${address.port}/api/customers/${path}`, { headers: auth ? { Authorization: `Bearer ${auth}` } : {} });
  try {
    assert.equal((await get(`${customerId}/sales`, null)).status, 401);
    assert.equal((await get(`${customerId}/sales`, "invalid")).status, 401);
    assert.equal((await get(`${customerId}/sales`, jwt.sign({ userId: owner, email: user.email, sessionVersion: 1 }, process.env.JWT_SECRET))).status, 401);
    const ok = await get(`${customerId}/sales`); assert.equal(ok.status, 200); assert.equal(ok.headers.get("cache-control"), "private, no-store");
    assert.equal((await ok.json()).sales[0].total, "9007199254740993");
    const foreign = await get(`${otherCustomer}/sales`), missing = await get(`${id(88)}/sales`);
    assert.equal(foreign.status, 404); assert.deepEqual(await foreign.json(), await missing.json());
    for (const query of ["?status=PAID", "?cursor=bad", "?status=all&status=DRAFT", "?ownerId=x"]) {
      const bad = await get(`${customerId}/sales${query}`); assert.equal(bad.status, 400); assert.equal((await bad.json()).error, "INVALID_CUSTOMER_SALES_QUERY");
    }
    f.fail(); const failed = await get(`${customerId}/sales`); assert.equal(failed.status, 500); assert.doesNotMatch(await failed.text(), /sensitive/);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
