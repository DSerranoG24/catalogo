import assert from "node:assert/strict";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import test from "node:test";
import express from "express";
import { Prisma, type Customer, type Order, type OrderCustomerOperation, type Sale } from "@prisma/client";
import { prisma } from "../config/prisma";
import { makeOrderCustomerRepository, OrderCustomerConflict } from "./order-customer.repository";
import { makeOrderCustomerService } from "../services/order-customer.service";
import { makeOrderCustomerController } from "../controllers/order-customer.controller";
import { confirmOrderCustomerSchema } from "../schemas/order-customer.schema";
import type { AuthenticatedRequest } from "../types/auth.types";

const owner = randomUUID(), other = randomUUID();
const fields = { fullName: "Comprador", phone: "3000000000", email: "buyer@example.invalid", address: "Dirección de prueba", notes: "Nota del pedido" };
function customer(ownerId = owner, phone = fields.phone): Customer {
  return { id: randomUUID(), ownerId, fullName: "Ficha existente", phone, email: null, address: null, notes: null, archivedAt: null, createdAt: new Date(0), updatedAt: new Date(0) };
}
type Source = Pick<Order, "id" | "customerId" | "status" | "anonymizedAt" | "customerName" | "customerPhone" | "customerEmail" | "customerAddress" | "notes"> & { ownerId: string };
type LinkedSale = Pick<Sale, "id" | "sourceOrderId" | "userId" | "customerId" | "customerNameSnapshot" | "customerPhoneSnapshot" | "customerEmailSnapshot" | "status" | "version" | "total">;
function fixture() {
  let orders: Source[] = [{ id: randomUUID(), ownerId: owner, customerId: null, status: "PENDING", anonymizedAt: null, customerName: fields.fullName, customerPhone: fields.phone, customerEmail: fields.email, customerAddress: fields.address, notes: fields.notes }];
  let customers: Customer[] = [], operations: OrderCustomerOperation[] = [], sales: LinkedSale[] = [];
  const queries: string[] = [];
  let writes = 0, failLedger = false, failSale = false;
  let tail = Promise.resolve();
  function owned(where: Prisma.OrderWhereInput | undefined) {
    assert.ok(where?.catalog && typeof where.catalog === "object" && "userId" in where.catalog);
    return orders.find(order => order.id === where.id && order.ownerId === where.catalog?.userId);
  }
  const db = new Proxy(prisma, { get(_target, key) {
    if (key === "$transaction") return async (fn: (tx: Prisma.TransactionClient) => Promise<unknown>) => {
      const predecessor = tail; let release: () => void = () => {};
      tail = new Promise<void>(resolve => { release = resolve; }); await predecessor;
      const before = structuredClone({ orders, customers, operations, sales, writes });
      try { return await fn(db); } catch (error) { orders = before.orders; customers = before.customers; operations = before.operations; sales = before.sales; writes = before.writes; throw error; }
      finally { release(); }
    };
    if (key === "$queryRaw") return async (sql: TemplateStringsArray, ...values: unknown[]) => {
      const query = sql.join("?"); queries.push(query);
      if (query.includes("FROM orders")) { assert.match(query, /FOR UPDATE OF o/); return orders.filter(order => order.id === values[0] && order.ownerId === values[1]).map(order => ({ id: order.id })); }
      if (query.includes("FROM users")) return [{ id: values[0] }];
      if (query.includes("FROM customers")) { assert.match(query, /ownerId.*FOR SHARE/); return []; }
      if (query.includes('FROM "Sale"')) { assert.match(query, /sourceOrderId.*userId.*FOR UPDATE/); return []; }
      throw new Error("Unexpected query");
    };
    if (key === "$executeRaw") return async (sql: TemplateStringsArray) => { queries.push(sql.join("?")); return 1; };
    if (key === "order") return {
      findFirst: async (args: Prisma.OrderFindFirstArgs) => structuredClone(owned(args.where) ?? null),
      update: async (args: Prisma.OrderUpdateArgs) => {
        const order = owned(args.where); assert.ok(order);
        assert.deepEqual(Object.keys(args.data), ["customerId"]);
        assert.equal(typeof args.data.customerId, "string");
        if (typeof args.data.customerId === "string") order.customerId = args.data.customerId;
        writes++; return structuredClone(order);
      },
    };
    if (key === "customer") return {
      findMany: async (args: Prisma.CustomerFindManyArgs) => {
        assert.equal(typeof args.where?.ownerId, "string"); assert.equal(args.where?.archivedAt, null); assert.equal(args.take, 26);
        return customers.filter(row => row.ownerId === args.where?.ownerId && row.phone === args.where.phone && !row.archivedAt).slice(args.skip ?? 0, (args.skip ?? 0) + 26)
          .map(({ id, fullName, phone, email }) => ({ id, fullName, phone, email }));
      },
      findFirst: async (args: Prisma.CustomerFindFirstArgs) => {
        assert.equal(typeof args.where?.ownerId, "string");
        return structuredClone(customers.find(row => row.id === args.where?.id && row.ownerId === args.where.ownerId) ?? null);
      },
      findFirstOrThrow: async (args: Prisma.CustomerFindFirstOrThrowArgs) => {
        assert.equal(typeof args.where?.ownerId, "string");
        const row = customers.find(row => row.id === args.where?.id && row.ownerId === args.where.ownerId); assert.ok(row); return structuredClone(row);
      },
      create: async (args: Prisma.CustomerCreateArgs) => {
        const data = args.data; assert.ok(data.ownerId);
        const row: Customer = { id: randomUUID(), ownerId: data.ownerId, fullName: data.fullName, phone: data.phone, email: data.email ?? null, address: data.address ?? null, notes: data.notes ?? null, archivedAt: null, createdAt: new Date(), updatedAt: new Date() };
        customers.push(row); writes++; return structuredClone(row);
      },
    };
    if (key === "sale") return {
      findFirst: async (args: Prisma.SaleFindFirstArgs) => { assert.equal(typeof args.where?.userId, "string"); return structuredClone(sales.find(row => row.sourceOrderId === args.where?.sourceOrderId && row.userId === args.where.userId) ?? null); },
      update: async (args: Prisma.SaleUpdateArgs) => {
        if (failSale) throw new Error("TEST_SALE_FAILURE");
        const row = sales.find(row => row.id === args.where.id && row.userId === args.where.userId); assert.ok(row);
        assert.deepEqual(Object.keys(args.data).sort(), ["customerId", "version"]);
        if (typeof args.data.customerId === "string") row.customerId = args.data.customerId;
        row.version++; writes++; return structuredClone(row);
      },
    };
    if (key === "orderCustomerOperation") return {
      findUnique: async (args: Prisma.OrderCustomerOperationFindUniqueArgs) => {
        assert.ok(args.where.ownerId_operationId);
        return structuredClone(operations.find(op => op.ownerId === args.where.ownerId_operationId?.ownerId && op.operationId === args.where.ownerId_operationId.operationId) ?? null);
      },
      create: async (args: Prisma.OrderCustomerOperationCreateArgs) => {
        if (failLedger) throw new Error("TEST_LEDGER_FAILURE");
        const data = args.data; assert.ok(data.ownerId && data.orderId && data.customerId);
        assert.ok(!operations.some(op => op.ownerId === data.ownerId && op.operationId === data.operationId));
        const op: OrderCustomerOperation = { ownerId: data.ownerId, operationId: data.operationId, orderId: data.orderId, customerId: data.customerId, associatedSaleId: data.associatedSaleId ?? null, requestHash: data.requestHash, createdAt: new Date() };
        operations.push(op); writes++; return structuredClone(op);
      },
    };
    throw new Error(`Unexpected database delegate ${String(key)}`);
  } });
  const repository = makeOrderCustomerRepository(db), service = makeOrderCustomerService(repository);
  return { service, db, queries, get orders() { return orders; }, get customers() { return customers; }, get sales() { return sales; }, get operations() { return operations; }, get writes() { return writes; },
    failLedger() { failLedger = true; }, failSale() { failSale = true; },
    addSale(status: LinkedSale["status"] = "CONFIRMED") {
      const row: LinkedSale = { id: randomUUID(), sourceOrderId: orders[0].id, userId: owner, customerId: null, customerNameSnapshot: "Comprador histórico", customerPhoneSnapshot: "+57 300 0000000", customerEmailSnapshot: "historic@example.invalid", status, version: 1, total: 4000n };
      sales.push(row); return row;
    },
  };
}
const create = (associateSale = false) => ({ operationId: randomUUID(), action: "CREATE", customer: fields, associateSale });
const select = (row: Customer, associateSale = false) => ({ operationId: randomUUID(), action: "USE_EXISTING", customerId: row.id, phone: row.phone, associateSale });

