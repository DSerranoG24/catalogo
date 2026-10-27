import { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma";
import { lockCatalogWrites } from "./catalog-write-lock";

export async function createProduct(data: {
  catalogId: string;
  categoryId?: string;
  name: string;
  slug: string;
  description?: string;
  brand?: string;
  model?: string;
  sku?: string;
  price: number;
  salePrice?: number | null;
  saleStartsAt?: Date | null;
  saleEndsAt?: Date | null;
  stock?: number;
  featured?: boolean;
  specs?: Prisma.InputJsonValue;
}, userId: string, database = prisma) {
  return database.$transaction(async tx => {
    await lockCatalogWrites(tx, data.catalogId, userId);
    if (data.featured && await tx.product.count({ where: { catalogId: data.catalogId, featured: true } }) >= 5) throw new Error("FEATURED_LIMIT");
    return tx.product.create({ data });
  });
}

export async function findProductsByCatalog(
  catalogId: string,
  userId: string
) {
  return prisma.product.findMany({
    where: {
      catalogId,
      catalog: {
        userId,
      },
    },
    include: {
      category: true,
      images: {
        orderBy: {
          position: "asc",
        },
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });
}

export async function findProductById(
  id: string,
  userId: string
) {
  return prisma.product.findFirst({
    where: {
      id,
      catalog: {
        userId,
      },
    },
    include: {
      category: true,
      images: {
        orderBy: {
          position: "asc",
        },
      },
    },
  });
}

export async function updateProduct(
  id: string,
  userId: string,
  data: {
    categoryId?: string;
    name?: string;
    slug?: string;
    description?: string;
    brand?: string;
    model?: string;
    sku?: string;
    price?: number;
    salePrice?: number | null;
    saleStartsAt?: Date | null;
    saleEndsAt?: Date | null;
    stock?: number;
    active?: boolean;
    featured?: boolean;
    specs?: Prisma.InputJsonValue;
  },
  database = prisma
) {
  return database.$transaction(async tx => {
    const current = await tx.product.findFirst({ where: { id, catalog: { userId } }, select: { catalogId: true } });
    if (!current) return { count: 0 };
    await lockCatalogWrites(tx, current.catalogId, userId);
    if (data.featured === true && await tx.product.count({ where: { catalogId: current.catalogId, featured: true, id: { not: id } } }) >= 5) throw new Error("FEATURED_LIMIT");
    if (data.active === true && await tx.product.findFirst({ where: { id, catalog: { userId }, needsCompletion: true }, select: { id: true } })) throw new Error("PRODUCT_INCOMPLETE");
    return tx.product.updateMany({
      where: { id, catalog: { userId } },
      data,
    });
  });
}

export async function deleteProduct(
  id: string,
  userId: string,
  database = prisma
) {
  return database.$transaction(async tx => {
    const current = await tx.product.findFirst({ where: { id, catalog: { userId } }, select: { catalogId: true } });
    if (!current) return { count: 0 };
    await lockCatalogWrites(tx, current.catalogId, userId);
    return tx.product.deleteMany({
      where: { id, catalog: { userId } },
    });
  });
}

export async function findCatalogOwner(
  catalogId: string,
  userId: string
) {
  return prisma.catalog.findFirst({
    where: {
      id: catalogId,
      userId,
    },
  });
}

export async function findCategoryInCatalog(
  categoryId: string,
  catalogId: string
) {
  return prisma.category.findFirst({
    where: {
      id: categoryId,
      catalogId,
    },
  });
}
