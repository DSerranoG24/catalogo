import { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma";
import type { ProductListQuery } from "../schemas/product-list.schema";

const pageInclude = { category: true, images: { take: 1, orderBy: [{ position: "asc" }, { id: "asc" }] } } satisfies Prisma.ProductInclude;
export type ListedProduct = Prisma.ProductGetPayload<{ include: typeof pageInclude }>;

export function productListWhere(catalogId: string, userId: string, query: ProductListQuery): Prisma.ProductWhereInput {
  // Escape LIKE wildcards: a seller's percent/underscore are literal search text.
  const term = query.q.replace(/[\\%_]/g, "\\$&");
  return {
    catalogId, catalog: { userId },
    ...(query.category === "none" ? { categoryId: null } : query.category !== "all" ? { categoryId: query.category } : {}),
    ...(query.status !== "all" ? { active: query.status === "active" } : {}),
    ...(query.stock === "in" ? { stock: { gt: 0 } } : query.stock === "out" ? { stock: 0 } : {}),
    ...(term ? { OR: ["name", "sku", "brand", "model"].map(field => ({ [field]: { contains: term, mode: "insensitive" } })) } : {}),
  };
}

export function productListOrder(query: ProductListQuery): Prisma.ProductOrderByWithRelationInput[] {
  return query.sort === "category"
    ? [{ category: { name: query.order } }, { id: "asc" }]
    : [{ [query.sort]: query.order }, { id: "asc" }];
}

// Split the nullable relation into two bounded reads so NULL stays last in both directions.
export async function readProductPage(tx: Pick<Prisma.TransactionClient, "product">, where: Prisma.ProductWhereInput, query: ProductListQuery) {
  const skip = (query.page - 1) * query.pageSize;
  const orderBy = productListOrder(query);
  if (query.sort !== "category") return tx.product.findMany({ where, include: pageInclude, orderBy, skip, take: query.pageSize });
  const categorized = { AND: [where, { categoryId: { not: null } }] };
  const count = await tx.product.count({ where: categorized });
  const products = skip < count ? await tx.product.findMany({ where: categorized, include: pageInclude, orderBy, skip, take: query.pageSize }) : [];
  if (products.length < query.pageSize) products.push(...await tx.product.findMany({
    where: { AND: [where, { categoryId: null }] }, include: pageInclude, orderBy: [{ id: "asc" }],
    skip: Math.max(0, skip - count), take: query.pageSize - products.length,
  }));
  return products;
}

export async function listProductPage(catalogId: string, userId: string, query: ProductListQuery, database = prisma) {
  return database.$transaction(async tx => {
    if (!await tx.catalog.findFirst({ where: { id: catalogId, userId }, select: { id: true } })) return null;
    const where = productListWhere(catalogId, userId, query);
    const totalProducts = await tx.product.count({ where: { catalogId, catalog: { userId } } });
    const totalFiltered = await tx.product.count({ where });
    const totalPages = Math.max(1, Math.ceil(totalFiltered / query.pageSize));
    const page = Math.min(query.page, totalPages);
    const products = await readProductPage(tx, where, { ...query, page });
    return { products, page, pageSize: query.pageSize, totalProducts, totalFiltered, totalPages };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}

export type ProductSuggestion = Pick<ListedProduct, "id" | "name" | "brand" | "model" | "sku" | "categoryId" | "description">;
export function suggestionSql(catalogId: string, userId: string, q: string) {
  return Prisma.sql`
    SELECT p.id, p.name, p.brand, p.model, p.sku, p."categoryId", p.description
    FROM products p JOIN catalogs c ON c.id = p."catalogId"
    WHERE p."catalogId" = ${catalogId} AND c."userId" = ${userId}
      AND EXISTS (SELECT 1 FROM unnest(ARRAY[p.name, p.sku, p.brand, p.model]) f WHERE strpos(lower(f), lower(${q})) > 0)
    ORDER BY CASE WHEN lower(p.sku) = lower(${q}) THEN 0 WHEN lower(p.name) = lower(${q}) THEN 1
      WHEN EXISTS (SELECT 1 FROM unnest(ARRAY[p.name, p.sku, p.brand, p.model]) f WHERE strpos(lower(f), lower(${q})) = 1) THEN 2 ELSE 3 END,
      p.name ASC, p.id ASC LIMIT 5`;
}
export async function suggestProducts(catalogId: string, userId: string, q: string, database = prisma) {
  if (!await database.catalog.findFirst({ where: { id: catalogId, userId }, select: { id: true } })) return null;
  return database.$queryRaw<ProductSuggestion[]>(suggestionSql(catalogId, userId, q));
}