test("preview obtains only order buyer data and never writes or creates", async () => {
  const f = fixture(); f.addSale(); const before = structuredClone(f.orders[0]);
  const preview = await f.service.preview(owner, before.id);
  assert.deepEqual(preview.fields, fields); assert.deepEqual(preview.invalidFields, []); assert.ok(preview.sale);
  assert.equal(f.writes, 0); assert.equal(f.customers.length, 0); assert.equal(f.operations.length, 0); assert.deepEqual(f.orders[0], before);
});

test("create confirms edited values with customer normalization and authenticated owner only", async () => {
  const f = fixture(); const before = structuredClone(f.orders[0]);
  const result = await f.service.confirm(owner, before.id, { ...create(), customer: { fullName: "  Ana   María  ", phone: "+57 (300) 000-0000", email: "", address: " Dirección ", notes: "  Nota revisada  " } });
  assert.equal(result.customer.ownerId, owner); assert.equal(result.customer.fullName, "Ana María"); assert.equal(result.customer.phone, "573000000000");
  assert.equal(result.customer.email, null); assert.equal(result.customer.address, "Dirección"); assert.equal(result.customer.notes, "Nota revisada");
  assert.equal(f.orders[0].customerId, result.customer.id); assert.deepEqual({ ...f.orders[0], customerId: null }, before);
  assert.equal(result.associatedSaleId, null); assert.equal(result.idempotent, false);
});

