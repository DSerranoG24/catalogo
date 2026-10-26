import { OrderStatus, Prisma } from "@prisma/client";
import { prisma } from "../config/prisma";
import { recoverIdempotentOrder } from "./order-idempotency";
import { calculatePublicOrder } from "../services/order-calculation";
const publicOrderReceipt = {
  id: true,
  status: true,
  total: true,
  createdAt: true,
  items: { select: { productName: true, quantity: true, unitPrice: true, subtotal: true } },
} satisfies Prisma.OrderSelect;

export async function createPublicOrder(
  publicId: string,
  data: {
    customerName: string;
    customerPhone: string;
    customerEmail?: string;
    customerAddress: string;
    consent: true;
    notes?: string;
    idempotencyKey?: string;
    items: { productId: string; quantity: number }[];
  },
  database = prisma
) {
  const idempotencyKey = data.idempotencyKey;
  return recoverIdempotentOrder(idempotencyKey, () => database.$transaction(async (transaction) => {
    const catalog = await transaction.catalog.findFirst({
      where: { publicId, active: true, archivedAt: null },
      select: { id: true },
    });
    if (!catalog) throw new Error("CATALOG_NOT_FOUND");

    if (idempotencyKey) {
      const existing = await transaction.order.findUnique({
        where: { catalogId_idempotencyKey: { catalogId: catalog.id, idempotencyKey } },
        select: publicOrderReceipt,
      });
      if (existing) return existing;
    }

    const pricingTime = new Date();
    const products = await transaction.product.findMany({
      where: {
        catalogId: catalog.id,
        active: true,
        id: { in: data.items.map((item) => item.productId) },
      },
      select: { id: true, name: true, price: true, salePrice: true, saleStartsAt: true, saleEndsAt: true },
    });
    const { items, total } = calculatePublicOrder(data.items, products, pricingTime);

    return transaction.order.create({
      data: {
        catalogId: catalog.id,
        idempotencyKey,
        customerName: data.customerName,
        customerPhone: data.customerPhone,
        customerEmail: data.customerEmail || null,
        customerAddress: data.customerAddress,
        customerConsentAt: new Date(),
        notes: data.notes,
        total,
        items: { create: items },
      },
      select: publicOrderReceipt,
    });
  }), async () => {
    if (!idempotencyKey) return null;
    const catalog = await database.catalog.findFirst({ where: { publicId, active: true, archivedAt: null }, select: { id: true } });
    if (!catalog) return null;
    const existing = await database.order.findUnique({
      where: { catalogId_idempotencyKey: { catalogId: catalog.id, idempotencyKey } },
      select: publicOrderReceipt,
    });
    return existing;
  });
}

export async function findOrdersByCatalog(catalogId: string, userId: string) {
  return prisma.order.findMany({
    where: { catalogId, catalog: { userId } },
    select: {
      id: true,
      customerName: true,
      customerPhone: true,
      customerEmail: true,
      customerAddress: true,
      customerConsentAt: true,
      notes: true,
      status: true,
      total: true,
      createdAt: true,
      quotationNumber: true,
      items: { select: { productName: true, quantity: true, unitPrice: true, subtotal: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}

export async function findOrderByIdForOwner(id: string, userId: string) {
  return prisma.order.findFirst({
    where: { id, catalog: { userId } },
    select: { id: true, status: true },
  });
}

export async function changeOrderStatus(
  id: string,
  userId: string,
  currentStatus: OrderStatus,
  status: OrderStatus,
  database = prisma
) {
  return database.$transaction(async tx => {
    const result = await tx.order.updateMany({
      where: { id, status: currentStatus, catalog: { userId } },
      data: { status },
    });
    if (result.count === 1 && currentStatus === "PENDING" && status === "CONFIRMED") {
      const [clock] = await tx.$queryRaw<{ confirmedAt: Date }[]>`SELECT CURRENT_TIMESTAMP AS "confirmedAt"`;
      if (!clock) throw new Error("ORDER_CONFIRMATION_CLOCK_UNAVAILABLE");
      await tx.order.updateMany({ where: { id, catalog: { userId }, firstConfirmedAt: null }, data: { firstConfirmedAt: clock.confirmedAt } });
    }
    return result;
  });
}
