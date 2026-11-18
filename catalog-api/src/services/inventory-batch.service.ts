import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../config/prisma";
import { applyInventoryBatchMovements, inventoryItemView, lockInventoryIdentity, lockInventoryOwner } from "../repositories/inventory.repository";
import { batchApplySchema, batchChunkSchema, batchCreateSchema, inventoryEditSchema, inventoryPlanSchema, inventoryTermsSchema, inventoryValuesSchema } from "../schemas/inventory-batch.schema";
import { buildInventoryPlan, canonical, inventoryHash, inventoryJson } from "./inventory-batch-plan";

type Tx = Prisma.TransactionClient;
const batchReceipt = z.object({ batchId: z.uuid(), operationId: z.uuid(), revision: z.number().int(), previewRevision: z.number().int(), planHash: z.string(), appliedAt: z.string(), rows: z.array(z.object({ rowId: z.uuid(), itemId: z.uuid(), action: z.string(), movementId: z.string().nullable(), delta: z.number().int(), stock: z.number().int() })) });
const chunkResult = z.object({ revision: z.number().int(), rows: z.array(z.object({ rowId: z.uuid(), revision: z.number().int() })) });
export function makeInventoryBatchService(database = prisma) {
  async function owned(tx: Tx, userId: string, id: string) {
    const result = await tx.inventoryBatch.findFirst({ where: { id, userId } });
    if (!result) throw new Error("NOT_FOUND"); return result;
  }
  async function batchLock(tx: Tx, userId: string, id: string) {
    await tx.$executeRaw`SET LOCAL lock_timeout = '2s'`;
    await tx.$queryRaw`SELECT id FROM inventory_batches WHERE id=${id} AND "userId"=${userId} FOR UPDATE`;
    return owned(tx, userId, id);
  }
  function editable(status: string) { if (["APPLIED", "CANCELLED"].includes(status)) throw new Error("BATCH_TERMINAL"); }
  async function currentItems(tx: Tx, userId: string, rows: { values: unknown }[]) {
    const candidates = rows.map(row => inventoryValuesSchema.safeParse(row.values)).flatMap(row => row.success ? [row.data] : []);
    const ids = candidates.flatMap(row => row.id ? [row.id] : []), skus = candidates.flatMap(row => row.sku ? [row.sku] : []);
    return (await tx.inventoryItem.findMany({ where: { userId, OR: [{ id: { in: ids } }, { sku: { in: skus } }] }, include: { commercialTerms: true } })).map(inventoryItemView);
  }
  async function create(userId: string, input: z.infer<typeof batchCreateSchema>) {
    return database.$transaction(async tx => {
      await lockInventoryOwner(tx, userId); await lockInventoryIdentity(tx, userId);
      const existing = await tx.inventoryBatch.findFirst({ where: { id: input.id, userId } });
      if (existing) {
        if (existing.source !== input.source || existing.totalRows !== input.totalRows || existing.reason !== (input.reason ?? null)) throw new Error("KEY_CONFLICT");
        return summary(existing);
      }
      if (await tx.inventoryBatch.count({ where: { userId, status: { notIn: ["APPLIED", "CANCELLED"] } } }) >= 5) throw new Error("BATCH_QUOTA");
      return summary(await tx.inventoryBatch.create({ data: { ...input, userId } }));
    });
  }
  async function stage(userId: string, id: string, input: z.infer<typeof batchChunkSchema>) {
    const hash = inventoryHash(input);
    return database.$transaction(async tx => {
      await lockInventoryOwner(tx, userId); await lockInventoryIdentity(tx, userId);
      const batch = await batchLock(tx, userId, id);
      const previous = await tx.inventoryBatchChunkReceipt.findUnique({ where: { batchId_chunkId: { batchId: id, chunkId: input.chunkId } } });
      if (previous) { if (previous.hash !== hash) throw new Error("KEY_CONFLICT"); return chunkResult.parse(previous.result); }
      editable(batch.status);
      if (batch.revision !== input.expectedRevision) throw new Error("VERSION_CONFLICT");
      const old = await tx.inventoryBatchRow.findMany({ where: { batchId: id } });
      for (const row of input.rows) {
        const existing = old.find(value => value.rowId === row.rowId);
        if (existing && (row.revision !== existing.revision || row.rowNumber !== existing.rowNumber)) throw new Error("VERSION_CONFLICT");
        if (!existing && row.revision !== undefined) throw new Error("VERSION_CONFLICT");
      }
      const merged = [...old.filter(row => !input.rows.some(next => next.rowId === row.rowId)), ...input.rows];
      if (merged.length > 500 || merged.length > input.totalRows || new Set(merged.map(row => row.rowNumber)).size !== merged.length || Buffer.byteLength(canonical(merged.map(row => ({ rowId: row.rowId, values: row.values, excluded: row.excluded })))) > 2 * 1024 * 1024) throw new Error("BATCH_LIMIT");
      const updated = [];
      for (const row of input.rows) {
        const stored = await tx.inventoryBatchRow.upsert({ where: { batchId_rowId: { batchId: id, rowId: row.rowId } },
          create: { batchId: id, rowId: row.rowId, rowNumber: row.rowNumber, excluded: row.excluded, values: inventoryJson(row.values) },
          update: { values: inventoryJson(row.values), excluded: row.excluded, revision: { increment: 1 } } });
        updated.push({ rowId: stored.rowId, revision: stored.revision });
      }
      const next = await tx.inventoryBatch.update({ where: { id }, data: { totalRows: input.totalRows, revision: { increment: 1 }, status: "DRAFT", plan: Prisma.DbNull, planHash: null, inputHash: null, previewExpiresAt: null, applyOperationId: null } });
      const result = { revision: next.revision, rows: updated };
      await tx.inventoryBatchChunkReceipt.create({ data: { batchId: id, chunkId: input.chunkId, hash, result: inventoryJson(result) } }); return result;
    });
  }
  async function preview(userId: string, id: string, expectedRevision: number) {
    return database.$transaction(async tx => {
      await lockInventoryOwner(tx, userId);
      const batch = await batchLock(tx, userId, id); editable(batch.status);
      if (batch.revision !== expectedRevision) throw new Error("VERSION_CONFLICT");
      const rows = await tx.inventoryBatchRow.findMany({ where: { batchId: id }, orderBy: { rowNumber: "asc" } });
      if (rows.length !== batch.totalRows) throw new Error("BATCH_INCOMPLETE");
      const items = await currentItems(tx, userId, rows);
      const plan = buildInventoryPlan(rows, items, batch.reason), planHash = inventoryHash(plan), inputHash = inventoryHash(rows.map(row => ({ rowId: row.rowId, revision: row.revision, values: row.values, excluded: row.excluded })));
      const valid = !plan.some(row => row.errors.length) && plan.some(row => row.selected);
      if (batch.planHash === planHash && batch.inputHash === inputHash && batch.previewExpiresAt && batch.previewExpiresAt > new Date()) return summary(batch);
      return summary(await tx.inventoryBatch.update({ where: { id }, data: { status: valid ? "READY" : "INVALID", inputHash, planHash, plan: plan.map(row => inventoryJson(row)), previewRevision: { increment: 1 }, applyOperationId: valid ? randomUUID() : null, previewExpiresAt: new Date(Date.now() + 30 * 60_000) } }));
    }, { isolationLevel: "RepeatableRead", timeout: 15000 });
  }
  async function apply(userId: string, id: string, input: z.infer<typeof batchApplySchema>) {
    try {
      return await database.$transaction(async tx => {
        await lockInventoryOwner(tx, userId); await lockInventoryIdentity(tx, userId);
        const batch = await batchLock(tx, userId, id);
        if (batch.revision !== input.expectedRevision || batch.previewRevision !== input.previewRevision || batch.planHash !== input.planHash || batch.applyOperationId !== input.operationId) throw new Error("KEY_CONFLICT");
        if (batch.status === "APPLIED") return summary(batch);
        if (batch.status === "CANCELLED") throw new Error("BATCH_TERMINAL");
        if (batch.status !== "READY") throw new Error("BATCH_NOT_READY");
        if (!batch.previewExpiresAt || batch.previewExpiresAt <= new Date()) throw new Error("STALE_BATCH");
        const plan = inventoryPlanSchema.parse(batch.plan), selected = plan.filter(row => row.selected);
        if (!selected.length || selected.some(row => row.errors.length || !row.after)) throw new Error("BATCH_NOT_READY");
        const ids = selected.flatMap(row => row.before ? [row.before.id] : []);
        if (ids.length) await tx.$queryRaw(Prisma.sql`SELECT id FROM inventory_items WHERE "userId"=${userId} AND id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`);
        const rows = await tx.inventoryBatchRow.findMany({ where: { batchId: id }, orderBy: { rowNumber: "asc" } });
        const current = buildInventoryPlan(rows, await currentItems(tx, userId, rows), batch.reason);
        if (inventoryHash(current) !== batch.planHash) throw new Error("STALE_BATCH");
        const valid = selected.map(row => { if (!row.after) throw new Error("BATCH_NOT_READY"); return { row, next: row.after }; });
        const created = valid.filter(({ row }) => !row.before).map(({ row, next }) => ({ id: row.itemId, userId, name: next.name, sku: next.sku, minimumStock: next.minimumStock }));
        if (created.length) await tx.inventoryItem.createMany({ data: created });
        const metadata = valid.filter(({ row, next }) => row.before && (row.before.name !== next.name || row.before.sku !== next.sku || row.before.minimumStock !== next.minimumStock)).map(({ row, next }) => ({ id: row.itemId, name: next.name, sku: next.sku, minimumStock: next.minimumStock }));
        if (metadata.length) await tx.$executeRaw`UPDATE inventory_items i SET name=x.name,sku=x.sku,"minimumStock"=x."minimumStock","updatedAt"=CURRENT_TIMESTAMP FROM jsonb_to_recordset(${JSON.stringify(metadata)}::jsonb) AS x(id text,name text,sku text,"minimumStock" integer) WHERE i.id=x.id AND i."userId"=${userId}`;
        const terms = valid.flatMap(({ row, next }) => next.commercialTerms && canonical(next.commercialTerms) !== canonical(row.before?.commercialTerms ?? null) ? [{ itemId: row.itemId, userId, unitSalePrice: next.commercialTerms.unitSalePrice, referenceUnitCost: next.commercialTerms.referenceUnitCost }] : []);
        if (terms.length) await tx.$executeRaw`INSERT INTO item_commercial_terms ("itemId","userId","unitSalePrice","referenceUnitCost","updatedAt") SELECT x."itemId",x."userId",x."unitSalePrice",x."referenceUnitCost",CURRENT_TIMESTAMP FROM jsonb_to_recordset(${JSON.stringify(terms)}::jsonb) AS x("itemId" text,"userId" text,"unitSalePrice" bigint,"referenceUnitCost" bigint) ON CONFLICT ("itemId") DO UPDATE SET "unitSalePrice"=EXCLUDED."unitSalePrice","referenceUnitCost"=EXCLUDED."referenceUnitCost","updatedAt"=CURRENT_TIMESTAMP`;
        const movements = await applyInventoryBatchMovements(tx, userId, valid.filter(({ row }) => row.delta !== 0).map(({ row, next }) => ({ itemId: row.itemId, input: { key: input.operationId, type: "ADJUSTMENT", quantity: next.stock, reason: row.values.reason ?? "" }, batch: { id, rowId: row.rowId, operationId: input.operationId } })));
        const movementsByItem = new Map(movements.map(movement => [movement.itemId, movement.id]));
        const results = valid.map(({ row, next }) => ({ rowId: row.rowId, itemId: row.itemId, action: row.action, delta: row.delta, movementId: movementsByItem.get(row.itemId) ?? null, stock: next.stock }));
        const receipt = { batchId: id, operationId: input.operationId, revision: batch.revision, previewRevision: batch.previewRevision, planHash: input.planHash, appliedAt: new Date().toISOString(), rows: results };
        return summary(await tx.inventoryBatch.update({ where: { id }, data: { status: "APPLIED", receipt: inventoryJson(receipt) } }));
      }, { timeout: 15000, maxWait: 2000 });
    } catch (error) {
      if (error instanceof Error && error.message === "STALE_BATCH") await database.inventoryBatch.updateMany({ where: { id, userId, status: "READY", previewRevision: input.previewRevision, applyOperationId: input.operationId }, data: { status: "STALE" } });
      throw error;
    }
  }
  async function cancel(userId: string, id: string) {
    return database.$transaction(async tx => { await lockInventoryOwner(tx, userId); const batch = await batchLock(tx, userId, id); if (batch.status === "APPLIED") throw new Error("BATCH_TERMINAL"); return summary(await tx.inventoryBatch.update({ where: { id }, data: { status: "CANCELLED" } })); });
  }
  async function get(userId: string, id: string) { return database.$transaction(async tx => { await lockInventoryOwner(tx, userId); return summary(await owned(tx, userId, id)); }); }
  async function rows(userId: string, id: string, page: number, filter: string) {
    return database.$transaction(async tx => {
      await lockInventoryOwner(tx, userId); const batch = await owned(tx, userId, id);
      const plan = batch.plan ? inventoryPlanSchema.parse(batch.plan) : [];
      const all = await tx.inventoryBatchRow.findMany({ where: { batchId: id }, orderBy: { rowNumber: "asc" } });
      const matches = all.filter(row => { const report = plan.find(entry => entry.rowId === row.rowId); return filter === "all" || (filter === "ADJUSTMENT" ? report?.delta !== 0 && report?.delta !== undefined : report?.action === filter); });
      const receipt = batch.receipt ? batchReceipt.parse(batch.receipt) : null;
      return { rows: matches.slice((page - 1) * 50, page * 50).map(row => ({ rowId: row.rowId, rowNumber: row.rowNumber, revision: row.revision, excluded: row.excluded, values: row.values, report: plan.find(entry => entry.rowId === row.rowId) ?? null, result: receipt?.rows.find(entry => entry.rowId === row.rowId) ?? null })), total: matches.length, page };
    }, { isolationLevel: "RepeatableRead" });
  }
  async function list(userId: string, page: number) {
    return database.$transaction(async tx => {
      await lockInventoryOwner(tx, userId);
      const where = { userId };
      return { batches: (await tx.inventoryBatch.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * 20, take: 20 })).map(summary), total: await tx.inventoryBatch.count({ where }), page };
    }, { isolationLevel: "RepeatableRead" });
  }
  async function report(userId: string, id: string) {
    return database.$transaction(async tx => { await lockInventoryOwner(tx, userId); const batch = await owned(tx, userId, id); return batch.plan ? inventoryPlanSchema.parse(batch.plan) : []; }, { isolationLevel: "RepeatableRead" });
  }
  return { create, stage, preview, apply, cancel, get, rows, list, report };
}
function summary(batch: Prisma.InventoryBatchGetPayload<object>) {
  const plan = batch.plan ? inventoryPlanSchema.parse(batch.plan) : [];
  const receipt = batch.receipt ? batchReceipt.parse(batch.receipt) : null;
  return { id: batch.id, source: batch.source, status: batch.status, revision: batch.revision, previewRevision: batch.previewRevision, totalRows: batch.totalRows, reason: batch.reason, inputHash: batch.inputHash, planHash: batch.planHash, applyOperationId: batch.applyOperationId, previewExpiresAt: batch.previewExpiresAt,
    counts: { new: plan.filter(row => row.action === "NEW").length, modified: plan.filter(row => row.action === "MODIFIED").length, unchanged: plan.filter(row => row.action === "UNCHANGED").length, errors: plan.filter(row => row.action === "ERROR").length, excluded: plan.filter(row => row.action === "EXCLUDED").length, adjustments: plan.filter(row => row.delta !== 0 && row.action !== "ERROR").length },
    receipt: receipt ? { batchId: receipt.batchId, operationId: receipt.operationId, appliedAt: receipt.appliedAt, rowCount: receipt.rows.length, movementCount: receipt.rows.filter(row => row.movementId).length, planHash: receipt.planHash } : null };
}

