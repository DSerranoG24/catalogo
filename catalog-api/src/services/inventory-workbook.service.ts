import { createHash } from "node:crypto";
import type { z } from "zod";
import { prisma } from "../config/prisma";
import { lockInventoryOwner } from "../repositories/inventory.repository";
import { workbookSaveSchema } from "../schemas/inventory-workbook.schema";

export function makeInventoryWorkbookService(database = prisma) {
  return {
    async get(userId: string) {
      return database.$transaction(async tx => { await lockInventoryOwner(tx, userId); return tx.inventoryWorkbook.findUnique({ where: { userId }, select: { snapshot: true, version: true, updatedAt: true } }); });
    },
    async save(userId: string, input: z.infer<typeof workbookSaveSchema>) {
      const hash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
      return database.$transaction(async tx => {
        await tx.$executeRaw`SET LOCAL lock_timeout = '2s'`;
        await lockInventoryOwner(tx, userId);
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('inventory-workbook-v1'),hashtext(${userId}))`;
        const previous = await tx.inventoryWorkbookSave.findUnique({ where: { userId_operationId: { userId, operationId: input.operationId } } });
        if (previous) { if (previous.hash !== hash) throw new Error("KEY_CONFLICT"); return { version: previous.version, operationId: input.operationId, replayed: true }; }
        const current = await tx.inventoryWorkbook.findUnique({ where: { userId } });
        if ((current?.version ?? null) !== input.expectedVersion) throw new Error("VERSION_CONFLICT");
        const result = await tx.inventoryWorkbook.upsert({ where: { userId }, create: { userId, snapshot: input.snapshot }, update: { snapshot: input.snapshot, version: { increment: 1 } } });
        await tx.inventoryWorkbookSave.create({ data: { userId, operationId: input.operationId, hash, version: result.version } });
        return { version: result.version, operationId: input.operationId, replayed: false };
      }, { timeout: 10000 });
    },
  };
}