test("active phone matches stop creation; selecting one is a separate explicit command", async () => {
  const f = fixture(); const existing = customer(); f.customers.push(existing); f.customers.push(customer(other));
  await assert.rejects(f.service.confirm(owner, f.orders[0].id, create()), (error: unknown) => error instanceof OrderCustomerConflict && error.code === "CUSTOMER_PHONE_MATCH" && error.matches.length === 1 && error.matches[0].id === existing.id);
  assert.equal(f.customers.length, 2); assert.equal(f.operations.length, 0); assert.equal(f.orders[0].customerId, null);
  const result = await f.service.confirm(owner, f.orders[0].id, select(existing));
  assert.equal(result.customer.id, existing.id); assert.equal(f.customers.length, 2); assert.equal(f.orders[0].customerId, existing.id);
});

test("existing client selection rejects foreign, missing, archived and changed-phone records", async () => {
  const f = fixture(); const row = customer(); f.customers.push(row);
  for (const command of [{ ...select(row), customerId: randomUUID() }, { ...select(row), phone: "3110000000" }]) await assert.rejects(f.service.confirm(owner, f.orders[0].id, command));
  f.customers[0].ownerId = other; await assert.rejects(f.service.confirm(owner, f.orders[0].id, select(row)), /CUSTOMER_NOT_FOUND/);
  f.customers[0].ownerId = owner; f.customers[0].archivedAt = new Date(); await assert.rejects(f.service.confirm(owner, f.orders[0].id, select(row)), /CUSTOMER_ARCHIVED/);
  assert.equal(f.operations.length, 0); assert.equal(f.orders[0].customerId, null);
});

test("cancelled, anonymized, foreign and missing orders deny previews and confirmations", async () => {
  for (const mode of ["cancelled", "anonymized", "foreign", "missing"]) {
    const f = fixture(); const id = mode === "missing" ? randomUUID() : f.orders[0].id;
    if (mode === "cancelled") f.orders[0].status = "CANCELLED";
    if (mode === "anonymized") f.orders[0].anonymizedAt = new Date();
    const who = mode === "foreign" ? other : owner;
    await assert.rejects(f.service.preview(who, id)); await assert.rejects(f.service.confirm(who, id, create()));
    assert.equal(f.writes, 0); assert.equal(f.customers.length, 0);
  }
});

