import { prisma } from "../config/prisma";
import type { z } from "zod";
import { inventoryItemSchema, type InventoryMovementInput } from "../schemas/inventory.schema";
import { inventoryBalance } from "../services/inventory-calculation";

export async function listInventory(userId: string, page: number, q: string, database = prisma) {
  const where = { userId, OR: [{ name: { contains: q, mode: "insensitive" as const } }, { sku: { contains: q, mode: "insensitive" as const } }] };
  return database.$transaction(async tx => ({
    items: await tx.inventoryItem.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * 24, take: 24 }),
    total: await tx.inventoryItem.count({ where }), page,
  }), { isolationLevel: "RepeatableRead" });
}

export async function createInventory(userId: string, input: z.infer<typeof inventoryItemSchema>, database = prisma) {
  return database.$transaction(async tx => {
    const existing = await tx.inventoryItem.findFirst({ where: { id: input.id, userId } });
    if (existing) {
      if (existing.name !== input.name || existing.sku !== input.sku || existing.minimumStock !== input.minimumStock) throw new Error("KEY_CONFLICT");
      return existing;
    }
    return tx.inventoryItem.create({ data: { ...input, userId } });
  });
}

export async function moveInventory(userId: string, itemId: string, input: InventoryMovementInput, database = prisma) {
  return database.$transaction(async tx => {
    // Serialize every balance change, including retries, on the owned item.
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM inventory_items WHERE id = ${itemId} AND "userId" = ${userId} FOR UPDATE`;
    if (!rows.length) throw new Error("NOT_FOUND");
    const existing = await tx.inventoryMovement.findUnique({ where: { itemId_key: { itemId, key: input.key } } });
    if (existing) {
      if (existing.type !== input.type || existing.quantity !== input.quantity || existing.reason !== input.reason) throw new Error("KEY_CONFLICT");
      return existing;
    }
    const item = await tx.inventoryItem.findUniqueOrThrow({ where: { id: itemId } });
    const resultingStock = inventoryBalance(item.stock, input);
    await tx.inventoryItem.update({ where: { id: itemId }, data: { stock: resultingStock } });
    return tx.inventoryMovement.create({ data: { ...input, itemId, previousStock: item.stock, resultingStock } });
  });
}

export async function inventoryHistory(userId: string, itemId: string, page: number, database = prisma) {
  return database.$transaction(async tx => {
    if (!await tx.inventoryItem.findFirst({ where: { id: itemId, userId } })) throw new Error("NOT_FOUND");
    return {
      movements: await tx.inventoryMovement.findMany({ where: { itemId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * 24, take: 24 }),
      total: await tx.inventoryMovement.count({ where: { itemId } }), page,
    };
  }, { isolationLevel: "RepeatableRead" });
}
