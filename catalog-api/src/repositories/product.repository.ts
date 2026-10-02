import { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma";

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
  specs?: Prisma.InputJsonValue;
}) {
  return prisma.product.create({
    data,
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
    specs?: Prisma.InputJsonValue;
  }
) {
  return prisma.product.updateMany({
    where: {
      id,
      catalog: {
        userId,
      },
    },
    data,
  });
}

export async function deleteProduct(
  id: string,
  userId: string
) {
  return prisma.product.deleteMany({
    where: {
      id,
      catalog: {
        userId,
      },
    },
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