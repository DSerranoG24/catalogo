import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { prisma } from "../config/prisma";
import type { AnonymizeOrderInput } from "../schemas/order-privacy.schema";
import { quotationSellerSchema } from "../services/quotation-data";

export const deletedOrderKeyHash = (key: string) => createHash("sha256").update(key, "utf8").digest("hex");

export async function lockOwnedOrder(tx: Prisma.TransactionClient, id: string, userId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT o.id FROM orders o JOIN catalogs c ON c.id = o."catalogId"
    WHERE o.id = ${id} AND c."userId" = ${userId} FOR UPDATE OF o
  `;
  if (rows.length !== 1) throw new Error("ORDER_NOT_FOUND");
}

export async function anonymizeOrder(id: string, userId: string, input: AnonymizeOrderInput, database = prisma) {
  return database.$transaction(async tx => {
    await lockOwnedOrder(tx, id, userId);
    const order = await tx.order.findFirstOrThrow({ where: { id, catalog: { userId } } });
    if (order.status !== "COMPLETED" && order.status !== "CANCELLED") throw new Error("ORDER_NOT_TERMINAL");
    if (order.anonymizedAt) return { anonymizedAt: order.anonymizedAt };
    let snapshot: Prisma.InputJsonValue | undefined;
    if (order.quotationSellerSnapshot !== null) {
      const seller = quotationSellerSchema.parse(order.quotationSellerSnapshot);
      // Only fields explicitly identified by the owner as containing CUSTOMER data are removed.
      for (const field of input.redactSellerFields) {
        if (field === "name") seller.name = "Datos de cliente retirados";
        else seller[field] = null;
      }
      snapshot = seller;
    }
    if (input.redactProductNames) await tx.orderItem.updateMany({ where: { orderId: id }, data: { productName: "Producto (datos personales retirados)" } });
    return tx.order.update({
      where: { id },
      data: { customerName: "Cliente anonimizado", customerPhone: "", customerEmail: null,
        customerAddress: null, notes: null, anonymizedAt: new Date(),
        ...(snapshot === undefined ? {} : { quotationSellerSnapshot: snapshot }) },
      select: { anonymizedAt: true },
    });
  });
}

export async function deletePendingOrder(id: string, userId: string, customerName: string, database = prisma) {
  return database.$transaction(async tx => {
    // Same order -> catalog lock sequence as quotation issuance.
    await lockOwnedOrder(tx, id, userId);
    const order = await tx.order.findFirstOrThrow({ where: { id, catalog: { userId } } });
    if (order.status !== "PENDING") throw new Error("ORDER_NOT_PENDING");
    if (order.customerName !== customerName) throw new Error("ORDER_CONFIRMATION_MISMATCH");
    await tx.$queryRaw`SELECT id FROM catalogs WHERE id = ${order.catalogId} FOR UPDATE`;
    if (order.idempotencyKey) await tx.orderDeletionMarker.upsert({
      where: { catalogId_keyHash: { catalogId: order.catalogId, keyHash: deletedOrderKeyHash(order.idempotencyKey) } },
      create: { catalogId: order.catalogId, keyHash: deletedOrderKeyHash(order.idempotencyKey) }, update: {},
    });
    await tx.order.delete({ where: { id } });
  });
}
