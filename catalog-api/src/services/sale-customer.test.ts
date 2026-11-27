import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import test from "node:test";
import express from "express";
import { Prisma, type Customer, type Sale, type SaleLine } from "@prisma/client";
import { prisma } from "../config/prisma";
import { createSaleSchema, updateDraftSaleSchema } from "../schemas/sales.schema";
import { makeSaleService } from "./sale.service";
import { createInternalSale, updateInternalSaleDraft } from "./sale-customer";

const owner = randomUUID(), otherOwner = randomUUID(), customerId = randomUUID(), otherId = randomUUID(), itemId = randomUUID();
const createInput = () => ({ operationId: randomUUID(), requestId: randomUUID() });
const updateInput = (version = 1) => ({ operationId: randomUUID(), expectedVersion: version, lines: [{ inventoryItemId: itemId, quantity: 1, unitDiscount: "0" }] });

function fixture() {
  const customers: Customer[] = [customerId, otherId].map((id, index) => ({ id, ownerId: index ? otherOwner : owner, fullName: index ? "Foreign" : "Original",
    phone: "3000000000", email: "original@example.invalid", address: null, notes: null, archivedAt: null, createdAt: new Date(0), updatedAt: new Date(0) }));
  let sales: Sale[] = [], lines: SaleLine[] = [];
  let operations: { id: string; requestId: string; saleId: string; userId: string; type: string; requestHash: string; status: string }[] = [];
  let failOperation = false, failLine = false;
  const locks: string[] = [];
  const view = (sale: Sale) => ({ ...structuredClone(sale), lines: structuredClone(lines.filter(line => line.saleId === sale.id)),
    customer: structuredClone(customers.find(customer => customer.id === sale.customerId && customer.ownerId === sale.userId) ?? null) });
  let transactionTail = Promise.resolve();
  const database = new Proxy(prisma, { get(_target, key) {
    if (key === "$transaction") return async (work: (tx: Prisma.TransactionClient) => Promise<unknown>) => {
      // In-memory serialization, not a PostgreSQL concurrency certification.
      const beforeTransaction = transactionTail;
      let release: () => void = () => {};
      transactionTail = new Promise<void>(resolve => { release = resolve; });
      await beforeTransaction;
      const before = structuredClone({ sales, lines, operations });
      try { return await work(database); }
      catch (error) { sales = before.sales; lines = before.lines; operations = before.operations; throw error; }
      finally { release(); }
    };
    if (key === "$queryRaw") return async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join("?"); locks.push(sql);
      if (sql.includes("FROM users")) return [{ id: values[0] }];
      if (sql.includes("FROM customers")) { assert.ok(values.includes(owner)); assert.match(sql, /ownerId.*FOR SHARE/); return []; }
      if (sql.includes('FROM "Sale"')) { assert.ok(values.includes(owner) || values.includes(otherOwner)); assert.match(sql, /userId.*FOR UPDATE/); return []; }
      throw new Error("Unexpected SQL");
    };
    if (key === "$executeRaw") return async (strings: TemplateStringsArray) => { locks.push(strings.join("?")); return 1; };
    if (key === "customer") return { findFirst: async (args: Prisma.CustomerFindFirstArgs) => {
      assert.ok(args.where?.ownerId); return structuredClone(customers.find(customer => customer.id === args.where?.id && customer.ownerId === args.where?.ownerId) ?? null);
    } };
    if (key === "sale") return {
      create: async (args: Prisma.SaleCreateArgs) => {
        const data = args.data; assert.equal(typeof data.userId, "string"); assert.ok(data.userId);
        const sale: Sale = { id: randomUUID(), userId: data.userId, sourceOrderId: null, status: "DRAFT", version: 1, currency: "COP",
          customerId: data.customerId ?? null, customerName: data.customerName ?? null, customerPhone: data.customerPhone ?? null,
          customerNameSnapshot: data.customerNameSnapshot ?? null, customerPhoneSnapshot: data.customerPhoneSnapshot ?? null, customerEmailSnapshot: data.customerEmailSnapshot ?? null,
          subtotal: 0n, discountTotal: 0n, total: 0n, createdAt: new Date(0), updatedAt: new Date(0), confirmedAt: null, deliveredAt: null, cancelledAt: null, returnedAt: null,
          paymentMode: "LEGACY", paymentTermDays: null, paymentDueDate: null };
        sales.push(sale); return view(sale);
      },
      findFirst: async (args: Prisma.SaleFindFirstArgs) => {
        assert.equal(typeof args.where?.userId, "string");
        const sale = sales.find(sale => sale.id === args.where?.id && sale.userId === args.where?.userId); return sale ? view(sale) : null;
      },
      findMany: async (args: Prisma.SaleFindManyArgs) => {
        assert.equal(typeof args.where?.userId, "string"); return sales.filter(sale => sale.userId === args.where?.userId).map(view);
      },
      update: async (args: Prisma.SaleUpdateArgs) => {
        assert.equal(typeof args.where.userId, "string");
        const sale = sales.find(sale => sale.id === args.where.id && sale.userId === args.where.userId); assert.ok(sale);
        for (const field of ["customerId", "customerName", "customerPhone", "customerNameSnapshot", "customerPhoneSnapshot", "customerEmailSnapshot"] as const) {
          const value = args.data[field]; if (typeof value === "string" || value === null) sale[field] = value;
        }
        for (const field of ["subtotal", "discountTotal", "total"] as const) if (typeof args.data[field] === "bigint") sale[field] = args.data[field];
        sale.version++; return view(sale);
      },
    };
    if (key === "saleOperation") return {
      findFirst: async (args: Prisma.SaleOperationFindFirstArgs) => {
        const where = args.where; assert.equal(typeof where?.userId, "string");
        return structuredClone(operations.find(op => op.userId === where?.userId && (!where?.saleId || op.saleId === where.saleId)
          && (op.id === where?.id || where?.OR?.some(clause => op.id === clause.id || op.requestId === clause.requestId))) ?? null);
      },
      create: async (args: Prisma.SaleOperationCreateArgs) => {
        if (failOperation) throw new Error("TEST_OPERATION_FAILURE");
        const data = args.data; assert.ok(data.id && data.saleId && data.userId);
        const op = { id: data.id, saleId: data.saleId, userId: data.userId, requestId: data.requestId, type: data.type, requestHash: data.requestHash, status: data.status ?? "PREPARED" };
        assert.ok(!operations.some(previous => previous.id === op.id || (previous.userId === op.userId && previous.requestId === op.requestId)));
        operations.push(op); return op;
      },
    };
    if (key === "inventoryItem") return { findMany: async (args: Prisma.InventoryItemFindManyArgs) => {
      assert.equal(args.where?.userId, owner);
      return [{ id: itemId, name: "Item", sku: "SKU", commercialTerms: { unitSalePrice: 100n, referenceUnitCost: 20n, version: 1 } }];
    } };
    if (key === "saleLine") return {
      deleteMany: async (args: Prisma.SaleLineDeleteManyArgs) => { lines = lines.filter(line => line.saleId !== args.where?.saleId); return { count: 0 }; },
      create: async (args: Prisma.SaleLineCreateArgs) => {
        if (failLine) throw new Error("TEST_LINE_FAILURE");
        const data = args.data; assert.ok(data.saleId && data.inventoryItemId);
        const line: SaleLine = { id: randomUUID(), saleId: data.saleId, inventoryItemId: data.inventoryItemId, quantity: data.quantity, itemName: data.itemName, sku: data.sku,
          unitPrice: BigInt(String(data.unitPrice)), unitCost: data.unitCost == null ? null : BigInt(String(data.unitCost)), unitDiscount: BigInt(String(data.unitDiscount ?? 0)), lineTotal: BigInt(String(data.lineTotal)), commercialTermsVersion: data.commercialTermsVersion };
        lines.push(line); return line;
      },
    };
    // The detail reads the linked customer's credit balance (F2a-2b): a read, no movements here.
    if (key === "customerCreditEntry") return { findMany: async () => [] };
    throw new Error(`Unexpected database delegate ${String(key)}`);
  } });
  return { database, customers, locks, service: makeSaleService(database), get sales() { return sales; }, get lines() { return lines; }, get operations() { return operations; }, failOperation() { failOperation = true; }, failLine() { failLine = true; } };
}

