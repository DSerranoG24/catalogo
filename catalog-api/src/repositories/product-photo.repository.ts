import { prisma } from "../config/prisma";
import { lockCatalogWrites } from "./catalog-write-lock";
import type { PhotoStore } from "../services/product-photo.service";

const select = { id: true, name: true, needsCompletion: true, active: true };
export function photoStore(database = prisma): PhotoStore {
  return {
    owner: (id, userId) => database.catalog.findFirst({ where: { id, userId }, select: { archivedAt: true } }),
    existing: async (id, catalogId, userId) => {
      const result = await database.product.findFirst({ where: { id, catalogId, catalog: { userId } }, select: { ...select,
        images: { take: 1, orderBy: [{ position: "asc" }, { id: "asc" }], select: { url: true } } } });
      if (!result) return null;
      const { images, ...product } = result;
      return { ...product, imagePath: images[0]?.url };
    },
    pending: (catalogId, userId, requested) => database.$transaction(async tx => {
      const where = { catalogId, catalog: { userId }, needsCompletion: true };
      const count = await tx.product.count({ where });
      const pages = Math.max(1, Math.ceil(count / 24)); const page = Math.min(requested, pages);
      const products = await tx.product.findMany({ where, select: { ...select, price: true, categoryId: true, description: true,
        images: { take: 1, orderBy: [{ position: "asc" }, { id: "asc" }], select: { url: true } } },
        orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: 24, skip: (page - 1) * 24 });
      return { products, count, page, pages };
    }, { isolationLevel: "RepeatableRead" }),
    create: data => database.$transaction(async tx => {
      const catalog = await lockCatalogWrites(tx, data.catalogId, data.userId);
      if (catalog.archivedAt) throw new Error("CATALOG_ARCHIVED");
      return tx.product.create({ data: { id: data.id, catalogId: data.catalogId, name: data.name,
        slug: `producto-${data.id}`, price: 0, active: false, needsCompletion: true,
        images: { create: { url: data.path, position: 0 } } }, select });
    }),
    complete: (id, userId, input) => database.$transaction(async tx => {
      const product = await tx.product.findFirst({ where: { id, catalog: { userId } }, select: { catalogId: true } });
      if (!product) throw new Error("PRODUCT_NOT_FOUND");
      const catalog = await lockCatalogWrites(tx, product.catalogId, userId);
      if (catalog.archivedAt) throw new Error("CATALOG_ARCHIVED");
      if (input.categoryId && !await tx.category.findFirst({ where: { id: input.categoryId, catalogId: product.catalogId }, select: { id: true } })) throw new Error("INVALID_PHOTO_CATEGORY");
      // Recheck under the catalog lock; completing twice must not deactivate a published product.
      const current = await tx.product.findFirst({ where: { id, catalog: { userId }, needsCompletion: true }, select });
      if (!current) throw new Error("PRODUCT_ALREADY_COMPLETE");
      return tx.product.update({ where: { id }, data: { name: input.name, price: input.price,
        categoryId: input.categoryId ?? null, description: input.description ?? null, needsCompletion: false, active: false }, select });
    }),
  };
}
