import { Prisma, Product } from "@prisma/client";
import { prisma } from "../config/prisma";
import { lockCatalogWrites } from "./catalog-write-lock";

export type ImportProduct = Pick<Product, "id" | "catalogId" | "name" | "slug" | "sku" | "price" | "stock" |
  "description" | "brand" | "model" | "categoryId" | "salePrice" | "saleStartsAt" | "saleEndsAt" | "active" | "updatedAt">;
export type ImportCategory = { id: string; name: string; updatedAt: Date };
export type ImportWrite = { name: string; price?: number; stock?: number; sku?: string; description?: string;
  brand?: string; model?: string; categoryId?: string; salePrice?: number | null; saleStartsAt?: Date | null; saleEndsAt?: Date | null };
export interface ImportAccess {
  products(name: string, sku?: string): Promise<ImportProduct[]>;
  categories(name: string): Promise<ImportCategory[]>;
  slugs(base: string): Promise<string[]>;
  create(data: ImportWrite & { slug: string; price: number }): Promise<string>;
  update(id: string, data: ImportWrite): Promise<void>;
}
export interface ProductImportStore {
  authorize(catalogId: string, userId: string): Promise<void>;
  read(catalogId: string): ImportAccess;
  row<T>(catalogId: string, userId: string, work: (access: ImportAccess) => Promise<T>): Promise<T>;
}

// Same whitespace set as String.trim(); NFC preserves accents rather than unaccenting names.
const whitespace = " \t\n\r\f\v\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff";
function accessFor(client: Prisma.TransactionClient, catalogId: string): ImportAccess {
  return {
    products: async (name, sku) => {
      const find = (condition: Prisma.Sql) => client.$queryRaw<ImportProduct[]>(Prisma.sql`
      SELECT id,"catalogId",name,slug,sku,price,stock,description,brand,model,"categoryId",
        "salePrice","saleStartsAt","saleEndsAt",active,"updatedAt" FROM products
      WHERE "catalogId" = ${catalogId} AND ${condition} LIMIT 2`);
      if (sku) {
        const hits = await find(Prisma.sql`btrim(sku, ${whitespace}) = ${sku}`);
        if (hits.length) return hits;
      }
      return find(Prisma.sql`lower(normalize(btrim(name, ${whitespace}), NFC)) = lower(normalize(${name}, NFC))`);
    },
    categories: name => client.$queryRaw<ImportCategory[]>`
      SELECT id,name,"updatedAt" FROM categories WHERE "catalogId" = ${catalogId}
      AND lower(normalize(btrim(name, ${whitespace}), NFC)) = lower(normalize(${name}, NFC)) LIMIT 2
    `,
    slugs: async base => (await client.product.findMany({ where: { catalogId, slug: { startsWith: base } }, select: { slug: true } })).map(p => p.slug),
    create: async data => (await client.product.create({ data: { ...data, catalogId }, select: { id: true } })).id,
    update: async (id, data) => {
      const result = await client.product.updateMany({ where: { id, catalogId }, data });
      if (result.count !== 1) throw new Error("IMPORT_STATE_CHANGED");
    },
  };
}
export const productImportStore: ProductImportStore = {
  authorize: async (catalogId, userId) => {
    const catalog = await prisma.catalog.findFirst({ where: { id: catalogId, userId }, select: { archivedAt: true } });
    if (!catalog) throw new Error("CATALOG_NOT_FOUND");
    if (catalog.archivedAt) throw new Error("CATALOG_ARCHIVED");
  },
  read: catalogId => accessFor(prisma, catalogId),
  row: (catalogId, userId, work) => prisma.$transaction(async tx => {
    await tx.$executeRaw`SET LOCAL lock_timeout = '1000ms'`;
    await tx.$executeRaw`SET LOCAL statement_timeout = '2500ms'`;
    const catalog = await lockCatalogWrites(tx, catalogId, userId);
    if (catalog.archivedAt) throw new Error("CATALOG_ARCHIVED");
    return work(accessFor(tx, catalogId));
  }, { maxWait: 1000, timeout: 3000 }),
};