test("sales without a customer preserve legacy input and leave all new columns null", async () => {
  const f = fixture(); const sale = await createInternalSale(owner, { ...createInput(), customerName: "Legacy", customerPhone: "300" }, f.database);
  assert.equal(sale.customerId, null); assert.equal(sale.customerNameSnapshot, null); assert.equal(sale.customerPhoneSnapshot, null); assert.equal(sale.customerEmailSnapshot, null);
  assert.equal(sale.customerName, "Legacy"); assert.equal(sale.customer, null);
  assert.ok(!f.locks.some(sql => sql.includes("FROM customers")));
});

test("valid owned customer is captured transactionally; client names are never authoritative", async () => {
  const f = fixture(); const sale = await f.service.create(owner, { ...createInput(), customerId, customerName: "Forged", customerPhone: "Forged" });
  assert.equal(sale.customerId, customerId); assert.equal(sale.customerNameSnapshot, "Original"); assert.equal(sale.customerPhoneSnapshot, "3000000000"); assert.equal(sale.customerEmailSnapshot, "original@example.invalid");
  assert.equal(sale.customerName, "Original"); assert.equal(sale.customerPhone, "3000000000");
  assert.equal(f.operations[0]?.status, "SUCCEEDED"); assert.ok(f.locks.some(sql => sql.includes("FOR SHARE")));
});