test("orders missing required customer fields can be previewed and must be corrected before confirmation", async () => {
  const f = fixture(); f.orders[0].customerName = ""; f.orders[0].customerPhone = ""; f.orders[0].customerEmail = null; f.orders[0].customerAddress = null; f.orders[0].notes = null;
  const preview = await f.service.preview(owner, f.orders[0].id); assert.ok(preview.invalidFields.includes("fullName")); assert.ok(preview.invalidFields.includes("phone"));
  await assert.rejects(f.service.confirm(owner, f.orders[0].id, { ...create(), customer: preview.fields })); assert.equal(f.writes, 0);
  const result = await f.service.confirm(owner, f.orders[0].id, create()); assert.equal(result.customer.fullName, fields.fullName);
});

test("sale association is explicit in every state and preserves historical snapshots, amounts and state", async () => {
  for (const status of ["DRAFT", "CONFIRMED", "DELIVERED", "CANCELLED", "RETURNED"] as const) {
    const f = fixture(); const original = structuredClone(f.addSale(status));
    const result = await f.service.confirm(owner, f.orders[0].id, create(true));
    assert.equal(result.associatedSaleId, original.id); assert.equal(f.sales[0].customerId, result.customer.id);
    assert.deepEqual({ ...f.sales[0], customerId: null, version: 1 }, original);
  }
  const f = fixture(); const before = structuredClone(f.addSale()); await f.service.confirm(owner, f.orders[0].id, create(false)); assert.deepEqual(f.sales[0], before);
});

test("later explicit association uses the already saved customer without creating another", async () => {
  const f = fixture(); const first = await f.service.confirm(owner, f.orders[0].id, create()); f.addSale();
  const second = await f.service.confirm(owner, f.orders[0].id, select(first.customer, true));
  assert.equal(second.customer.id, first.customer.id); assert.equal(f.customers.length, 1); assert.equal(f.sales[0].customerId, first.customer.id);
  await assert.rejects(f.service.confirm(owner, f.orders[0].id, create()), /ORDER_CUSTOMER_ALREADY_SAVED/);
});

test("association conflicts and missing sales roll back customer creation and order association", async () => {
  for (const mode of ["missing", "conflict", "writeFailure", "ledgerFailure"]) {
    const f = fixture();
    if (mode !== "missing") f.addSale();
    if (mode === "conflict") f.sales[0].customerId = randomUUID();
    if (mode === "writeFailure") f.failSale(); if (mode === "ledgerFailure") f.failLedger();
    const before = structuredClone(f.sales);
    await assert.rejects(f.service.confirm(owner, f.orders[0].id, create(true)));
    assert.equal(f.customers.length, 0); assert.equal(f.orders[0].customerId, null); assert.equal(f.operations.length, 0); assert.deepEqual(f.sales, before);
  }
});

test("same confirmation returns existing result; changed payload or another order conflicts", async () => {
  const f = fixture(); f.addSale(); const command = create(true);
  const first = await f.service.confirm(owner, f.orders[0].id, command);
  const savedVersion = f.sales[0].version; f.customers[0].archivedAt = new Date();
  const retry = await f.service.confirm(owner, f.orders[0].id, command);
  assert.equal(retry.idempotent, true); assert.equal(retry.customer.id, first.customer.id); assert.equal(retry.associatedSaleId, first.associatedSaleId);
  assert.equal(f.customers.length, 1); assert.equal(f.sales[0].version, savedVersion);
  await assert.rejects(f.service.confirm(owner, f.orders[0].id, { ...command, associateSale: false }), /IDEMPOTENCY_CONFLICT/);
  f.orders.push({ ...f.orders[0], id: randomUUID(), customerId: null });
  await assert.rejects(f.service.confirm(owner, f.orders[1].id, command), /IDEMPOTENCY_CONFLICT/);
});

