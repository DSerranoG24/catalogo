import { Prisma } from "@prisma/client";

export async function lockCatalogWrites(tx: Prisma.TransactionClient, catalogId: string, userId: string) {
  const rows = await tx.$queryRaw<{ id: string; archivedAt: Date | null }[]>`
    SELECT id, "archivedAt" FROM catalogs
    WHERE id = ${catalogId} AND "userId" = ${userId} FOR UPDATE
  `;
  const catalog = rows[0];
  if (!catalog) throw new Error("CATALOG_NOT_FOUND");
  return catalog;
}

export async function lockHighlightWrites(tx: Prisma.TransactionClient, catalogId: string, userId: string) {
  const catalog = await lockCatalogWrites(tx, catalogId, userId);
  if (catalog.archivedAt) throw new Error("CATALOG_ARCHIVED");
  return catalog;
}
