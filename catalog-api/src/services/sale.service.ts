// @ts-nocheck
import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma";
import { lockInventoryOwner } from "../repositories/inventory.repository";
import { z } from "zod";
import { createInternalSale, updateInternalSaleDraft, saleCustomerInclude, findActiveSaleCustomer, orderBuyerSnapshots } from "./sale-customer";
import { createSaleSchema, updateDraftSaleSchema, confirmSaleSchema, transitionSaleSchema, cancelSaleSchema, returnSaleSchema, convertOrderToSaleSchema } from "../schemas/sales.schema";

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const jsonSafe = (value: unknown) => JSON.parse(JSON.stringify(value, (_, v) => typeof v === "bigint" ? v.toString() : v));
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const byItem = <T extends { inventoryItemId: string }>(lines: T[]) => [...lines].sort((a, b) => compare(a.inventoryItemId, b.inventoryItemId));
export function makeSaleService(database = prisma) {
  async function own(tx: any, userId: string, id: string) { const sale = await tx.sale.findFirst({ where: { id, userId }, include: saleCustomerInclude(userId) }); if (!sale) throw new Error("NOT_FOUND"); return sale; }
  async function operation(tx: any, userId: string, saleId: string, input: { operationId: string; requestId?: string; expectedVersion?: number | null }, type: string, command: unknown) {
    const requestHash = hash(command); const previous = await tx.saleOperation.findFirst({ where: { saleId, userId, OR: [{ id: input.operationId }, { requestId: input.requestId }] } });
    if (previous) { if (previous.requestHash !== requestHash) throw new Error("IDEMPOTENCY_CONFLICT"); return previous; }
    return tx.saleOperation.create({ data: { id: input.operationId, saleId, userId, type, requestId: input.requestId ?? input.operationId, expectedSaleVersion: input.expectedVersion ?? null, requestHash, status: "PREPARED" } });
  }
  // Lock order shared by confirm/deliver/cancel/return: owner FOR SHARE -> Sale FOR UPDATE -> items ORDER BY id FOR UPDATE.
  // A key that already succeeded returns its stored receipt before status/version checks, so a lost reply can be retried.
  async function begin(tx: any, userId: string, saleId: string, input: { operationId: string; requestId?: string }, type: string) {
    await lockInventoryOwner(tx, userId);
    await tx.$queryRaw`SELECT id FROM "Sale" WHERE id = ${saleId} AND "userId" = ${userId} FOR UPDATE`;
    const sale = await own(tx, userId, saleId);
    const previous = await tx.saleOperation.findFirst({ where: { userId, OR: [{ id: input.operationId }, { requestId: input.requestId ?? input.operationId }] } });
    if (!previous) return { sale, replayed: undefined };
    if (previous.saleId !== saleId || previous.type !== type || previous.requestHash !== hash(input)) throw new Error("IDEMPOTENCY_CONFLICT");
    if (previous.status !== "SUCCEEDED") return { sale, replayed: undefined };
    return { sale, replayed: previous.responseSnapshot ?? jsonSafe(sale) };
  }
  async function lockItems(tx: any, userId: string, ids: string[]) {
    const unique = [...new Set(ids)].sort(compare);
    if (!unique.length) return new Map();
    await tx.$queryRaw(Prisma.sql`SELECT id FROM inventory_items WHERE "userId" = ${userId} AND id IN (${Prisma.join(unique)}) ORDER BY id FOR UPDATE`);
    // Read balances only after the rows are locked, so a concurrent sale's committed stock is visible.
    const items = await tx.inventoryItem.findMany({ where: { userId, id: { in: unique } }, include: { commercialTerms: true } });
    return new Map(items.map((item: any) => [item.id, item]));
  }
  async function succeed(tx: any, op: { id: string }, updated: unknown) {
    await tx.saleOperation.update({ where: { id: op.id }, data: { status: "SUCCEEDED", completedAt: new Date(), responseSnapshot: jsonSafe(updated) } });
  }
  return {
    async convertOrderToSale(userId: string, orderId: string, input: z.infer<typeof convertOrderToSaleSchema>) { input = convertOrderToSaleSchema.parse(input); return database.$transaction(async tx => {
      await lockInventoryOwner(tx, userId);
      await tx.$queryRaw`SELECT o.id FROM orders o JOIN catalogs c ON c.id=o."catalogId" WHERE o.id=${orderId} AND c."userId"=${userId} FOR UPDATE`;
      const existingOperation = await tx.saleOperation.findFirst({ where: { userId, OR: [{ id: input.operationId }, { requestId: input.requestId }] }, include: { sale: { include: { lines: true } } } });
      if (existingOperation) { if (existingOperation.type !== "ORDER_CONVERSION" || existingOperation.sale?.userId !== userId || existingOperation.sale?.sourceOrderId !== orderId || existingOperation.requestHash !== hash(input)) throw new Error("IDEMPOTENCY_CONFLICT"); return { sale: existingOperation.sale, idempotent: true }; }
      const order = await tx.order.findFirst({ where: { id: orderId, catalog: { userId } }, include: { items: { include: { product: { include: { inventoryItem: { include: { commercialTerms: true } } } } } }, catalog: true } });
      if (!order) throw new Error("ORDER_NOT_FOUND");
      if (!["PENDING", "CONFIRMED"].includes(order.status)) throw new Error("ORDER_STATUS_NOT_CONVERTIBLE");
      const customer = input.customerId ? await findActiveSaleCustomer(tx, userId, input.customerId) : null;
      const lines = order.items.map((line: any) => { const item = line.product?.inventoryItem; if (!line.productId || !item) throw new Error("ORDER_ITEM_NOT_INVENTORY"); if (!item.commercialTerms) throw new Error("PRICE_REQUIRED"); const currentPrice = Number(item.commercialTerms.unitSalePrice); if (currentPrice !== line.unitPrice && !input.acceptPriceDifference) throw new Error("PRICE_DIFFERENCE_REQUIRES_CONFIRMATION"); const orderPrice = BigInt(line.unitPrice); const discount = 0n; return { line, item, orderPrice, discount, total: orderPrice * BigInt(line.quantity) }; });
      const subtotal = lines.reduce((sum: bigint, row: any) => sum + row.total, 0n);
      const sale = await tx.sale.create({ data: { userId, sourceOrderId: order.id, customerId: customer?.id ?? null, ...orderBuyerSnapshots(order), customerName: order.customerName, customerPhone: order.customerPhone, subtotal, discountTotal: 0n, total: subtotal, status: "DRAFT" } });
      for (const row of lines) await tx.saleLine.create({ data: { saleId: sale.id, inventoryItemId: row.item.id, quantity: row.line.quantity, itemName: row.item.name, sku: row.item.sku, unitPrice: row.orderPrice, unitCost: row.item.commercialTerms.referenceUnitCost, unitDiscount: row.discount, lineTotal: row.total, commercialTermsVersion: row.item.commercialTerms.version } });
      const op = await tx.saleOperation.create({ data: { id: input.operationId, saleId: sale.id, userId, type: "ORDER_CONVERSION", requestId: input.requestId, expectedSaleVersion: 1, requestHash: hash(input), status: "PREPARED" } });
      if (input.mode !== "DRAFT") {
        for (const row of lines) { if (row.item.stock < row.line.quantity) throw new Error("STOCK_INSUFFICIENT"); await tx.inventoryItem.update({ where: { id: row.item.id }, data: { stock: { decrement: row.line.quantity }, stockVersion: { increment: 1 } } }); await tx.inventoryMovement.create({ data: { itemId: row.item.id, saleId: sale.id, saleLineId: (await tx.saleLine.findUniqueOrThrow({ where: { saleId_inventoryItemId: { saleId: sale.id, inventoryItemId: row.item.id } } })).id, saleMovementRole: "SALE_CONFIRMATION", key: input.operationId, type: "OUT", quantity: row.line.quantity, previousStock: row.item.stock, resultingStock: row.item.stock - row.line.quantity, delta: -row.line.quantity, reason: "Conversión de pedido", actorUserId: userId, origin: "SALE" } }); }
        const updated = await tx.sale.update({ where: { id: sale.id }, data: { status: input.mode, confirmedAt: new Date(), deliveredAt: input.mode === "DELIVERED" ? new Date() : null, version: { increment: 1 } } }); await tx.saleOperation.update({ where: { id: op.id }, data: { status: "SUCCEEDED", completedAt: new Date(), responseSnapshot: jsonSafe(updated) } }); return { sale: await tx.sale.findUniqueOrThrow({ where: { id: sale.id }, include: { lines: true } }), idempotent: false };
      }
      await tx.saleOperation.update({ where: { id: op.id }, data: { status: "SUCCEEDED", completedAt: new Date(), responseSnapshot: jsonSafe(sale) } }); return { sale: await tx.sale.findUniqueOrThrow({ where: { id: sale.id }, include: { lines: true } }), idempotent: false };
    }); },
    async list(userId: string) { return database.$transaction(async tx => { await lockInventoryOwner(tx, userId); return tx.sale.findMany({ where: { userId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 50, include: saleCustomerInclude(userId) }); }); },
    async get(userId: string, saleId: string) { return database.$transaction(async tx => { await lockInventoryOwner(tx, userId); return own(tx, userId, saleId); }); },
    create: (userId: string, input: z.infer<typeof createSaleSchema>) => createInternalSale(userId, input, database),
    updateDraft: (userId: string, saleId: string, input: z.infer<typeof updateDraftSaleSchema>) => updateInternalSaleDraft(userId, saleId, input, database),
    async confirm(userId: string, saleId: string, input: z.infer<typeof confirmSaleSchema>) { return database.$transaction(async tx => {
      const { sale, replayed } = await begin(tx, userId, saleId, input, "CONFIRM"); if (replayed !== undefined) return replayed;
      if (sale.status !== "DRAFT" || sale.version !== input.expectedVersion) throw new Error("VERSION_CONFLICT");
      const op = await operation(tx, userId, saleId, input, "CONFIRM", input);
      const lines = byItem(sale.lines); const items = await lockItems(tx, userId, lines.map(line => line.inventoryItemId));
      for (const line of lines) { const item = items.get(line.inventoryItemId); if (!item || item.stock < line.quantity) throw new Error("STOCK_INSUFFICIENT"); if (!item.commercialTerms || item.commercialTerms.version !== line.commercialTermsVersion) throw new Error("PRICE_CHANGED"); }
      for (const line of lines) { const item = items.get(line.inventoryItemId); await tx.inventoryItem.update({ where: { id: item.id }, data: { stock: { decrement: line.quantity }, stockVersion: { increment: 1 } } }); await tx.inventoryMovement.create({ data: { itemId: item.id, saleId, saleLineId: line.id, saleMovementRole: "SALE_CONFIRMATION", key: input.operationId, type: "OUT", quantity: line.quantity, previousStock: item.stock, resultingStock: item.stock - line.quantity, delta: -line.quantity, reason: "Confirmación de venta", actorUserId: userId, origin: "SALE" } }); }
      const status = input.deliverImmediately ? "DELIVERED" : "CONFIRMED"; const updated = await tx.sale.update({ where: { id: saleId }, data: { status, confirmedAt: new Date(), deliveredAt: input.deliverImmediately ? new Date() : null, version: { increment: 1 } } });
      await succeed(tx, op, updated); return updated;
    }); },
    async transition(userId: string, saleId: string, input: z.infer<typeof transitionSaleSchema>) { return database.$transaction(async tx => {
      const { sale, replayed } = await begin(tx, userId, saleId, input, "DELIVER"); if (replayed !== undefined) return replayed;
      if (sale.status !== "CONFIRMED" || sale.version !== input.expectedVersion) throw new Error("INVALID_TRANSITION");
      const op = await operation(tx, userId, saleId, input, "DELIVER", input);
      const updated = await tx.sale.update({ where: { id: saleId }, data: { status: "DELIVERED", deliveredAt: new Date(), version: { increment: 1 } } });
      await succeed(tx, op, updated); return updated;
    }); },
    async cancel(userId: string, saleId: string, input: z.infer<typeof cancelSaleSchema>) { return database.$transaction(async tx => {
      const { sale, replayed } = await begin(tx, userId, saleId, input, "CANCEL"); if (replayed !== undefined) return replayed;
      if (!["CONFIRMED", "DELIVERED"].includes(sale.status) || sale.version !== input.expectedVersion) throw new Error("INVALID_TRANSITION");
      const op = await operation(tx, userId, saleId, input, "CANCEL", input);
      const lines = byItem(sale.lines); const items = await lockItems(tx, userId, lines.map(line => line.inventoryItemId));
      for (const line of lines) { const item = items.get(line.inventoryItemId); if (!item) throw new Error("ITEM_NOT_FOUND"); await tx.inventoryItem.update({ where: { id: item.id }, data: { stock: { increment: line.quantity }, stockVersion: { increment: 1 } } }); await tx.inventoryMovement.create({ data: { itemId: item.id, saleId, saleLineId: line.id, saleMovementRole: "SALE_CANCELLATION", key: input.operationId, type: "IN", quantity: line.quantity, previousStock: item.stock, resultingStock: item.stock + line.quantity, delta: line.quantity, reason: input.reason, actorUserId: userId, origin: "SALE" } }); }
      const updated = await tx.sale.update({ where: { id: saleId }, data: { status: "CANCELLED", cancelledAt: new Date(), version: { increment: 1 } } });
      await succeed(tx, op, updated); return updated;
    }); },
    async returnSale(userId: string, saleId: string, input: z.infer<typeof returnSaleSchema>) { return database.$transaction(async tx => {
      const { sale, replayed } = await begin(tx, userId, saleId, input, "RETURN"); if (replayed !== undefined) return replayed;
      if (sale.status !== "DELIVERED" || sale.version !== input.expectedVersion) throw new Error("INVALID_TRANSITION");
      const op = await operation(tx, userId, saleId, input, "RETURN", input);
      const rows = input.lines.map(line => { const saleLine = sale.lines.find(l => l.id === line.saleLineId); if (!saleLine || line.receivedQuantity !== saleLine.quantity) throw new Error("RETURN_MUST_BE_TOTAL"); return { line, saleLine }; }).sort((a, b) => compare(a.saleLine.inventoryItemId, b.saleLine.inventoryItemId));
      const items = await lockItems(tx, userId, rows.filter(row => row.line.resellableQuantity).map(row => row.saleLine.inventoryItemId));
      const ret = await tx.saleReturn.create({ data: { saleId, userId, operationId: input.operationId, reason: input.reason } });
      for (const { line, saleLine } of rows) { await tx.saleReturnLine.create({ data: { returnId: ret.id, saleLineId: line.saleLineId, receivedQuantity: line.receivedQuantity, resellableQuantity: line.resellableQuantity, damagedQuantity: line.damagedQuantity } }); if (line.resellableQuantity) { const item = items.get(saleLine.inventoryItemId); if (!item) throw new Error("ITEM_NOT_FOUND"); await tx.inventoryItem.update({ where: { id: item.id }, data: { stock: { increment: line.resellableQuantity }, stockVersion: { increment: 1 } } }); await tx.inventoryMovement.create({ data: { itemId: item.id, saleId, saleLineId: saleLine.id, saleMovementRole: "SALE_RETURN_RESELLABLE", key: input.operationId, type: "IN", quantity: line.resellableQuantity, previousStock: item.stock, resultingStock: item.stock + line.resellableQuantity, delta: line.resellableQuantity, reason: input.reason, actorUserId: userId, origin: "SALE" } }); item.stock += line.resellableQuantity; } }
      const updated = await tx.sale.update({ where: { id: saleId }, data: { status: "RETURNED", returnedAt: new Date(), version: { increment: 1 } } });
      await succeed(tx, op, updated); return updated;
    }); },
  };
}
