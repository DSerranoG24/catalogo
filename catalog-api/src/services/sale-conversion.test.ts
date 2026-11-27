import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { makeSaleService } from "./sale.service";

type Setup = { status?: string; stock?: number; orderPrice?: number; currentPrice?: number; inventory?: boolean; owner?: boolean };
function setup(options: Setup = {}) {
  const ids = { order: randomUUID(), product: randomUUID(), item: randomUUID(), sale: randomUUID(), line: randomUUID(), customer: randomUUID() };
  const state: any = { stock: options.stock ?? 5, sales: [], lines: [], operations: [], movements: [], entries: [], order: { id: ids.order, status: options.status ?? "PENDING", customerName: "Cliente", customerPhone: "300", customerEmail: "buyer@example.invalid", catalogId: "catalog", items: [] } };
  const item = options.inventory === false ? null : { id: ids.item, name: "Producto", sku: "SKU", stock: state.stock, commercialTerms: { unitSalePrice: BigInt(options.currentPrice ?? options.orderPrice ?? 100), referenceUnitCost: 20n, version: 1 } };
  state.order.items = [{ id: randomUUID(), productId: options.inventory === false ? null : ids.product, product: options.owner === false ? null : { id: ids.product, catalogId: "catalog", inventoryItem: item }, productName: "Nombre pedido", quantity: 2, unitPrice: options.orderPrice ?? 100, subtotal: 200 }];
  state.customer = { id: ids.customer, ownerId: "owner", fullName: "Ficha interna", phone: "3110000000", email: "internal@example.invalid", archivedAt: null };
  const locks: string[] = [];
  const tx: any = {
    $queryRaw: async (first: any) => { locks.push(Array.isArray(first) ? first.join("?") : first.sql); return [{ id: "owner" }]; },
    // Account money lock (Agents.md): recorded with the row locks so the order can be asserted.
    $executeRaw: async (first: any) => { const sql = Array.isArray(first) ? first.join("?") : first.sql; assert.match(sql, /pg_advisory_xact_lock\(hashtext\('account-money-v1'\)/); locks.push(sql); return 1; },
    customer: { findFirst: async (args: Prisma.CustomerFindFirstArgs) => {
      assert.equal(args.where?.ownerId, "owner");
      return state.customer.id === args.where?.id && state.customer.ownerId === args.where?.ownerId ? state.customer : null;
    } },
    order: { findFirst: async () => options.owner === false ? null : state.order },
    saleOperation: {
      findFirst: async ({ where }: any) => { assert.equal(where.OR, undefined, "receipts are looked up by operationId only"); const op = state.operations.find((candidate: any) => candidate.userId === where.userId && candidate.id === where.id); return op ? { ...op, sale: state.sales.find((sale: any) => sale.id === op.saleId) } : null; },
      create: async ({ data }: any) => { const op = { ...data }; state.operations.push(op); return op; },
      update: async ({ where, data }: any) => { const op = state.operations.find((x: any) => x.id === where.id); Object.assign(op, data); return op; },
    },
    sale: {
      findFirst: async ({ where }: any) => {
        assert.equal(where.userId, "owner");
        // By id: the payments state of the sale (saleMoneyState); otherwise the sale of an order.
        if (where.id) { const sale = state.sales.find((x: any) => x.id === where.id && x.userId === where.userId); return sale ? { ...sale, lines: state.lines.filter((line: any) => line.saleId === sale.id), returns: [] } : null; }
        return state.sales.find((sale: any) => sale.sourceOrderId === where.sourceOrderId && sale.userId === where.userId) ?? null;
      },
      create: async ({ data }: any) => { const sale = { id: ids.sale, version: 1, lines: [], customerId: null, customerNameSnapshot: null, customerPhoneSnapshot: null, customerEmailSnapshot: null, ...data }; state.sales.push(sale); return sale; },
      update: async ({ where, data }: any) => { const sale = state.sales.find((x: any) => x.id === where.id); Object.assign(sale, data, { version: (sale.version ?? 1) + (data.version?.increment ?? 0) }); return sale; },
      findUniqueOrThrow: async ({ where }: any) => ({ ...state.sales.find((sale: any) => sale.id === where.id), lines: state.lines.filter((line: any) => line.saleId === where.id), returns: [] }),
    },
    saleLine: {
      create: async ({ data }: any) => { const line = { id: ids.line, ...data }; state.lines.push(line); return line; },
      findUniqueOrThrow: async () => state.lines[0],
    },
    inventoryItem: {
      // Confirmed/delivered conversions read the item again after locking it, with the live stock.
      findMany: async ({ where }: any) => { assert.equal(where.userId, "owner"); locks.push(`items:${where.id.in.join(",")}`); return item && where.id.in.includes(item.id) ? [{ ...item, stock: state.stock }] : []; },
      update: async ({ data }: any) => { state.stock += Number(data.stock.decrement ? -data.stock.decrement : data.stock.increment); return item; },
    },
    inventoryMovement: { create: async ({ data }: any) => { state.movements.push(data); return data; } },
    // Payments book of the sale (F2a-2b/F2a-3c): a confirmed conversion is TRACKED, with its payments or none.
    customerCreditEntry: { findMany: async () => [] },
    salePaymentEntry: {
      findMany: async ({ where }: any) => state.entries.filter((e: any) => e.ownerId === where.ownerId && (where.saleId?.in ? where.saleId.in.includes(e.saleId) : e.saleId === where.saleId)),
      create: async ({ data }: any) => { const entry = { id: randomUUID(), createdAt: new Date(), reversesEntryId: null, creditEntryId: null, ...data }; state.entries.push(entry); return entry; },
    },
  };
  const database = { $transaction: async (fn: (client: any) => unknown) => { const before = structuredClone(state); try { return await fn(tx); } catch (error) { Object.keys(state).forEach(key => { state[key] = before[key]; }); throw error; } } } as any;
  return { ids, state, locks, service: makeSaleService(database), input: { operationId: randomUUID(), requestId: randomUUID(), mode: "DRAFT", acceptPriceDifference: false } as any };
}

test("order conversion creates draft snapshots at the frozen order price without stock movement", async () => { const f = setup(); const result = await f.service.convertOrderToSale("owner", f.ids.order, f.input); assert.equal(result.sale.status, "DRAFT"); assert.equal(result.sale.customerId, null); assert.equal(result.sale.customerNameSnapshot, "Cliente"); assert.equal(result.sale.customerPhoneSnapshot, "300"); assert.equal(result.sale.customerEmailSnapshot, "buyer@example.invalid"); assert.equal(result.sale.customerName, "Cliente"); assert.equal(result.sale.subtotal, 200n); assert.equal(result.sale.total, 200n); assert.equal(f.state.lines[0].unitPrice, 100n); assert.equal(f.state.lines[0].lineTotal, 200n); assert.equal(f.state.stock, 5); assert.equal(f.state.movements.length, 0); assert.equal(f.state.lines[0].itemName, "Producto"); assert.equal(f.state.order.items[0].productName, "Nombre pedido"); });
test("confirmed conversion deducts stock, records the sale movement and is TRACKED with an advance of 0", async () => {
  const f = setup(); const result: any = await f.service.convertOrderToSale("owner", f.ids.order, { ...f.input, mode: "CONFIRMED" });
  assert.equal(result.sale.status, "CONFIRMED"); assert.equal(result.sale.lines[0].unitPrice, 100n); assert.equal(f.state.stock, 3); assert.equal(f.state.movements.length, 1); assert.equal(f.state.movements[0].saleMovementRole, "SALE_CONFIRMATION");
  assert.equal(f.state.sales[0].paymentMode, "TRACKED", "every confirmed conversion records its payments");
  assert.deepEqual([result.sale.payments.mode, result.sale.payments.paid, result.sale.payments.balance], ["TRACKED", 0n, 200n]);
  assert.equal(f.state.entries.length, 0, "no payment: an advance of 0");
});
test("F2a-3c: converting and delivering in one call is no longer offered; nothing is written", async () => {
  const f = setup();
  await assert.rejects(f.service.convertOrderToSale("owner", f.ids.order, { ...f.input, mode: "DELIVERED", payments: [{ method: "CASH", amount: "200" }] }), /ORDER_CONVERSION_DELIVERY_REMOVED/);
  assert.deepEqual([f.state.sales.length, f.state.movements.length, f.state.operations.length, f.state.stock], [0, 0, 0, 5]);
});
test("conversion rejects foreign, cancelled, missing-inventory and insufficient-stock orders atomically", async () => { const foreign = setup({ owner: false }); await assert.rejects(() => foreign.service.convertOrderToSale("owner", foreign.ids.order, foreign.input), /ORDER_NOT_FOUND/); assert.equal(foreign.state.sales.length, 0); const cancelled = setup({ status: "CANCELLED" }); await assert.rejects(() => cancelled.service.convertOrderToSale("owner", cancelled.ids.order, cancelled.input), /ORDER_STATUS_NOT_CONVERTIBLE/); const noItem = setup({ inventory: false }); await assert.rejects(() => noItem.service.convertOrderToSale("owner", noItem.ids.order, noItem.input), /ORDER_ITEM_NOT_INVENTORY/); const low = setup({ stock: 1 }); await assert.rejects(() => low.service.convertOrderToSale("owner", low.ids.order, { ...low.input, mode: "CONFIRMED" }), /STOCK_INSUFFICIENT/); assert.equal(low.state.sales.length, 0); assert.equal(low.state.movements.length, 0); });
test("conversion requires explicit acceptance but preserves the order price after an inventory price increase", async () => { const rejected = setup({ orderPrice: 100, currentPrice: 120 }); await assert.rejects(() => rejected.service.convertOrderToSale("owner", rejected.ids.order, rejected.input), /PRICE_DIFFERENCE_REQUIRES_CONFIRMATION/); const accepted = setup({ orderPrice: 100, currentPrice: 120 }); const result = await accepted.service.convertOrderToSale("owner", accepted.ids.order, { ...accepted.input, mode: "CONFIRMED", acceptPriceDifference: true }); assert.equal(result.sale.total, 200n); assert.equal(result.sale.lines[0].unitPrice, 100n); assert.equal(result.sale.lines[0].lineTotal, 200n); assert.equal(accepted.state.stock, 3); assert.equal(accepted.state.order.items[0].product.inventoryItem.commercialTerms.unitSalePrice, 120n); });
test("conversion preserves the order price after an inventory price decrease", async () => { const f = setup({ orderPrice: 100, currentPrice: 80 }); const result = await f.service.convertOrderToSale("owner", f.ids.order, { ...f.input, mode: "CONFIRMED", acceptPriceDifference: true }); assert.equal(result.sale.subtotal, 200n); assert.equal(result.sale.total, 200n); assert.equal(result.sale.lines[0].unitPrice, 100n); assert.equal(result.sale.lines[0].lineTotal, 200n); assert.equal(f.state.stock, 3); assert.equal(f.state.order.items[0].product.inventoryItem.commercialTerms.unitSalePrice, 80n); });
test("same operation/request is idempotent and a changed payload conflicts", async () => { const f = setup(); const first = await f.service.convertOrderToSale("owner", f.ids.order, f.input); const retry = await f.service.convertOrderToSale("owner", f.ids.order, f.input); assert.equal(retry.idempotent, true); assert.equal(f.state.sales.length, 1); await assert.rejects(() => f.service.convertOrderToSale("owner", f.ids.order, { ...f.input, mode: "CONFIRMED" }), /IDEMPOTENCY_CONFLICT/); assert.equal(first.sale.id, retry.sale.id); });

test("order buyer snapshots are exact, without Customer assignment or writes to the source order", async () => {
  const f = setup();
  f.state.order.customerName = "Comprador original"; f.state.order.customerPhone = "+57 300 0000000";
  const before = structuredClone(f.state.order);
  const { sale } = await f.service.convertOrderToSale("owner", f.ids.order, f.input);
  assert.equal(sale.customerId, null); assert.equal(sale.customerNameSnapshot, before.customerName);
  assert.equal(sale.customerPhoneSnapshot, before.customerPhone); assert.equal(sale.customerEmailSnapshot, before.customerEmail);
  assert.deepEqual(f.state.order, before); assert.equal(f.state.stock, 5);
  // The fixture has no Customer.create delegate: auto-creation fails closed.
});

test("missing or empty optional buyer email stays null and never comes from an internal customer", async () => {
  for (const email of [null, undefined, ""]) {
    const f = setup(); f.state.order.customerEmail = email;
    const result = await f.service.convertOrderToSale("owner", f.ids.order, { ...f.input, customerId: f.ids.customer });
    assert.equal(result.sale.customerId, f.ids.customer); assert.equal(result.sale.customerEmailSnapshot, null);
    assert.equal(result.sale.customerNameSnapshot, "Cliente"); assert.equal(result.sale.customerPhoneSnapshot, "300");
  }
});

test("a legacy order without buyer fields preserves null snapshots instead of using another source", async () => {
  const f = setup();
  delete f.state.order.customerName; delete f.state.order.customerPhone; delete f.state.order.customerEmail;
  const { sale } = await f.service.convertOrderToSale("owner", f.ids.order, f.input);
  assert.equal(sale.customerId, null); assert.equal(sale.customerNameSnapshot, null);
  assert.equal(sale.customerPhoneSnapshot, null); assert.equal(sale.customerEmailSnapshot, null);
});

test("an authorized explicit Customer is only an operational link; snapshots always come from Order", async () => {
  for (const mode of ["DRAFT", "CONFIRMED"]) {
    const f = setup(); const result = await f.service.convertOrderToSale("owner", f.ids.order, { ...f.input, mode, customerId: f.ids.customer });
    assert.equal(result.sale.customerId, f.ids.customer);
    assert.equal(result.sale.customerNameSnapshot, "Cliente"); assert.equal(result.sale.customerPhoneSnapshot, "300");
    assert.equal(result.sale.customerEmailSnapshot, "buyer@example.invalid");
    assert.notEqual(result.sale.customerNameSnapshot, f.state.customer.fullName);
    assert.notEqual(result.sale.customerPhoneSnapshot, f.state.customer.phone);
    assert.notEqual(result.sale.customerEmailSnapshot, f.state.customer.email);
    assert.equal(result.sale.total, 200n); assert.equal(f.state.lines[0].unitPrice, 100n);
    assert.equal(f.state.stock, mode === "DRAFT" ? 5 : 3);
  }
});

test("missing, foreign and archived customers reject conversion atomically before any sale or stock write", async () => {
  for (const condition of ["missing", "foreign", "archived"]) {
    const f = setup();
    if (condition === "foreign") f.state.customer.ownerId = "other-owner";
    if (condition === "archived") f.state.customer.archivedAt = new Date();
    const before = structuredClone(f.state.order);
    await assert.rejects(f.service.convertOrderToSale("owner", f.ids.order, { ...f.input, customerId: condition === "missing" ? randomUUID() : f.ids.customer, mode: "CONFIRMED" }), condition === "archived" ? /CUSTOMER_ARCHIVED/ : /CUSTOMER_NOT_FOUND/);
    assert.equal(f.state.sales.length, 0); assert.equal(f.state.lines.length, 0); assert.equal(f.state.operations.length, 0);
    assert.equal(f.state.movements.length, 0); assert.equal(f.state.stock, 5); assert.deepEqual(f.state.order, before);
  }
});

test("idempotent conversion retains original order snapshots despite later edits or archived Customer", async () => {
  const f = setup(); const input = { ...f.input, customerId: f.ids.customer, mode: "CONFIRMED" };
  const first = await f.service.convertOrderToSale("owner", f.ids.order, input);
  f.state.order.customerName = "Editado después"; f.state.order.customerEmail = null;
  f.state.customer.fullName = "Ficha editada"; f.state.customer.archivedAt = new Date();
  const retry = await f.service.convertOrderToSale("owner", f.ids.order, input);
  assert.equal(retry.idempotent, true); assert.equal(retry.sale.id, first.sale.id);
  assert.equal(retry.sale.customerNameSnapshot, "Cliente"); assert.equal(retry.sale.customerEmailSnapshot, "buyer@example.invalid");
  assert.equal(f.state.sales.length, 1); assert.equal(f.state.operations.length, 1); assert.equal(f.state.movements.length, 1); assert.equal(f.state.stock, 3);
  await assert.rejects(f.service.convertOrderToSale("owner", f.ids.order, { ...input, customerId: null }), /IDEMPOTENCY_CONFLICT/);
  await assert.rejects(f.service.convertOrderToSale("owner", randomUUID(), input), /IDEMPOTENCY_CONFLICT/);
});

test("insufficient stock rolls back buyer snapshots, association, lines and operation", async () => {
  const f = setup({ stock: 1 });
  await assert.rejects(f.service.convertOrderToSale("owner", f.ids.order, { ...f.input, mode: "CONFIRMED", customerId: f.ids.customer }), /STOCK_INSUFFICIENT/);
  assert.equal(f.state.sales.length, 0); assert.equal(f.state.operations.length, 0); assert.equal(f.state.lines.length, 0);
  assert.equal(f.state.stock, 1); assert.equal(f.state.movements.length, 0);
});

test("a phone beyond the existing column capacity is rejected without truncation or writes", async () => {
  const f = setup(); f.state.order.customerPhone = "+" + "1".repeat(24);
  const original = structuredClone(f.state.order);
  await assert.rejects(f.service.convertOrderToSale("owner", f.ids.order, { ...f.input, mode: "CONFIRMED" }), /ORDER_BUYER_PHONE_TOO_LONG/);
  assert.equal(f.state.sales.length, 0); assert.equal(f.state.operations.length, 0); assert.equal(f.state.stock, 5);
  assert.deepEqual(f.state.order, original);
});

test("formatted phones and the full 24-character public limit are preserved exactly", async () => {
  for (const phone of ["+57 (300) 000-0000", "+" + "1".repeat(23)]) {
    const f = setup(); f.state.order.customerPhone = phone;
    const result = await f.service.convertOrderToSale("owner", f.ids.order, { ...f.input, mode: "CONFIRMED", customerId: f.ids.customer });
    assert.equal(result.sale.customerPhoneSnapshot, phone); assert.equal(result.sale.customerPhone, phone);
    assert.equal(result.sale.total, 200n); assert.equal(f.state.stock, 3); assert.equal(f.state.order.customerPhone, phone);
  }
});

test("confirmed conversion locks the order, then the items by id, and reads stock after the lock", async () => {
  const f = setup({ stock: 5 });
  f.state.order.items[0].product.inventoryItem.stock = 99; // stale value read with the order
  await f.service.convertOrderToSale("owner", f.ids.order, { ...f.input, mode: "CONFIRMED" });
  const orderLock = f.locks.findIndex(sql => /FROM orders .*FOR UPDATE/s.test(sql));
  const itemLock = f.locks.findIndex(sql => /FROM inventory_items .*ORDER BY id FOR UPDATE/s.test(sql));
  const itemRead = f.locks.findIndex(entry => entry.startsWith("items:"));
  assert.ok(orderLock >= 0 && orderLock < itemLock && itemLock < itemRead, `lock order: ${f.locks.join(" | ")}`);
  assert.equal(f.state.movements[0].previousStock, 5, "the movement uses the balance read under the lock");
  assert.equal(f.state.stock, 3);
  const draft = setup(); await draft.service.convertOrderToSale("owner", draft.ids.order, draft.input);
  assert.equal(draft.locks.some(sql => /inventory_items/.test(sql)), false, "a draft conversion does not lock items");
});

test("conversion: new requestId replays; a second key for a converted order is ORDER_ALREADY_CONVERTED", async () => {
  const f = setup(); const input = { ...f.input, mode: "CONFIRMED" };
  const first = await f.service.convertOrderToSale("owner", f.ids.order, input);
  const retry = await f.service.convertOrderToSale("owner", f.ids.order, { ...input, requestId: randomUUID() });
  assert.equal(retry.idempotent, true); assert.equal(retry.sale.id, first.sale.id); assert.equal(f.state.movements.length, 1);
  await assert.rejects(f.service.convertOrderToSale("owner", f.ids.order, { ...input, operationId: randomUUID(), requestId: randomUUID() }), /ORDER_ALREADY_CONVERTED/);
  assert.equal(f.state.sales.length, 1); assert.equal(f.state.stock, 3);
});
