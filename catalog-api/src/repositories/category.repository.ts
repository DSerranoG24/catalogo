import { prisma } from "../config/prisma";

export async function createCategory(data: {
  catalogId: string;
  name: string;
  slug: string;
  position?: number;
}) {
  return prisma.category.create({
    data,
  });
}

export async function findCategoriesByCatalog(
  catalogId: string,
  userId: string
) {
  return prisma.category.findMany({
    where: {
      catalogId,
      catalog: {
        userId,
      },
    },
    orderBy: {
      position: "asc",
    },
  });
}

export async function findCategoryById(
  id: string,
  userId: string
) {
  return prisma.category.findFirst({
    where: {
      id,
      catalog: {
        userId,
      },
    },
  });
}

export async function updateCategory(
  id: string,
  userId: string,
  data: {
    name?: string;
    slug?: string;
    position?: number;
    active?: boolean;
    imageUrl?: string | null;
  }
) {
  return prisma.category.updateMany({
    where: {
      id,
      catalog: {
        userId,
      },
    },
    data,
  });
}

export async function deleteCategory(
  id: string,
  userId: string
) {
  return prisma.category.deleteMany({
    where: {
      id,
      catalog: {
        userId,
      },
    },
  });
}

export async function catalogBelongsToUser(catalogId: string, userId: string) {
  return prisma.catalog.findFirst({
    where: { id: catalogId, userId },
    select: { id: true },
  });
}