import { prisma } from "../config/prisma";
import { lockCatalogWrites } from "./catalog-write-lock";
import { createBannerSchema, type BannerInput } from "../schemas/catalog-banner.schema";
import type { Prisma } from "@prisma/client";

async function validateTarget(tx: Prisma.TransactionClient, catalogId: string, data: BannerInput) {
  if (data.linkType === "PRODUCT" && !await tx.product.findFirst({ where: { id: data.linkValue, catalogId, active: true }, select: { id: true } })) throw new Error("BANNER_TARGET_INVALID");
  if (data.linkType === "CATEGORY" && !await tx.category.findFirst({ where: { id: data.linkValue, catalogId, active: true }, select: { id: true } })) throw new Error("BANNER_TARGET_INVALID");
}

export async function listBanners(catalogId: string, userId: string, database = prisma) {
  if (!await database.catalog.findFirst({ where: { id: catalogId, userId }, select: { id: true } })) throw new Error("CATALOG_NOT_FOUND");
  return database.catalogBanner.findMany({ where: { catalogId, catalog: { userId } }, orderBy: [{ position: "asc" }, { id: "asc" }] });
}

export async function saveBanner(catalogId: string, userId: string, id: string | undefined, input: Partial<BannerInput>, imagePath?: string, database = prisma) {
  return database.$transaction(async tx => {
    await lockCatalogWrites(tx, catalogId, userId);
    const current = id ? await tx.catalogBanner.findFirst({ where: { id, catalogId, catalog: { userId } } }) : null;
    if (id && !current) throw new Error("BANNER_NOT_FOUND");
    const data = createBannerSchema.parse({ ...current, ...input });
    await validateTarget(tx, catalogId, data);
    const banners = await tx.catalogBanner.findMany({ where: { catalogId }, select: { id: true, position: true } });
    if (!current && banners.length >= 3) throw new Error("BANNER_LIMIT");
    const position = data.position ?? [0, 1, 2].find(slot => !banners.some(banner => banner.position === slot));
    if (position === undefined || banners.some(banner => banner.position === position && banner.id !== id)) throw new Error("BANNER_POSITION_OCCUPIED");
    const path = imagePath ?? current?.imagePath;
    if (!path) throw new Error("BANNER_IMAGE_REQUIRED");
    const write = { ...data, position, imagePath: path };
    const banner = current
      ? await tx.catalogBanner.update({ where: { id: current.id }, data: write })
      : await tx.catalogBanner.create({ data: { ...write, catalogId } });
    return { banner, previousPath: current?.imagePath ?? null };
  });
}

export async function removeBanner(catalogId: string, userId: string, id: string, database = prisma) {
  return database.$transaction(async tx => {
    await lockCatalogWrites(tx, catalogId, userId);
    const banner = await tx.catalogBanner.findFirst({ where: { id, catalogId, catalog: { userId } } });
    if (!banner) throw new Error("BANNER_NOT_FOUND");
    await tx.catalogBanner.delete({ where: { id: banner.id } });
    return banner.imagePath;
  });
}

export async function reorderBanners(catalogId: string, userId: string, ids: string[], database = prisma) {
  return database.$transaction(async tx => {
    await lockCatalogWrites(tx, catalogId, userId);
    const banners = await tx.catalogBanner.findMany({ where: { catalogId }, select: { id: true } });
    if (new Set(ids).size !== ids.length || banners.length !== ids.length || banners.some(banner => !ids.includes(banner.id))) throw new Error("BANNER_ORDER_INVALID");
    for (const [position, id] of ids.entries()) await tx.catalogBanner.update({ where: { id }, data: { position } });
    return { count: ids.length };
  });
}

export async function featuredStatus(catalogId: string, userId: string, database = prisma) {
  if (!await database.catalog.findFirst({ where: { id: catalogId, userId }, select: { id: true } })) throw new Error("CATALOG_NOT_FOUND");
  const products = await database.product.findMany({ where: { catalogId, catalog: { userId }, featured: true }, select: { id: true, name: true, active: true }, orderBy: [{ createdAt: "desc" }, { id: "asc" }] });
  const validCount = products.filter(product => product.active).length;
  return { products, selectedCount: products.length, validCount, visible: validCount >= 3 && validCount <= 5,
    warning: products.length > 0 && validCount < 3 ? "Selecciona al menos tres productos activos para mostrar los destacados." : null };
}
