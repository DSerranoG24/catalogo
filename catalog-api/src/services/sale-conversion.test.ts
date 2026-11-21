import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { makeSaleService } from "./sale.service";

type Setup = { status?: string; stock?: number; orderPrice?: number; currentPrice?: number; inventory?: boolean; owner?: boolean };
function setup(options: Setup = {}) {
  const ids = { order: randomUUID(), product: randomUUID(), item: randomUUID(), sale: randomUUID(), line: randomUUID() };
  const state: any = { stock: options.stock ?? 5, sales: [], lines: [], operations: [], movements: [], order: { id: ids.order, status: options.status ?? "PENDING", customerName: "Cliente", customerPhone: "300", catalogId: "catalog", items: [] } };
  const item = options.inventory === false ? null : { id: ids.item, name: "Producto", sku: "SKU", stock: state.stock, commercialTerms: { unitSalePrice: BigInt(options.currentPrice ?? options.orderPrice ?? 100), referenceUnitCost: 20n, version: 1 } };
  state.order.items = [{ id: randomUUID(), productId: options.inventory === false ? null : ids.product, product: options.owner === false ? null : { id: ids.product, catalogId: "catalog", inventoryItem: item }, productName: "Nombre pedido", quantity: 2, unitPrice: options.orderPrice ?? 100, subtotal: 200 }];
  const tx: any = {
    $queryRaw: async () => options.owner === false ? [] : [{ id: "owner" }],
    order: { findFirst: async () => options.owner === false ? null : state.order },
    saleOperation: {
      findFirst: async ({ where }: any) => { const op = state.operations.find((candidate: any) => candidate.userId === where.userId && (candidate.id === where.OR[0].id || candidate.requestId === where.OR[1].requestId)); return op ? { ...op, sale: state.sales.find((sale: any) => sale.id === op.saleId) } : null; },
      create: async ({ data }: any) => { const op = { ...data }; state.operations.push(op); return op; },
      update: async ({ where, data }: any) => { const op = state.operations.find((x: any) => x.id === where.id); Object.assign(op, data); return op; },
    },
    sale: {
      create: async ({ data }: any) => { const sale = { id: ids.sale, version: 1, lines: [], ...data }; state.sales.push(sale); return sale; },
      update: async ({ where, data }: any) => { const sale = state.sales.find((x: any) => x.id === where.id); Object.assign(sale, data, { version: (sale.version ?? 1) + (data.version?.increment ?? 0) }); return sale; },
    },
    saleLine: {
      create: async ({ data }: any) => { const line = { id: ids.line, ...data }; state.lines.push(line); return line; },
      findUniqueOrThrow: async () => state.lines[0],
    },
    inventoryItem: { update: async ({ data }: any) => { state.stock += Number(data.stock.decrement ? -data.stock.decrement : data.stock.increment); return item; } },
    inventoryMovement: { create: async ({ data }: any) => { state.movements.push(data); return data; } },
  };
  const database = { $transaction: async (fn: (client: any) => unknown) => { const before = structuredClone(state); try { return await fn(tx); } catch (error) { Object.keys(state).forEach(key => { state[key] = before[key]; }); throw error; } } } as any;
  return { ids, state, service: makeSaleService(database), input: { operationId: randomUUID(), requestId: randomUUID(), mode: "DRAFT", acceptPriceDifference: false } as any };
}

test("order conversion creates draft snapshots without stock movement", async () => { const f = setup(); const result = await f.service.convertOrderToSale("owner", f.ids.order, f.input); assert.equal(result.sale.status, "DRAFT"); assert.equal(f.state.stock, 5); assert.equal(f.state.movements.length, 0); assert.equal(f.state.lines[0].itemName, "Producto"); assert.equal(f.state.order.items[0].productName, "Nombre pedido"); });
test("confirmed and delivered conversion deducts stock and records sale movement", async () => { for (const mode of ["CONFIRMED", "DELIVERED"]) { const f = setup(); const result = await f.service.convertOrderToSale("owner", f.ids.order, { ...f.input, mode }); assert.equal(result.sale.status, mode); assert.equal(f.state.stock, 3); assert.equal(f.state.movements.length, 1); assert.equal(f.state.movements[0].saleMovementRole, "SALE_CONFIRMATION"); } });
test("conversion rejects cancelled orders, missing inventory and insufficient stock atomically", async () => { await assert.rejects(() => setup({ status: "CANCELLED" }).service.convertOrderToSale("owner", randomUUID(), setup().input), /ORDER_NOT_FOUND|ORDER_STATUS_NOT_CONVERTIBLE/); const noItem = setup({ inventory: false }); await assert.rejects(() => noItem.service.convertOrderToSale("owner", noItem.ids.order, noItem.input), /ORDER_ITEM_NOT_INVENTORY/); const low = setup({ stock: 1 }); await assert.rejects(() => low.service.convertOrderToSale("owner", low.ids.order, { ...low.input, mode: "CONFIRMED" }), /STOCK_INSUFFICIENT/); assert.equal(low.state.sales.length, 0); assert.equal(low.state.movements.length, 0); });
test("conversion requires explicit price-difference acceptance", async () => { const rejected = setup({ orderPrice: 100, currentPrice: 120 }); await assert.rejects(() => rejected.service.convertOrderToSale("owner", rejected.ids.order, rejected.input), /PRICE_DIFFERENCE_REQUIRES_CONFIRMATION/); const accepted = setup({ orderPrice: 100, currentPrice: 120 }); const result = await accepted.service.convertOrderToSale("owner", accepted.ids.order, { ...accepted.input, acceptPriceDifference: true }); assert.equal(result.sale.total, 240n); });
test("same operation/request is idempotent and a changed payload conflicts", async () => { const f = setup(); const first = await f.service.convertOrderToSale("owner", f.ids.order, f.input); const retry = await f.service.convertOrderToSale("owner", f.ids.order, f.input); assert.equal(retry.idempotent, true); assert.equal(f.state.sales.length, 1); await assert.rejects(() => f.service.convertOrderToSale("owner", f.ids.order, { ...f.input, mode: "CONFIRMED" }), /IDEMPOTENCY_CONFLICT/); assert.equal(first.sale.id, retry.sale.id); });
