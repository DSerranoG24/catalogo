import { prisma } from "../config/prisma";

export async function createCatalog(data: {
  userId: string;
  name: string;
  slug: string;
  description?: string | null;
  whatsappPhone?: string;
  phone?: string;
  address?: string;
  businessHours?: string;
  instagramUrl?: string;
  facebookUrl?: string;
  tiktokUrl?: string;
  email?: string;
  mapUrl?: string;
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
    description?: string | null;
    active?: boolean;
    whatsappPhone?: string | null;
    phone?: string | null;
    address?: string | null;
    businessHours?: string | null;
    instagramUrl?: string | null;
    facebookUrl?: string | null;
    tiktokUrl?: string | null;
    email?: string | null;
    mapUrl?: string | null;
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
      phone: true,
      address: true,
      businessHours: true,
      instagramUrl: true,
      facebookUrl: true,
      tiktokUrl: true,
      email: true,
      mapUrl: true,
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