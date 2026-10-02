import { OrderStatus } from "@prisma/client";
import { prisma } from "../config/prisma";
import { getCurrentProductPricing } from "../services/product-pricing";

const MAX_INT = 2_147_483_647;

export async function createPublicOrder(
  publicId: string,
  data: {
    customerName: string;
    customerPhone: string;
    customerEmail?: string;
    customerAddress: string;
    consent: true;
    notes?: string;
    items: { productId: string; quantity: number }[];
  }
) {
  return prisma.$transaction(async (transaction) => {
    const catalog = await transaction.catalog.findFirst({
      where: { publicId, active: true },
      select: { id: true },
    });
    if (!catalog) throw new Error("CATALOG_NOT_FOUND");

    const pricingTime = new Date();
    const products = await transaction.product.findMany({
      where: {
        catalogId: catalog.id,
        active: true,
        id: { in: data.items.map((item) => item.productId) },
      },
      select: { id: true, name: true, price: true, salePrice: true, saleStartsAt: true, saleEndsAt: true },
    });
    if (products.length !== data.items.length) throw new Error("PRODUCTS_UNAVAILABLE");

    const productById = new Map(products.map((product) => [product.id, product]));
    const items = data.items.map((item) => {
      const product = productById.get(item.productId)!;
      const price = getCurrentProductPricing(product, pricingTime).price;
      const subtotal = price * item.quantity;
      if (subtotal > MAX_INT) throw new Error("ORDER_TOTAL_INVALID");
      return {
        productId: product.id,
        productName: product.name,
        quantity: item.quantity,
        unitPrice: price,
        subtotal,
      };
    });
    const total = items.reduce((sum, item) => sum + item.subtotal, 0);
    if (total > MAX_INT) throw new Error("ORDER_TOTAL_INVALID");

    return transaction.order.create({
      data: {
        catalogId: catalog.id,
        customerName: data.customerName,
        customerPhone: data.customerPhone,
        customerEmail: data.customerEmail || null,
        customerAddress: data.customerAddress,
        customerConsentAt: new Date(),
        notes: data.notes,
        total,
        items: { create: items },
      },
      select: {
        id: true,
        status: true,
        total: true,
        createdAt: true,
        items: { select: { productName: true, quantity: true, unitPrice: true, subtotal: true } },
      },
    });
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
  status: OrderStatus
) {
  return prisma.order.updateMany({
    where: { id, status: currentStatus, catalog: { userId } },
    data: { status },
  });
}
