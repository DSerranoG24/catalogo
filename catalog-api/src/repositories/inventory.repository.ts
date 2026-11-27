import { prisma } from "../config/prisma";
import { Prisma } from "@prisma/client";
import type { z } from "zod";
import { inventoryItemSchema, type InventoryMovementInput } from "../schemas/inventory.schema";
import { inventoryBalance } from "../services/inventory-calculation";
import { randomUUID } from "node:crypto";
import { lockAccountForMoney, lockInventoryOwner } from "./account-lock";

// Kept here for its existing importers; the implementation lives with the account lock order.
export { lockInventoryOwner };

type BatchMovement = { id: string; rowId: string; operationId: string };
function movementData(userId: string, itemId: string, previousStock: number, input: InventoryMovementInput, batch?: BatchMovement) {
  const resultingStock = inventoryBalance(previousStock, input);
  return { ...input, itemId, previousStock, resultingStock, delta: resultingStock - previousStock, actorUserId: userId,
    origin: batch ? "INVENTORY_BATCH" : "MANUAL", batchId: batch?.id ?? null, batchRowId: batch?.rowId ?? null, batchOperationId: batch?.operationId ?? null };
}

export async function lockInventoryIdentity(tx: Prisma.TransactionClient, userId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('inventory-identity-v1'), hashtext(${userId}))`;
}

type InventoryWithTerms = Prisma.InventoryItemGetPayload<{ include: { commercialTerms: true } }>;
export function inventoryItemView(item: InventoryWithTerms) {
  return { id: item.id, name: item.name, sku: item.sku, stock: item.stock, minimumStock: item.minimumStock, dataVersion: item.dataVersion, stockVersion: item.stockVersion,
    commercialTerms: item.commercialTerms ? { unitSalePrice: item.commercialTerms.unitSalePrice.toString(), referenceUnitCost: item.commercialTerms.referenceUnitCost?.toString() ?? null, currency: "COP" as const, version: item.commercialTerms.version } : null };
}

export async function applyInventoryMovement(tx: Prisma.TransactionClient, userId: string, itemId: string, input: InventoryMovementInput, batch?: { id: string; rowId: string; operationId: string }) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM inventory_items WHERE id = ${itemId} AND "userId" = ${userId} FOR UPDATE`;
  if (!rows.length) throw new Error("NOT_FOUND");
  const existing = await tx.inventoryMovement.findUnique({ where: { itemId_key: { itemId, key: input.key } } });
  if (existing) {
    if (existing.type !== input.type || existing.quantity !== input.quantity || existing.reason !== input.reason || existing.batchId !== (batch?.id ?? null)) throw new Error("KEY_CONFLICT");
    return existing;
  }
  const item = await tx.inventoryItem.findUniqueOrThrow({ where: { id: itemId } });
  const data = movementData(userId, itemId, item.stock, input, batch);
  await tx.inventoryItem.update({ where: { id: itemId }, data: { stock: data.resultingStock, stockVersion: { increment: 1 } } });
  return tx.inventoryMovement.create({ data });
}

// The caller holds owner, batch and identity locks. Both entry points calculate
// through the same ledger rules; batch receipts handle replay before this write.
export async function applyInventoryBatchMovements(tx: Prisma.TransactionClient, userId: string, requests: { itemId: string; input: InventoryMovementInput; batch: BatchMovement }[]) {
  if (!requests.length) return [];
  const ids = requests.map(row => row.itemId);
  if (new Set(ids).size !== ids.length || ids.length > 500) throw new Error("BATCH_LIMIT");
  const items = await tx.$queryRaw<{ id: string; stock: number }[]>(Prisma.sql`SELECT id,stock FROM inventory_items WHERE "userId"=${userId} AND id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`);
  const byId = new Map(items.map(item => [item.id, item]));
  const data = requests.map(row => { const item = byId.get(row.itemId); if (!item) throw new Error("NOT_FOUND"); return { id: randomUUID(), ...movementData(userId, row.itemId, item.stock, row.input, row.batch) }; });
  const changes = JSON.stringify(data.map(row => ({ id: row.itemId, stock: row.resultingStock })));
  const count = await tx.$executeRaw`UPDATE inventory_items i SET stock=x.stock,"stockVersion"=i."stockVersion"+1,"updatedAt"=CURRENT_TIMESTAMP FROM jsonb_to_recordset(${changes}::jsonb) AS x(id text,stock integer) WHERE i.id=x.id AND i."userId"=${userId}`;
  if (count !== data.length) throw new Error("STALE_BATCH");
  await tx.inventoryMovement.createMany({ data }); return data;
}

function sameInventoryItem(item: { name: string; sku: string; minimumStock: number }, input: z.infer<typeof inventoryItemSchema>) {
  return item.name === input.name && item.sku === input.sku && item.minimumStock === input.minimumStock;
}

export async function listInventory(userId: string, page: number, q: string, database = prisma) {
  const term = q.replace(/[\\%_]/g, "\\$&");
  const where = { userId, OR: [{ name: { contains: term, mode: "insensitive" as const } }, { sku: { contains: term, mode: "insensitive" as const } }] };
  return database.$transaction(async tx => ({
    items: (await tx.inventoryItem.findMany({ where, include: { commercialTerms: true }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * 24, take: 24 })).map(inventoryItemView),
    total: await tx.inventoryItem.count({ where }), page,
  }), { isolationLevel: "RepeatableRead" });
}

export async function createInventory(userId: string, input: z.infer<typeof inventoryItemSchema>, database = prisma) {
  try {
    return await database.$transaction(async tx => {
      await lockInventoryOwner(tx, userId);
      await lockInventoryIdentity(tx, userId);
      const existing = await tx.inventoryItem.findFirst({ where: { id: input.id, userId } });
      if (existing) {
        if (!sameInventoryItem(existing, input)) throw new Error("KEY_CONFLICT");
        return existing;
      }
      return tx.inventoryItem.create({ data: { ...input, userId } });
    });
  } catch (error) {
    // A concurrent identical insert may win after the initial read. Recover only an owned match.
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
    const existing = await database.inventoryItem.findFirst({ where: { id: input.id, userId, user: { closedAt: null } } });
    if (!existing || !sameInventoryItem(existing, input)) throw error;
    return existing;
  }
}

export async function moveInventory(userId: string, itemId: string, input: InventoryMovementInput, database = prisma) {
  return database.$transaction(async tx => {
    // Moves stock: account money lock, then users FOR SHARE, then the item (Agents.md, lock order).
    await lockAccountForMoney(tx, userId);
    return applyInventoryMovement(tx, userId, itemId, input);
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