test("missing, foreign and archived customers reject atomically", async () => {
  for (const id of [otherId, randomUUID(), customerId]) {
    const f = fixture(); if (id === customerId) f.customers[0].archivedAt = new Date();
    await assert.rejects(f.service.create(owner, { ...createInput(), customerId: id }), id === customerId ? /CUSTOMER_ARCHIVED/ : /CUSTOMER_NOT_FOUND/);
    assert.equal(f.sales.length, 0); assert.equal(f.operations.length, 0);
  }
});

test("get/list return live owned relationship separately from immutable original snapshots", async () => {
  const f = fixture(); const sale = await f.service.create(owner, { ...createInput(), customerId });
  f.customers[0].fullName = "Edited"; f.customers[0].phone = "3110000000"; f.customers[0].email = null; f.customers[0].archivedAt = new Date();
  const current = await f.service.get(owner, sale.id);
  assert.equal(current.customer.fullName, "Edited"); assert.ok(current.customer.archivedAt);
  assert.equal(current.customerNameSnapshot, "Original"); assert.equal(current.customerPhoneSnapshot, "3000000000"); assert.equal(current.customerEmailSnapshot, "original@example.invalid");
  assert.equal((await f.service.list(owner))[0].customerNameSnapshot, "Original");
  assert.deepEqual(await f.service.list(otherOwner), []); await assert.rejects(f.service.get(otherOwner, sale.id), /NOT_FOUND/);
});

test("nullable email and legacy sales with null customer remain readable", async () => {
  const f = fixture(); f.customers[0].email = null;
  const linked = await f.service.create(owner, { ...createInput(), customerId }); assert.equal(linked.customerEmailSnapshot, null);
  const old = await f.service.create(owner, createInput());
  assert.equal((await f.service.get(owner, old.id)).customerId, null); assert.equal((await f.service.get(owner, old.id)).customer, null);
});

