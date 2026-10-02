import { prisma } from "../config/prisma";

export async function createCatalog(data: {
  userId: string;
  name: string;
  slug: string;
  description?: string;
  whatsappPhone?: string;
  template?: "EDITORIAL" | "GRID" | "BOUTIQUE";
}) {
  return prisma.catalog.create({
    data,
  });
}

export async function findCatalogsByUser(userId: string) {
  return prisma.catalog.findMany({
    where: {
      userId,
    },
    orderBy: {
      createdAt: "desc",
    },
  });
}

export async function findCatalogById(
  id: string,
  userId: string
) {
  return prisma.catalog.findFirst({
    where: {
      id,
      userId,
    },
  });
}

export async function updateCatalog(
  id: string,
  userId: string,
  data: {
    name?: string;
    slug?: string;
    description?: string;
    active?: boolean;
    whatsappPhone?: string | null;
    template?: "EDITORIAL" | "GRID" | "BOUTIQUE";
  }
) {
  return prisma.catalog.updateMany({
    where: {
      id,
      userId,
    },
    data,
  });
}

export async function deleteCatalog(
  id: string,
  userId: string
) {
  return prisma.catalog.deleteMany({
    where: {
      id,
      userId,
    },
  });
}

export async function findPublicCatalog(publicId: string) {
  return prisma.catalog.findFirst({
    where: { publicId, active: true },
    select: {
      publicId: true,
      name: true,
      slug: true,
      description: true,
      whatsappPhone: true,
      template: true,
      categories: {
        where: { active: true },
        select: { id: true, name: true, slug: true, imageUrl: true, position: true },
        orderBy: { position: "asc" },
      },
      products: {
        where: { active: true },
        select: {
          id: true,
          categoryId: true,
          name: true,
          slug: true,
          description: true,
          brand: true,
          model: true,
          price: true,
          salePrice: true,
          saleStartsAt: true,
          saleEndsAt: true,
          category: { select: { id: true, name: true } },
          images: {
            select: { id: true, url: true, alt: true, position: true },
            orderBy: { position: "asc" },
          },
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });
}