test("serialized concurrent retries and different orders with the same phone do not duplicate in this workflow", async () => {
  const f = fixture(); const command = create();
  const [a, b] = await Promise.all([f.service.confirm(owner, f.orders[0].id, command), f.service.confirm(owner, f.orders[0].id, command)]);
  assert.equal(a.customer.id, b.customer.id); assert.equal(f.customers.length, 1); assert.equal(f.operations.length, 1);
  const g = fixture(); g.orders.push({ ...g.orders[0], id: randomUUID() });
  const result = await Promise.allSettled(g.orders.map(order => g.service.confirm(owner, order.id, create())));
  assert.equal(result.filter(row => row.status === "fulfilled").length, 1); assert.equal(g.customers.length, 1);
  assert.ok(g.queries.some(query => query.includes("pg_advisory_xact_lock")));
});

test("archived duplicates and other owners do not block creation; matches are bounded", async () => {
  const f = fixture(); const archived = customer(); archived.archivedAt = new Date(); f.customers.push(archived, customer(other));
  await f.service.confirm(owner, f.orders[0].id, create()); assert.equal(f.customers.length, 3);
  const g = fixture(); for (let i = 0; i < 30; i++) g.customers.push(customer());
  const preview = await g.service.preview(owner, g.orders[0].id); assert.equal(preview.matches.length, 25); assert.equal(preview.hasMore, true);
  const page = await g.service.matchingPage(owner, g.orders[0].id, { phone: fields.phone, page: "2" });
  assert.equal(page.matches.length, 5); assert.equal(page.hasMore, false); assert.equal(page.page, 2);
  await assert.rejects(g.service.matchingPage(other, g.orders[0].id, { phone: fields.phone }), /ORDER_NOT_FOUND/);
  await assert.rejects(g.service.matchingPage(owner, g.orders[0].id, { phone: fields.phone, page: "0" }));
});

test("strict commands reject arbitrary IDs, ownership, snapshots and invalid customer data", () => {
  for (const value of [
    { ...create(), ownerId: other }, { ...create(), customerId: randomUUID() }, { ...create(), saleId: randomUUID() },
    { ...create(), customer: { ...fields, id: randomUUID() } }, { ...create(), customer: { ...fields, ownerId: other } },
    { ...create(), customer: { ...fields, customerNameSnapshot: "fake" } }, { ...create(), customer: { ...fields, email: "bad" } },
    { ...create(), customer: { ...fields, phone: "" } }, { ...select(customer()), snapshot: "fake" },
  ]) assert.equal(confirmOrderCustomerSchema.safeParse(value).success, false);
});

