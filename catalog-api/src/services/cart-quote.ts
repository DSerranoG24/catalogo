import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma";
import { resolvePublicProductPrice } from "./public-product-price";
import { getCurrentProductPricing } from "./product-pricing";
import { calculatePublicOrder } from "./order-calculation";

export class QuoteChangedError extends Error {
  constructor(readonly quote: Awaited<ReturnType<typeof resolveCartQuote>> | null, readonly code = "QUOTE_CHANGED") {
    super(code);
  }
}

export async function resolveCartQuote(
  tx: Prisma.TransactionClient,
  catalog: { id: string; userId: string },
  requested: { productId: string; quantity: number }[],
  now = new Date(),
) {
  const products = await tx.product.findMany({
    where: { catalogId: catalog.id, active: true, id: { in: requested.map(item => item.productId) } },
    select: {
      id: true, name: true, stock: true, price: true, salePrice: true, saleStartsAt: true, saleEndsAt: true,
      inventoryItemId: true,
      inventoryItem: { select: { userId: true, stock: true, commercialTerms: { select: { userId: true, unitSalePrice: true } } } },
      publication: { select: { id: true, userId: true, inventoryItemId: true, status: true, priceOverride: true } },
    },
  });
  const lines = [...requested].sort((a, b) => a.productId.localeCompare(b.productId)).map(item => {
    const product = products.find(product => product.id === item.productId);
    const basePrice = product ? resolvePublicProductPrice(product, catalog.userId) : null;
    if (!product || basePrice === null) return { productId: item.productId, quantity: item.quantity, product: null };
    let pricing: ReturnType<typeof getCurrentProductPricing>;
    try { pricing = getCurrentProductPricing({ ...product, price: basePrice }, now); }
    catch (error) {
      if (error instanceof Error && error.message === "INVALID_PRODUCT_PROMOTION") return { productId: item.productId, quantity: item.quantity, product: null };
      throw error;
    }
    return {
      productId: item.productId, quantity: item.quantity,
      product: { id: product.id, name: product.name, ...pricing, stock: product.inventoryItem?.stock ?? product.stock },
      inventoryItemId: product.inventoryItemId ?? null,
      publication: product.publication ?? null,
      basePrice,
      promotion: pricing.regularPrice === null ? null : {
        salePrice: product.salePrice, startsAt: product.saleStartsAt, endsAt: product.saleEndsAt,
      },
    };
  });
  const token = "q1." + createHash("sha256").update(JSON.stringify({ catalogId: catalog.id, owner: catalog.userId, lines })).digest("hex");
  return { token, lines: lines.map(({ productId, quantity, product }) => ({ productId, quantity, product })), available: lines.every(line => line.product !== null) };
}

// Lock all mutable sources until the order commits. Product locks also protect its inventory relationship.
export async function lockCartQuote(tx: Prisma.TransactionClient, catalogId: string, items: { productId: string }[]) {
  const ids = Prisma.join(items.map(item => item.productId));
  await tx.$queryRaw(Prisma.sql`SELECT id FROM catalogs WHERE id = ${catalogId} FOR SHARE`);
  await tx.$queryRaw(Prisma.sql`SELECT id FROM "InventoryPublication" WHERE "catalogId" = ${catalogId} AND "productId" IN (${ids}) ORDER BY id FOR SHARE`);
  await tx.$queryRaw(Prisma.sql`SELECT id FROM products WHERE "catalogId" = ${catalogId} AND id IN (${ids}) ORDER BY id FOR UPDATE`);
  await tx.$queryRaw(Prisma.sql`SELECT i.id FROM inventory_items i JOIN products p ON p."inventoryItemId" = i.id WHERE p."catalogId" = ${catalogId} AND p.id IN (${ids}) ORDER BY i.id FOR UPDATE OF i`);
  await tx.$queryRaw(Prisma.sql`SELECT t."itemId" FROM item_commercial_terms t JOIN products p ON p."inventoryItemId" = t."itemId" WHERE p."catalogId" = ${catalogId} AND p.id IN (${ids}) ORDER BY t."itemId" FOR SHARE OF t`);
}

export async function getCartQuote(publicId: string, items: { productId: string; quantity: number }[], database = prisma) {
  return database.$transaction(async tx => {
    const catalog = await tx.catalog.findFirst({ where: { publicId, active: true, archivedAt: null }, select: { id: true, userId: true } });
    if (!catalog) throw new Error("CATALOG_NOT_FOUND");
    await lockCartQuote(tx, catalog.id, items);
    const current = await tx.catalog.findFirst({ where: { id: catalog.id, userId: catalog.userId, active: true, archivedAt: null }, select: { id: true } });
    if (!current) throw new Error("CATALOG_NOT_FOUND");
    return resolveCartQuote(tx, catalog, items);
  });
}

export function quoteOrder(quote: Awaited<ReturnType<typeof resolveCartQuote>>) {
  return calculatePublicOrder(quote.lines.map(line => ({ productId: line.productId, quantity: line.quantity })), quote.lines.flatMap(line => line.product ? [{ ...line.product, salePrice: null, saleStartsAt: null, saleEndsAt: null }] : []));
}
