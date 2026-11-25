import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../config/prisma";
import { lockInventoryOwner } from "../repositories/inventory.repository";
import { createSaleSchema, updateDraftSaleSchema } from "../schemas/sales.schema";
import { isSameSaleCommand, saleCommandHash } from "./sale-operation-hash";

// Read responses (GET /sales, GET /sales/:id) carry every return so the panel can show what
// is returned and pending per line, and the "partially returned" state, after a reload.
export const saleCustomerInclude = (userId: string) => ({
  lines: true,
  returns: { include: { lines: true }, orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }] },
  customer: { where: { ownerId: userId }, select: { id: true, fullName: true, phone: true, email: true, archivedAt: true } },
} satisfies Prisma.SaleInclude);

const emptySnapshot = { customerId: null, customerNameSnapshot: null, customerPhoneSnapshot: null, customerEmailSnapshot: null };

export async function findActiveSaleCustomer(tx: Prisma.TransactionClient, userId: string, customerId: string) {
  // Customer edit/archive must wait until the sale and its snapshot have committed.
  await tx.$queryRaw`SELECT id FROM customers WHERE id = ${customerId} AND "ownerId" = ${userId} FOR SHARE`;
  const customer = await tx.customer.findFirst({ where: { id: customerId, ownerId: userId }, select: { id: true, fullName: true, phone: true, email: true, archivedAt: true } });
  if (!customer) throw new Error("CUSTOMER_NOT_FOUND");
  if (customer.archivedAt) throw new Error("CUSTOMER_ARCHIVED");
  return customer;
}

async function captureCustomer(tx: Prisma.TransactionClient, userId: string, customerId: string) {
  const customer = await findActiveSaleCustomer(tx, userId, customerId);
  return { customerId: customer.id, customerNameSnapshot: customer.fullName, customerPhoneSnapshot: customer.phone,
    customerEmailSnapshot: customer.email, customerName: customer.fullName, customerPhone: customer.phone };
}

export function orderBuyerSnapshots(order: { customerName?: string | null; customerPhone?: string | null; customerEmail?: string | null }) {
  // Match the public order contract; never truncate a legacy buyer's phone.
  if (order.customerPhone && order.customerPhone.length > 24) throw new Error("ORDER_BUYER_PHONE_TOO_LONG");
  return {
    customerNameSnapshot: order.customerName ?? null,
    customerPhoneSnapshot: order.customerPhone ?? null,
    customerEmailSnapshot: order.customerEmail || null,
  };
}

export async function createInternalSale(userId: string, raw: z.infer<typeof createSaleSchema>, database = prisma) {
  const input = createSaleSchema.parse(raw);
  return database.$transaction(async tx => {
    await lockInventoryOwner(tx, userId);
    // Serialize retries before inserting the Sale, including an absent operation key.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('sale-create-v1'), hashtext(${userId}))`;
    // Same operationId + same content (any requestId) replays; same operationId + other content conflicts.
    const previous = await tx.saleOperation.findFirst({ where: { userId, id: input.operationId } });
    if (previous) {
      if (previous.type !== "CREATE" || !isSameSaleCommand(previous.requestHash, input)) throw new Error("IDEMPOTENCY_CONFLICT");
      const sale = await tx.sale.findFirst({ where: { id: previous.saleId, userId }, include: saleCustomerInclude(userId) });
      if (!sale) throw new Error("NOT_FOUND");
      return sale;
    }
    const customer = input.customerId ? await captureCustomer(tx, userId, input.customerId) : {
      ...emptySnapshot, customerName: input.customerName, customerPhone: input.customerPhone,
    };
    const sale = await tx.sale.create({ data: { userId, ...customer }, include: saleCustomerInclude(userId) });
    await tx.saleOperation.create({ data: { id: input.operationId, requestId: input.requestId, saleId: sale.id, userId,
      type: "CREATE", requestHash: saleCommandHash(input), status: "SUCCEEDED", completedAt: new Date() } });
    return sale;
  });
}

export async function updateInternalSaleDraft(userId: string, saleId: string, raw: z.infer<typeof updateDraftSaleSchema>, database = prisma) {
  const input = updateDraftSaleSchema.parse(raw);
  return database.$transaction(async tx => {
    await lockInventoryOwner(tx, userId);
    await tx.$queryRaw`SELECT id FROM "Sale" WHERE id = ${saleId} AND "userId" = ${userId} FOR UPDATE`;
    const sale = await tx.sale.findFirst({ where: { id: saleId, userId }, include: saleCustomerInclude(userId) });
    if (!sale) throw new Error("NOT_FOUND");
    const previous = await tx.saleOperation.findFirst({ where: { saleId, userId, id: input.operationId } });
    if (previous) {
      if (previous.type !== "UPDATE_DRAFT" || !isSameSaleCommand(previous.requestHash, input)) throw new Error("IDEMPOTENCY_CONFLICT");
      return sale;
    }
    if (sale.status !== "DRAFT") throw new Error("INVALID_TRANSITION");
    if (sale.version !== input.expectedVersion) throw new Error("VERSION_CONFLICT");
    let customer: Prisma.SaleUncheckedUpdateInput = {};
    if (input.customerId !== undefined && input.customerId !== sale.customerId) {
      customer = input.customerId ? await captureCustomer(tx, userId, input.customerId) : {
        ...emptySnapshot, customerName: input.customerName ?? null, customerPhone: input.customerPhone ?? null,
      };
    } else if (!sale.customerId) {
      customer = { customerName: input.customerName, customerPhone: input.customerPhone };
    }
    const items = await tx.inventoryItem.findMany({ where: { userId, id: { in: input.lines.map(line => line.inventoryItemId) } }, include: { commercialTerms: true } });
    if (items.length !== input.lines.length) throw new Error("ITEM_NOT_FOUND");
    await tx.saleLine.deleteMany({ where: { saleId } });
    let subtotal = 0n, discountTotal = 0n;
    for (const line of input.lines) {
      const item = items.find(item => item.id === line.inventoryItemId);
      if (!item?.commercialTerms) throw new Error("PRICE_REQUIRED");
      const price = item.commercialTerms.unitSalePrice, discount = BigInt(line.unitDiscount);
      if (discount > price) throw new Error("INVALID_DISCOUNT");
      const lineTotal = (price - discount) * BigInt(line.quantity);
      subtotal += price * BigInt(line.quantity); discountTotal += discount * BigInt(line.quantity);
      await tx.saleLine.create({ data: { saleId, inventoryItemId: item.id, quantity: line.quantity, itemName: item.name, sku: item.sku,
        unitPrice: price, unitCost: item.commercialTerms.referenceUnitCost, unitDiscount: discount, lineTotal, commercialTermsVersion: item.commercialTerms.version } });
    }
    const updated = await tx.sale.update({ where: { id: saleId, userId }, data: { ...customer, subtotal, discountTotal, total: subtotal - discountTotal, version: { increment: 1 } }, include: saleCustomerInclude(userId) });
    await tx.saleOperation.create({ data: { id: input.operationId, requestId: input.operationId, saleId, userId, type: "UPDATE_DRAFT",
      expectedSaleVersion: input.expectedVersion, requestHash: saleCommandHash(input), status: "SUCCEEDED", completedAt: new Date() } });
    return updated;
  });
}