test("different operation keys racing on one order still produce only one customer and association", async () => {
  const f = fixture(); f.addSale();
  const results = await Promise.allSettled([f.service.confirm(owner, f.orders[0].id, create(true)), f.service.confirm(owner, f.orders[0].id, create(true))]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(f.customers.length, 1); assert.equal(f.operations.length, 1); assert.equal(f.sales[0].version, 2);
});

test("equivalent normalized retries recover the original result and phone conflicts do not consume a key", async () => {
  const f = fixture(); const command = create();
  const first = await f.service.confirm(owner, f.orders[0].id, command);
  const retry = await f.service.confirm(owner, f.orders[0].id, { ...command, customer: { ...fields, fullName: "  Comprador  ", phone: "(300) 000-0000" } });
  assert.equal(retry.customer.id, first.customer.id); assert.equal(retry.idempotent, true); assert.equal(f.customers.length, 1);
  const g = fixture(); g.customers.push(customer()); const rejected = create();
  await assert.rejects(g.service.confirm(owner, g.orders[0].id, rejected), /CUSTOMER_PHONE_MATCH/);
  assert.equal(g.operations.length, 0);
  const selected = await g.service.confirm(owner, g.orders[0].id, { ...select(g.customers[0]), operationId: rejected.operationId });
  assert.equal(selected.customer.id, g.customers[0].id); assert.equal(g.customers.length, 1); assert.equal(g.operations.length, 1);
});

test("matching pages reject terminal/private resources and malformed queries without writing", async () => {
  for (const state of ["cancelled", "anonymized"]) {
    const f = fixture(); if (state === "cancelled") f.orders[0].status = "CANCELLED"; else f.orders[0].anonymizedAt = new Date();
    await assert.rejects(f.service.matchingPage(owner, f.orders[0].id, { phone: fields.phone })); assert.equal(f.writes, 0);
  }
  const f = fixture();
  for (const query of [{ phone: "" }, { phone: fields.phone, page: ["1", "2"] }, { phone: fields.phone, ownerId: other }, { phone: fields.phone, page: "10001" }]) await assert.rejects(f.service.matchingPage(owner, f.orders[0].id, query));
  const empty = await f.service.matchingPage(owner, f.orders[0].id, { phone: fields.phone, page: "2" });
  assert.deepEqual(empty, { matches: [], hasMore: false, page: 2 }); assert.equal(f.writes, 0);
});

test("foreign sales and conflicting order links cannot change customers or associations", async () => {
  const f = fixture(); f.addSale().userId = other;
  await assert.rejects(f.service.confirm(owner, f.orders[0].id, create(true)), /ORDER_SALE_NOT_FOUND/);
  assert.equal(f.customers.length, 0); assert.equal(f.operations.length, 0); assert.equal(f.orders[0].customerId, null);
  const g = fixture(); const a = customer(), b = customer(); g.customers.push(a, b); g.orders[0].customerId = a.id;
  await assert.rejects(g.service.confirm(owner, g.orders[0].id, select(b)), /ORDER_CUSTOMER_CONFLICT/);
  assert.equal(g.orders[0].customerId, a.id); assert.equal(g.operations.length, 0);
});

test("owner-scoped operation keys remain isolated and repeated explicit association never duplicates a sale link", async () => {
  const f = fixture(); const command = create();
  f.orders.push({ ...f.orders[0], id: randomUUID(), ownerId: other });
  const a = await f.service.confirm(owner, f.orders[0].id, command), b = await f.service.confirm(other, f.orders[1].id, command);
  assert.notEqual(a.customer.id, b.customer.id); assert.equal(a.customer.ownerId, owner); assert.equal(b.customer.ownerId, other); assert.equal(f.operations.length, 2);
  const g = fixture(); g.addSale(); const first = await g.service.confirm(owner, g.orders[0].id, create(true));
  await g.service.confirm(owner, g.orders[0].id, select(first.customer, true));
  assert.equal(g.customers.length, 1); assert.equal(g.sales.length, 1); assert.equal(g.sales[0].version, 2);
});

test("private HTTP preview/confirm validates, exposes matches and protects against missing authentication", async () => {
  const f = fixture(); const controller = makeOrderCustomerController(f.service);
  const app = express(); app.use(express.json());
  app.use((req: AuthenticatedRequest, _res, next) => { if (req.headers["x-owner"]) req.user = { id: String(req.headers["x-owner"]), email: "test@example.invalid" }; next(); });
  app.post("/orders/:orderId/customer-preview", controller.preview); app.post("/orders/:orderId/customer-confirm", controller.confirm);
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening"); const address = server.address(); assert.ok(address && typeof address !== "string");
  const post = (path: string, body: unknown, who: string = owner) => fetch(`http://127.0.0.1:${address.port}/orders/${f.orders[0].id}/${path}`, { method: "POST", headers: { "Content-Type": "application/json", ...(who ? { "x-owner": who } : {}) }, body: JSON.stringify(body) });
  try {
    assert.equal((await post("customer-preview", {}, "")).status, 401); assert.equal((await post("customer-preview", {}, other)).status, 404);
    assert.equal((await post("customer-preview", fields)).status, 400);
    const response = await post("customer-preview", {}); assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "private, no-store"); assert.equal(f.writes, 0);
    f.customers.push(customer());
    const match = await post("customer-confirm", create()); assert.equal(match.status, 409); const body = await match.json(); assert.equal(body.error, "CUSTOMER_PHONE_MATCH"); assert.equal(body.matches.length, 1);
    const result = await post("customer-confirm", select(f.customers[0])); assert.equal(result.status, 200); assert.equal(f.customers.length, 1);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
