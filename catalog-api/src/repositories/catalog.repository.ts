import { prisma } from "../config/prisma";
import { quotationCatalogFieldsSchema } from "../schemas/catalog.schema";
import { assertCatalogThemeCompatibility } from "../schemas/catalog-theme";
import { resolvePublicHighlights } from "../services/public-catalog-highlights";

export async function createCatalog(data: {
  userId: string;
  name: string;
  slug: string;
  description?: string | null;
  nit?: string | null;
  quotationTerms?: string | null;
  whatsappMessage?: string | null;
  whatsappPhone?: string;
  phone?: string;
  address?: string;
  businessHours?: string;
  instagramUrl?: string;
  facebookUrl?: string;
  tiktokUrl?: string;
  email?: string;
  mapUrl?: string;
  template?: string;
  themePreset?: string | null;
  layoutPreset?: string | null;
}, database = prisma) {
  assertCatalogThemeCompatibility(data.template ?? "EDITORIAL", data.themePreset);
  return database.catalog.create({
    data: { ...data, ...quotationCatalogFieldsSchema.parse(data) },
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
    nit?: string | null;
    quotationTerms?: string | null;
    whatsappMessage?: string | null;
    logoUrl?: string | null;
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
    template?: string;
    themePreset?: string | null;
    layoutPreset?: string | null;
  },
  database = prisma
) {
  if (data.template !== undefined || data.themePreset !== undefined) {
    return database.$transaction(async (tx) => {
      // Validate the merged pair under the same row lock as its write.
      const rows = await tx.$queryRaw<{ template: string; themePreset: string | null }[]>`
        SELECT template, "themePreset" FROM catalogs
        WHERE id = ${id} AND "userId" = ${userId} FOR UPDATE
      `;
      const current = rows[0];
      if (!current) return { count: 0 };
      assertCatalogThemeCompatibility(
        data.template ?? current.template,
        data.themePreset === undefined ? current.themePreset : data.themePreset
      );
      return tx.catalog.updateMany({
        where: { id, userId },
        data: { ...data, ...quotationCatalogFieldsSchema.parse(data) },
      });
    });
  }
  return database.catalog.updateMany({
    where: {
      id,
      userId,
    },
    data: { ...data, ...quotationCatalogFieldsSchema.parse(data) },
  });
}

export async function archiveCatalog(
  id: string,
  userId: string
) {
  return prisma.catalog.updateMany({
    where: { id, userId },
    data: { archivedAt: new Date() },
  });
}

export async function reactivateCatalog(
  id: string,
  userId: string
) {
  return prisma.catalog.updateMany({
    where: { id, userId },
    data: { archivedAt: null },
  });
}

export async function countCatalogOrders(
  catalogId: string
) {
  return prisma.order.count({ where: { catalogId } });
}

export async function deleteCatalog(
  id: string,
  userId: string
) {
  const orders = await prisma.order.count({ where: { catalogId: id } });
  if (orders > 0) {
    throw new Error("CATALOG_HAS_ORDERS");
  }
  return prisma.catalog.deleteMany({
    where: { id, userId },
  });
}


export async function findPublicCatalog(publicId: string, database = prisma) {
  const catalog = await database.catalog.findFirst({
    where: { publicId, active: true, archivedAt: null },
    select: {
      userId: true,
      publicId: true,
      name: true,
      slug: true,
      description: true,
      logoUrl: true,
      whatsappPhone: true,
      whatsappMessage: true,
      phone: true,
      address: true,
      businessHours: true,
      instagramUrl: true,
      facebookUrl: true,
      tiktokUrl: true,
      email: true,
      mapUrl: true,
      template: true,
      themePreset: true,
      layoutPreset: true,
      banners: {
        where: { active: true },
        select: { id: true, imagePath: true, title: true, subtitle: true, linkType: true, linkValue: true, position: true },
        orderBy: [{ position: "asc" }, { id: "asc" }],
        take: 3,
      },
      categories: {
        where: { active: true },
        select: { id: true, name: true, slug: true, imageUrl: true, position: true },
        orderBy: { position: "asc" },
      },
      products: {
        where: { active: true },
        select: {
          id: true,
          featured: true,
          categoryId: true,
          name: true,
          slug: true,
          description: true,
          brand: true,
          model: true,
          stock: true,
          price: true,
          salePrice: true,
          saleStartsAt: true,
          saleEndsAt: true,
          category: { select: { id: true, name: true } },
          inventoryItem: {
            select: {
              userId: true,
              stock: true,
              commercialTerms: { select: { userId: true, unitSalePrice: true } },
              images: {
                where: { isPrimary: true },
                select: { id: true, storagePath: true, alt: true, position: true },
                orderBy: [{ position: "asc" }, { id: "asc" }],
                take: 1,
              },
            },
          },
          publication: { select: { userId: true, priceOverride: true } },
          images: {
            select: { id: true, url: true, alt: true, position: true },
            orderBy: { position: "asc" },
          },
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });
  if (!catalog) return null;
  const products = catalog.products.flatMap(({ inventoryItem, publication, ...product }) => {
    const ownedInventory = inventoryItem?.userId === catalog.userId ? inventoryItem : null;
    if (inventoryItem && !ownedInventory) return [];
    const ownedTerms = ownedInventory?.commercialTerms?.userId === catalog.userId ? ownedInventory.commercialTerms : null;
    const ownedOverride = publication?.userId === catalog.userId ? publication.priceOverride : null;
    const inventoryPrice = ownedTerms && ownedTerms.unitSalePrice >= 0n && ownedTerms.unitSalePrice <= 2_147_483_647n
      ? Number(ownedTerms.unitSalePrice)
      : null;
    const price = ownedInventory ? ownedOverride ?? inventoryPrice : product.price;
    if (price === null) return [];
    const inheritedImage = ownedInventory?.images[0];
    return [{
      ...product,
      price,
      stock: ownedInventory?.stock ?? product.stock,
      images: inheritedImage
        ? [{ id: inheritedImage.id, url: inheritedImage.storagePath, alt: inheritedImage.alt, position: inheritedImage.position }]
        : product.images,
    }];
  });
  const { userId: _userId, ...publicCatalog } = catalog;
  return { ...publicCatalog, products, ...resolvePublicHighlights(products, catalog.categories, catalog.banners) };
}