test("creation retries keep the same sale/snapshot after a customer edit/archive and changed commands conflict", async () => {
  const f = fixture(); const input = { ...createInput(), customerId };
  const first = await f.service.create(owner, input);
  f.customers[0].fullName = "Edited"; f.customers[0].archivedAt = new Date();
  const retry = await f.service.create(owner, input); assert.equal(retry.id, first.id); assert.equal(retry.customerNameSnapshot, "Original");
  await assert.rejects(f.service.create(owner, { ...input, customerId: null }), /IDEMPOTENCY_CONFLICT/);
  assert.equal(f.sales.length, 1); assert.equal(f.operations.length, 1);
});

test("concurrent simulated retries serialize before insertion and failed operation writes roll back sale creation", async () => {
  const f = fixture(); const input = { ...createInput(), customerId };
  const [a, b] = await Promise.all([f.service.create(owner, input), f.service.create(owner, input)]);
  assert.equal(a.id, b.id); assert.equal(f.sales.length, 1); assert.ok(f.locks.some(sql => sql.includes("sale-create-v1")));
  const failed = fixture(); failed.failOperation();
  await assert.rejects(failed.service.create(owner, input), /TEST_OPERATION_FAILURE/); assert.equal(failed.sales.length, 0);
});

test("draft assignment, unchanged association and explicit detachment obey snapshot rules", async () => {
  const f = fixture(); const sale = await f.service.create(owner, createInput());
  const assigned = await updateInternalSaleDraft(owner, sale.id, { ...updateInput(), customerId }, f.database);
  assert.equal(assigned.customerNameSnapshot, "Original");
  f.customers[0].fullName = "Edited";
  const unchanged = await updateInternalSaleDraft(owner, sale.id, { ...updateInput(2), customerId, customerName: "Forged" }, f.database);
  assert.equal(unchanged.customerNameSnapshot, "Original"); assert.equal(unchanged.customerName, "Original");
  const detached = await updateInternalSaleDraft(owner, sale.id, { ...updateInput(3), customerId: null }, f.database);
  assert.equal(detached.customerId, null); assert.equal(detached.customerNameSnapshot, null); assert.equal(detached.customerPhoneSnapshot, null); assert.equal(detached.customerEmailSnapshot, null);
});

test("all non-draft states and foreign ownership deny reassignment without writes", async () => {
  for (const status of ["CONFIRMED", "DELIVERED", "CANCELLED", "RETURNED"] as const) {
    const f = fixture(); const sale = await f.service.create(owner, createInput()); f.sales[0].status = status;
    await assert.rejects(updateInternalSaleDraft(owner, sale.id, { ...updateInput(), customerId }, f.database), /INVALID_TRANSITION/);
    assert.equal(f.sales[0].customerId, null); assert.equal(f.operations.length, 1);
  }
  const f = fixture(); const sale = await f.service.create(owner, createInput());
  await assert.rejects(updateInternalSaleDraft(otherOwner, sale.id, { ...updateInput(), customerId }, f.database), /NOT_FOUND/);
});

test("draft updates reject foreign/archived customers and line failures roll back association and lines", async () => {
  const f = fixture(); const sale = await f.service.create(owner, createInput());
  await assert.rejects(updateInternalSaleDraft(owner, sale.id, { ...updateInput(), customerId: otherId }, f.database), /CUSTOMER_NOT_FOUND/);
  f.customers[0].archivedAt = new Date();
  await assert.rejects(updateInternalSaleDraft(owner, sale.id, { ...updateInput(), customerId }, f.database), /CUSTOMER_ARCHIVED/);
  f.customers[0].archivedAt = null; f.failLine();
  await assert.rejects(updateInternalSaleDraft(owner, sale.id, { ...updateInput(), customerId }, f.database), /TEST_LINE_FAILURE/);
  assert.equal(f.sales[0].customerId, null); assert.equal(f.sales[0].version, 1); assert.equal(f.lines.length, 0); assert.equal(f.operations.length, 1);
});

