import { prisma } from "../config/prisma";
import { OrderStatus } from "@prisma/client";

function accessFilter(publicId: string, orderId: string, token: string) {
  // Historical quotations remain accessible after catalog archival; cancellation revokes access.
  return { id: orderId, quotationToken: token, anonymizedAt: null, status: { not: OrderStatus.CANCELLED }, catalog: { publicId } };
}

export async function findQuotation(publicId: string, orderId: string, token: string, database = prisma) {
  return database.order.findFirst({
    where: accessFilter(publicId, orderId, token),
    select: {
      id: true, catalogId: true, quotationNumber: true, quotationIssuedAt: true,
      quotationSellerSnapshot: true, customerName: true, customerPhone: true,
      customerAddress: true, total: true,
      items: { select: { productName: true, quantity: true, unitPrice: true, subtotal: true } },
      catalog: { select: { logoUrl: true } },
    },
  });
}

export async function quotationStillAccessible(publicId: string, orderId: string, token: string, database = prisma): Promise<boolean> {
  return (await database.order.findFirst({ where: accessFilter(publicId, orderId, token), select: { id: true } })) !== null;
}