export async function editInventoryItem(userId: string, id: string, input: z.infer<typeof inventoryEditSchema>) {
  return prisma.$transaction(async tx => {
    await lockInventoryOwner(tx, userId); await lockInventoryIdentity(tx, userId);
    await tx.$queryRaw`SELECT id FROM inventory_items WHERE id=${id} AND "userId"=${userId} FOR UPDATE`;
    const item = await tx.inventoryItem.findFirst({ where: { id, userId } }); if (!item) throw new Error("NOT_FOUND");
    if (item.dataVersion !== input.expectedVersion) throw new Error("VERSION_CONFLICT");
    return inventoryItemView(await tx.inventoryItem.update({ where: { id }, data: { name: input.name, sku: input.sku, minimumStock: input.minimumStock }, include: { commercialTerms: true } }));
  });
}
export async function setInventoryTerms(userId: string, id: string, input: z.infer<typeof inventoryTermsSchema>) {
  return prisma.$transaction(async tx => {
    await lockInventoryOwner(tx, userId);
    await tx.$queryRaw`SELECT id FROM inventory_items WHERE id=${id} AND "userId"=${userId} FOR UPDATE`;
    const item = await tx.inventoryItem.findFirst({ where: { id, userId }, include: { commercialTerms: true } }); if (!item) throw new Error("NOT_FOUND");
    if ((item.commercialTerms?.version ?? null) !== input.expectedVersion || input.unitSalePrice === undefined || input.referenceUnitCost === undefined) throw new Error("VERSION_CONFLICT");
    await tx.itemCommercialTerms.upsert({ where: { itemId: id }, create: { itemId: id, userId, unitSalePrice: BigInt(input.unitSalePrice), referenceUnitCost: input.referenceUnitCost === null ? null : BigInt(input.referenceUnitCost) }, update: { unitSalePrice: BigInt(input.unitSalePrice), referenceUnitCost: input.referenceUnitCost === null ? null : BigInt(input.referenceUnitCost) } });
    return inventoryItemView(await tx.inventoryItem.findUniqueOrThrow({ where: { id }, include: { commercialTerms: true } }));
  });
}