test("draft update retries do not recapture snapshots, duplicate lines or increment version", async () => {
  const f = fixture(); const sale = await f.service.create(owner, createInput()); const input = { ...updateInput(), customerId };
  const first = await updateInternalSaleDraft(owner, sale.id, input, f.database); f.customers[0].fullName = "Edited";
  const retry = await updateInternalSaleDraft(owner, sale.id, input, f.database);
  assert.equal(retry.version, first.version); assert.equal(retry.customerNameSnapshot, "Original"); assert.equal(f.lines.length, 1);
  await assert.rejects(updateInternalSaleDraft(owner, sale.id, { ...input, customerId: null }, f.database), /IDEMPOTENCY_CONFLICT/);
  await assert.rejects(updateInternalSaleDraft(owner, sale.id, { ...updateInput(), customerId: null }, f.database), /VERSION_CONFLICT/);
});

test("an operation failure after a draft write rolls back snapshots, totals, version and lines", async () => {
  const f = fixture(); const sale = await f.service.create(owner, createInput());
  f.failOperation();
  await assert.rejects(updateInternalSaleDraft(owner, sale.id, { ...updateInput(), customerId }, f.database), /TEST_OPERATION_FAILURE/);
  assert.equal(f.sales[0].customerId, null); assert.equal(f.sales[0].customerNameSnapshot, null);
  assert.equal(f.sales[0].customerPhoneSnapshot, null); assert.equal(f.sales[0].customerEmailSnapshot, null);
  assert.equal(f.sales[0].version, 1); assert.equal(f.sales[0].total, 0n); assert.equal(f.lines.length, 0); assert.equal(f.operations.length, 1);
});

test("schemas reject client-supplied snapshots and invalid customer identifiers", () => {
  for (const customerId of ["bad", 123, ""]) assert.equal(createSaleSchema.safeParse({ ...createInput(), customerId }).success, false);
  for (const field of ["customerNameSnapshot", "customerPhoneSnapshot", "customerEmailSnapshot", "customerEmail", "userId"]) {
    assert.equal(createSaleSchema.safeParse({ ...createInput(), [field]: "forged" }).success, false);
    assert.equal(updateDraftSaleSchema.safeParse({ ...updateInput(), [field]: "forged" }).success, false);
  }
});

test("sales HTTP serializes monetary values, protects ownership and returns controlled customer errors", async () => {
  process.env.JWT_SECRET = "sale-customer-test-only-secret-at-least-32-bytes";
  const { makeSalesRouter } = await import("../routes/sales.routes.js");
  const f = fixture();
  const app = express();
  const authentication: Parameters<typeof makeSalesRouter>[1] = async (req, _res, next) => { if (req.headers["x-test-owner"]) req.user = { id: String(req.headers["x-test-owner"]), email: "owner@example.invalid" }; next(); };
  app.use("/api", makeSalesRouter(f.service, authentication));
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening"); const address = server.address(); assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}/api/sales`;
  const post = (body: unknown) => fetch(base, { method: "POST", headers: { "x-test-owner": owner, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  try {
    assert.equal((await fetch(base)).status, 401);
    const created = await post({ ...createInput(), customerId }); assert.equal(created.status, 200);
    const body = await created.json(); assert.equal(body.result.total, "0"); assert.equal(body.result.customerNameSnapshot, "Original");
    assert.equal((await fetch(`${base}/${body.result.id}`, { headers: { "x-test-owner": otherOwner } })).status, 404);
    assert.equal((await post({ ...createInput(), customerId: otherId })).status, 404);
    f.customers[0].archivedAt = new Date(); const archived = await post({ ...createInput(), customerId });
    assert.equal(archived.status, 409); assert.equal((await archived.json()).error, "CUSTOMER_ARCHIVED");
    const invalid = await post({ ...createInput(), customerNameSnapshot: "forged" }); assert.equal(invalid.status, 400);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
