// @ts-nocheck
import { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma";
import { lockInventoryOwner } from "../repositories/inventory.repository";
import { lockAccountForMoney } from "../repositories/account-lock";
import { z } from "zod";
import { createInternalSale, updateInternalSaleDraft, saleCustomerInclude, findActiveSaleCustomer, orderBuyerSnapshots } from "./sale-customer";
import { isSameSaleCommand, saleCommandHash } from "./sale-operation-hash";
import { createSaleSchema, updateDraftSaleSchema, confirmSaleSchema, deliverSaleSchema, cancelSaleSchema, returnSaleSchema, convertOrderToSaleSchema } from "../schemas/sales.schema";
import { attachPayments, CREDIT_SALES_ENABLED, ledgerWriter, recordPayments, saleMoneyState, settleSale } from "./sale-payment";

const jsonSafe = (value: unknown) => JSON.parse(JSON.stringify(value, (_, v) => typeof v === "bigint" ? v.toString() : v));
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const byItem = <T extends { inventoryItemId: string }>(lines: T[]) => [...lines].sort((a, b) => compare(a.inventoryItemId, b.inventoryItemId));
// Mutation responses (and their stored receipts) carry the lines and every return of the sale.
export const saleResultInclude = { lines: true, returns: { include: { lines: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] } } satisfies Prisma.SaleInclude;

export function makeSaleService(database = prisma) {
  async function own(tx: any, userId: string, id: string) { const sale = await tx.sale.findFirst({ where: { id, userId }, include: saleCustomerInclude(userId) }); if (!sale) throw new Error("NOT_FOUND"); return sale; }
  async function operation(tx: any, userId: string, saleId: string, input: { operationId: string; requestId?: string; expectedVersion?: number | null }, type: string) {
    return tx.saleOperation.create({ data: { id: input.operationId, saleId, userId, type, requestId: input.requestId ?? input.operationId, expectedSaleVersion: input.expectedVersion ?? null, requestHash: saleCommandHash(input), status: "PREPARED" } });
  }
  // Lock order shared by confirm/deliver/cancel/return (Agents.md): account money lock -> users FOR SHARE ->
  // Sale FOR UPDATE -> items ORDER BY id FOR UPDATE.
  // The receipt is looked up by operationId only, before status/version checks: same key and same
  // content (any requestId) replays it; same key with other content is a conflict.
  async function begin(tx: any, userId: string, saleId: string, input: { operationId: string; requestId?: string }, type: string) {
    await lockAccountForMoney(tx, userId);
    await tx.$queryRaw`SELECT id FROM "Sale" WHERE id = ${saleId} AND "userId" = ${userId} FOR UPDATE`;
    const sale = await own(tx, userId, saleId);
    const previous = await tx.saleOperation.findFirst({ where: { userId, id: input.operationId } });
    if (!previous) return { sale, replayed: undefined };
    if (previous.saleId !== saleId || previous.type !== type || !isSameSaleCommand(previous.requestHash, input)) throw new Error("IDEMPOTENCY_CONFLICT");
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
  // ---- Payments (F2a-2b). A request with payments or customerCreditAmount makes the sale TRACKED; without them
  // the LEGACY flow, results and errors are exactly the previous ones.
  const tracks = (input: { payments?: unknown; customerCreditAmount?: unknown }) => input.payments !== undefined || input.customerCreditAmount !== undefined;
  // With the fiado switch off, a delivered TRACKED sale must be fully paid (no due date is set).
  async function requirePaid(tx: any, userId: string, saleId: string) {
    const { figures } = await saleMoneyState(tx, userId, saleId);
    if (figures.balance > 0n && !CREDIT_SALES_ENABLED) throw new Error("SALE_BALANCE_DUE");
  }
  async function trackedResult(tx: any, userId: string, saleId: string) {
    const sale = await tx.sale.findUniqueOrThrow({ where: { id: saleId }, include: saleResultInclude });
    return (await attachPayments(tx, userId, [sale], true))[0];
  }
  // refundNow («Devolver ahora») only exists for TRACKED sales without a customer.
  function checkRefundNow(sale: any, input: { refundNow?: unknown }) {
    if (input.refundNow === undefined) return;
    if (sale.paymentMode !== "TRACKED") throw new Error("LEGACY_SALE_PAYMENTS_UNSUPPORTED");
    if (sale.customerId) throw new Error("REFUND_NOW_REQUIRES_NO_CUSTOMER");
  }
  async function succeed(tx: any, op: { id: string }, updated: unknown) {
    await tx.saleOperation.update({ where: { id: op.id }, data: { status: "SUCCEEDED", completedAt: new Date(), responseSnapshot: jsonSafe(updated) } });
  }
  return {
    // Lock order: account money lock -> users FOR SHARE -> order FOR UPDATE -> (new sale) -> items ORDER BY id FOR UPDATE.
    // The money lock comes first so account closure (money lock -> orders -> catalogs -> users) cannot interleave.
    async convertOrderToSale(userId: string, orderId: string, input: z.infer<typeof convertOrderToSaleSchema>) { input = convertOrderToSaleSchema.parse(input); return database.$transaction(async tx => {
      await lockAccountForMoney(tx, userId);
      await tx.$queryRaw`SELECT o.id FROM orders o JOIN catalogs c ON c.id=o."catalogId" WHERE o.id=${orderId} AND c."userId"=${userId} FOR UPDATE`;
      const existingOperation = await tx.saleOperation.findFirst({ where: { userId, id: input.operationId }, include: { sale: { include: saleResultInclude } } });
      if (existingOperation) { if (existingOperation.type !== "ORDER_CONVERSION" || existingOperation.sale?.userId !== userId || existingOperation.sale?.sourceOrderId !== orderId || !isSameSaleCommand(existingOperation.requestHash, input)) throw new Error("IDEMPOTENCY_CONFLICT"); return { sale: existingOperation.sale, idempotent: true }; }
      // F2a-3c (owner's decision): a converted order becomes a CONFIRMED sale that is charged and delivered from its
      // detail in Historial; delivering in the same call is no longer offered. Earlier receipts still replay above.
      if (input.mode === "DELIVERED") throw new Error("ORDER_CONVERSION_DELIVERY_REMOVED");
      const order = await tx.order.findFirst({ where: { id: orderId, catalog: { userId } }, include: { items: { include: { product: { include: { inventoryItem: { include: { commercialTerms: true } } } } } }, catalog: true } });
      if (!order) throw new Error("ORDER_NOT_FOUND");
      // A second key for an already converted order: the order lock serializes them; answer with a conflict, not a unique-index 500.
      if (await tx.sale.findFirst({ where: { sourceOrderId: orderId, userId }, select: { id: true } })) throw new Error("ORDER_ALREADY_CONVERTED");
      if (!["PENDING", "CONFIRMED"].includes(order.status)) throw new Error("ORDER_STATUS_NOT_CONVERTIBLE");
      const customer = input.customerId ? await findActiveSaleCustomer(tx, userId, input.customerId) : null;
      const bases = order.items.map((line: any) => { const item = line.product?.inventoryItem; if (!line.productId || !item) throw new Error("ORDER_ITEM_NOT_INVENTORY"); return { line, item }; });
      // Confirmed/delivered conversions read stock, terms and cost only after locking the items in id order.
      const locked = input.mode === "DRAFT" ? null : await lockItems(tx, userId, bases.map(row => row.item.id));
      const lines = bases.map(({ line, item: base }) => { const item = locked ? locked.get(base.id) : base; if (!item) throw new Error("ORDER_ITEM_NOT_INVENTORY"); if (!item.commercialTerms) throw new Error("PRICE_REQUIRED"); const currentPrice = Number(item.commercialTerms.unitSalePrice); if (currentPrice !== line.unitPrice && !input.acceptPriceDifference) throw new Error("PRICE_DIFFERENCE_REQUIRES_CONFIRMATION"); const orderPrice = BigInt(line.unitPrice); const discount = 0n; return { line, item, orderPrice, discount, total: orderPrice * BigInt(line.quantity) }; }).sort((a, b) => compare(a.item.id, b.item.id));
      if (locked) for (const row of lines) if (row.item.stock < row.line.quantity) throw new Error("STOCK_INSUFFICIENT");
      // Every confirmed conversion records its payments (TRACKED); without payments it is an advance of 0.
      const tracked = input.mode !== "DRAFT";
      if (tracked && input.customerCreditAmount !== undefined && !customer) throw new Error("CUSTOMER_REQUIRED_FOR_CREDIT");
      const subtotal = lines.reduce((sum: bigint, row: any) => sum + row.total, 0n);
      const sale = await tx.sale.create({ data: { userId, sourceOrderId: order.id, customerId: customer?.id ?? null, ...orderBuyerSnapshots(order), customerName: order.customerName, customerPhone: order.customerPhone, subtotal, discountTotal: 0n, total: subtotal, status: "DRAFT" } });
      const saleLines = new Map();
      for (const row of lines) saleLines.set(row.item.id, await tx.saleLine.create({ data: { saleId: sale.id, inventoryItemId: row.item.id, quantity: row.line.quantity, itemName: row.item.name, sku: row.item.sku, unitPrice: row.orderPrice, unitCost: row.item.commercialTerms.referenceUnitCost, unitDiscount: row.discount, lineTotal: row.total, commercialTermsVersion: row.item.commercialTerms.version } }));
      const op = await tx.saleOperation.create({ data: { id: input.operationId, saleId: sale.id, userId, type: "ORDER_CONVERSION", requestId: input.requestId, expectedSaleVersion: 1, requestHash: saleCommandHash(input), status: "PREPARED" } });
      if (input.mode !== "DRAFT") {
        for (const row of lines) { await tx.inventoryItem.update({ where: { id: row.item.id }, data: { stock: { decrement: row.line.quantity }, stockVersion: { increment: 1 } } }); await tx.inventoryMovement.create({ data: { itemId: row.item.id, saleId: sale.id, saleLineId: saleLines.get(row.item.id).id, saleMovementRole: "SALE_CONFIRMATION", key: input.operationId, type: "OUT", quantity: row.line.quantity, previousStock: row.item.stock, resultingStock: row.item.stock - row.line.quantity, delta: -row.line.quantity, reason: "Conversión de pedido", actorUserId: userId, origin: "SALE" } }); }
        await tx.sale.update({ where: { id: sale.id }, data: { status: input.mode, confirmedAt: new Date(), deliveredAt: input.mode === "DELIVERED" ? new Date() : null, version: { increment: 1 }, ...(tracked ? { paymentMode: "TRACKED" } : {}) } });
        if (tracked) {
          await recordPayments(tx, ledgerWriter(tx, userId, input.operationId), userId, sale.id, input.payments ?? [], input.customerCreditAmount);
        }
      }
      const result = tracked ? await trackedResult(tx, userId, sale.id) : await tx.sale.findUniqueOrThrow({ where: { id: sale.id }, include: saleResultInclude });
      await succeed(tx, op, result); return { sale: result, idempotent: false };
    }); },
    // Reads add the server-calculated `payments` block (summary in the list, movements and customer credit in the detail).
    async list(userId: string) { return database.$transaction(async tx => { await lockInventoryOwner(tx, userId); return attachPayments(tx, userId, await tx.sale.findMany({ where: { userId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 50, include: saleCustomerInclude(userId) }), false); }); },
    async get(userId: string, saleId: string) { return database.$transaction(async tx => { await lockInventoryOwner(tx, userId); return (await attachPayments(tx, userId, [await own(tx, userId, saleId)], true))[0]; }); },
    create: (userId: string, input: z.infer<typeof createSaleSchema>) => createInternalSale(userId, input, database),
    updateDraft: (userId: string, saleId: string, input: z.infer<typeof updateDraftSaleSchema>) => updateInternalSaleDraft(userId, saleId, input, database),
    async confirm(userId: string, saleId: string, input: z.input<typeof confirmSaleSchema>) { return database.$transaction(async tx => {
      const { sale, replayed } = await begin(tx, userId, saleId, input, "CONFIRM"); if (replayed !== undefined) return replayed;
      // F2a-3c: every new confirmation records how it was paid (TRACKED). An advance of 0 is payments: [].
      // Receipts of earlier confirmations without payments still replay above.
      if (!tracks(input)) throw new Error("PAYMENTS_REQUIRED");
      if (sale.status !== "DRAFT" || sale.version !== input.expectedVersion) throw new Error("VERSION_CONFLICT");
      const op = await operation(tx, userId, saleId, input, "CONFIRM");
      const lines = byItem(sale.lines); const items = await lockItems(tx, userId, lines.map(line => line.inventoryItemId));
      for (const line of lines) { const item = items.get(line.inventoryItemId); if (!item || item.stock < line.quantity) throw new Error("STOCK_INSUFFICIENT"); if (!item.commercialTerms || item.commercialTerms.version !== line.commercialTermsVersion) throw new Error("PRICE_CHANGED"); }
      for (const line of lines) { const item = items.get(line.inventoryItemId); await tx.inventoryItem.update({ where: { id: item.id }, data: { stock: { decrement: line.quantity }, stockVersion: { increment: 1 } } }); await tx.inventoryMovement.create({ data: { itemId: item.id, saleId, saleLineId: line.id, saleMovementRole: "SALE_CONFIRMATION", key: input.operationId, type: "OUT", quantity: line.quantity, previousStock: item.stock, resultingStock: item.stock - line.quantity, delta: -line.quantity, reason: "Confirmación de venta", actorUserId: userId, origin: "SALE" } }); }
      const status = input.deliverImmediately ? "DELIVERED" : "CONFIRMED";
      await tx.sale.update({ where: { id: saleId }, data: { status, confirmedAt: new Date(), deliveredAt: input.deliverImmediately ? new Date() : null, version: { increment: 1 }, paymentMode: "TRACKED" }, include: saleResultInclude });
      await recordPayments(tx, ledgerWriter(tx, userId, input.operationId), userId, saleId, input.payments, input.customerCreditAmount);
      if (input.deliverImmediately) await requirePaid(tx, userId, saleId);
      const result = await trackedResult(tx, userId, saleId);
      await succeed(tx, op, result); return result;
    }); },
    async transition(userId: string, saleId: string, input: z.infer<typeof deliverSaleSchema>) { return database.$transaction(async tx => {
      const { sale, replayed } = await begin(tx, userId, saleId, input, "DELIVER"); if (replayed !== undefined) return replayed;
      if (sale.status !== "CONFIRMED" || sale.version !== input.expectedVersion) throw new Error("INVALID_TRANSITION");
      if (tracks(input) && sale.paymentMode !== "TRACKED") throw new Error("LEGACY_SALE_PAYMENTS_UNSUPPORTED");
      const op = await operation(tx, userId, saleId, input, "DELIVER");
      const updated = await tx.sale.update({ where: { id: saleId }, data: { status: "DELIVERED", deliveredAt: new Date(), version: { increment: 1 } }, include: saleResultInclude });
      if (sale.paymentMode !== "TRACKED") { await succeed(tx, op, updated); return updated; }
      if (tracks(input)) await recordPayments(tx, ledgerWriter(tx, userId, input.operationId), userId, saleId, input.payments, input.customerCreditAmount);
      await requirePaid(tx, userId, saleId);
      const result = await trackedResult(tx, userId, saleId);
      await succeed(tx, op, result); return result;
    }); },
    // Only CONFIRMED sales are cancelled. A DELIVERED sale is corrected with a return.
    async cancel(userId: string, saleId: string, input: z.infer<typeof cancelSaleSchema>) { return database.$transaction(async tx => {
      const { sale, replayed } = await begin(tx, userId, saleId, input, "CANCEL"); if (replayed !== undefined) return replayed;
      if (sale.status !== "CONFIRMED" || sale.version !== input.expectedVersion) throw new Error("INVALID_TRANSITION");
      checkRefundNow(sale, input);
      const op = await operation(tx, userId, saleId, input, "CANCEL");
      const lines = byItem(sale.lines); const items = await lockItems(tx, userId, lines.map(line => line.inventoryItemId));
      for (const line of lines) { const item = items.get(line.inventoryItemId); if (!item) throw new Error("ITEM_NOT_FOUND"); await tx.inventoryItem.update({ where: { id: item.id }, data: { stock: { increment: line.quantity }, stockVersion: { increment: 1 } } }); await tx.inventoryMovement.create({ data: { itemId: item.id, saleId, saleLineId: line.id, saleMovementRole: "SALE_CANCELLATION", key: input.operationId, type: "IN", quantity: line.quantity, previousStock: item.stock, resultingStock: item.stock + line.quantity, delta: line.quantity, reason: input.reason, actorUserId: userId, origin: "SALE" } }); }
      const updated = await tx.sale.update({ where: { id: saleId }, data: { status: "CANCELLED", cancelledAt: new Date(), version: { increment: 1 } }, include: saleResultInclude });
      if (sale.paymentMode !== "TRACKED") { await succeed(tx, op, updated); return updated; }
      // Everything received is excess: to the customer's credit balance, or «por devolver» / refundNow without a customer.
      await settleSale(tx, ledgerWriter(tx, userId, input.operationId), userId, saleId, { refundNow: input.refundNow, reason: input.reason });
      const result = await trackedResult(tx, userId, saleId);
      await succeed(tx, op, result); return result;
    }); },
    // Partial, cumulative returns. Each call is one SaleReturn with its own receipt, reason and movements.
    // The sale stays DELIVERED until every unit of every line has been returned, then becomes RETURNED.
    async returnSale(userId: string, saleId: string, input: z.infer<typeof returnSaleSchema>) { return database.$transaction(async tx => {
      const { sale, replayed } = await begin(tx, userId, saleId, input, "RETURN"); if (replayed !== undefined) return replayed;
      if (sale.status !== "DELIVERED" || sale.version !== input.expectedVersion) throw new Error("INVALID_TRANSITION");
      if (new Set(input.lines.map(line => line.saleLineId)).size !== input.lines.length) throw new Error("RETURN_LINE_DUPLICATE");
      checkRefundNow(sale, input);
      // Under the Sale lock no other return of this sale can interleave; the database trigger re-checks per line.
      const previous = await tx.saleReturnLine.findMany({ where: { saleLineId: { in: sale.lines.map(l => l.id) } }, select: { saleLineId: true, receivedQuantity: true } });
      const returned = new Map<string, number>();
      for (const row of previous) returned.set(row.saleLineId, (returned.get(row.saleLineId) ?? 0) + row.receivedQuantity);
      const rows = input.lines.map(line => { const saleLine = sale.lines.find(l => l.id === line.saleLineId); if (!saleLine) throw new Error("RETURN_LINE_NOT_FOUND"); if ((returned.get(saleLine.id) ?? 0) + line.receivedQuantity > saleLine.quantity) throw new Error("RETURN_EXCEEDS_SOLD"); return { line, saleLine }; }).sort((a, b) => compare(a.saleLine.inventoryItemId, b.saleLine.inventoryItemId));
      const op = await operation(tx, userId, saleId, input, "RETURN");
      const items = await lockItems(tx, userId, rows.filter(row => row.line.resellableQuantity).map(row => row.saleLine.inventoryItemId));
      const ret = await tx.saleReturn.create({ data: { saleId, userId, operationId: input.operationId, reason: input.reason } });
      for (const { line, saleLine } of rows) { await tx.saleReturnLine.create({ data: { returnId: ret.id, saleLineId: line.saleLineId, receivedQuantity: line.receivedQuantity, resellableQuantity: line.resellableQuantity, damagedQuantity: line.damagedQuantity } }); returned.set(saleLine.id, (returned.get(saleLine.id) ?? 0) + line.receivedQuantity); if (line.resellableQuantity) { const item = items.get(saleLine.inventoryItemId); if (!item) throw new Error("ITEM_NOT_FOUND"); await tx.inventoryItem.update({ where: { id: item.id }, data: { stock: { increment: line.resellableQuantity }, stockVersion: { increment: 1 } } }); await tx.inventoryMovement.create({ data: { itemId: item.id, saleId, saleLineId: saleLine.id, saleMovementRole: "SALE_RETURN_RESELLABLE", key: input.operationId, type: "IN", quantity: line.resellableQuantity, previousStock: item.stock, resultingStock: item.stock + line.resellableQuantity, delta: line.resellableQuantity, reason: input.reason, actorUserId: userId, origin: "SALE" } }); item.stock += line.resellableQuantity; } }
      const complete = sale.lines.every(l => (returned.get(l.id) ?? 0) === l.quantity);
      const updated = await tx.sale.update({ where: { id: saleId }, data: { ...(complete ? { status: "RETURNED", returnedAt: new Date() } : {}), version: { increment: 1 } }, include: saleResultInclude });
      if (sale.paymentMode !== "TRACKED") { await succeed(tx, op, updated); return updated; }
      // The return lowers the effective total first against what is owed; only what was paid beyond it is excess.
      await settleSale(tx, ledgerWriter(tx, userId, input.operationId), userId, saleId, { refundNow: input.refundNow, reason: input.reason });
      const result = await trackedResult(tx, userId, saleId);
      await succeed(tx, op, result); return result;
    }); },
  };
}
