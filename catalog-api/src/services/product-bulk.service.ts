import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma";
import { lockCatalogWrites } from "../repositories/catalog-write-lock";
import { bulkPreviewSchema, type BulkRequest } from "../schemas/product-bulk.schema";
import { validateProductPromotion } from "./product-pricing";
import { enqueueDeletedProductImages } from "../repositories/product-image-cleanup.repository";

const planSchema = z.object({ purpose: z.literal("PRODUCT_BULK_V1"), catalogId: z.string().uuid(), userId: z.string().max(100), expires: z.number(), categoryVersion: z.string().nullable(), request: bulkPreviewSchema }).strict();
type Plan = z.infer<typeof planSchema>;
type Issue = { id: string; code: string; message: string };
export class BulkProductError extends Error {
  constructor(public readonly issues: Issue[]) { super("BULK_REVIEW_REQUIRED"); }
}
const mac = (payload: string, secret: string) => {
  if (Buffer.byteLength(secret) < 32) throw new Error("BULK_CONFIGURATION");
  return createHmac("sha256", secret).update("vitrinaya:product-bulk:v1:" + payload).digest();
};
function sign(plan: Plan, secret: string) {
  const payload = Buffer.from(JSON.stringify(plan)).toString("base64url");
  const token = `${payload}.${mac(payload, secret).toString("base64url")}`;
  if (Buffer.byteLength(JSON.stringify({ token, confirmation: "DESCARTAR 96" })) > 32768 || token.length > 24000) throw new Error("BULK_CONFIGURATION");
  return token;
}
function read(token: string, secret: string, catalogId: string, userId: string): Plan {
  try {
    if (token.length > 24000) throw new Error();
    const [payload, signature, extra] = token.split(".");
    if (!payload || !signature || extra) throw new Error();
    const actual = Buffer.from(signature, "base64url"), expected = mac(payload, secret);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error();
    const plan = planSchema.parse(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
    if (plan.catalogId !== catalogId || plan.userId !== userId || plan.expires <= Date.now()) throw new Error();
    return plan;
  } catch { throw new Error("INVALID_BULK_PREVIEW"); }
}

async function inspect(tx: Prisma.TransactionClient, catalogId: string, userId: string, request: BulkRequest, categoryVersion?: string | null) {
  const rows = await tx.product.findMany({ where: { catalogId, catalog: { userId }, id: { in: request.items.map(item => item.id) } },
    select: { id: true, name: true, updatedAt: true, price: true, salePrice: true, saleStartsAt: true, saleEndsAt: true, categoryId: true, needsCompletion: true, active: true } });
  const byId = new Map(rows.map(row => [row.id, row])), issues: Issue[] = [];
  let category = null;
  if (request.operation.action === "category" && request.operation.categoryId !== null) {
    category = await tx.category.findFirst({ where: { id: request.operation.categoryId, catalogId }, select: { id: true, updatedAt: true, name: true } });
    if (!category || (categoryVersion !== undefined && categoryVersion !== category.updatedAt.toISOString())) {
      issues.push({ id: request.operation.categoryId, code: "CATEGORY_CHANGED", message: "La categoría no pertenece a este catálogo o cambió. Revisa la selección." });
    }
  }
  const changes = [];
  for (const item of request.items) {
    const row = byId.get(item.id);
    if (!row) { issues.push({ id: item.id, code: "PRODUCT_UNAVAILABLE", message: "Producto no disponible en este catálogo." }); continue; }
    if (row.updatedAt.getTime() !== Date.parse(item.updatedAt)) { issues.push({ id: item.id, code: "PRODUCT_CHANGED", message: "El producto cambió. Revísalo y vuelve a seleccionarlo." }); continue; }
    const operation = request.operation;
    const skipped = operation.action === "discard" && (!row.needsCompletion || row.active);
    const data = operation.action === "price" ? { price: operation.price }
      : operation.action === "category" ? { categoryId: operation.categoryId }
      : operation.action === "promotion" ? { salePrice: operation.promotion?.salePrice ?? null,
        saleStartsAt: operation.promotion ? new Date(operation.promotion.saleStartsAt) : null,
        saleEndsAt: operation.promotion ? new Date(operation.promotion.saleEndsAt) : null } : {};
    if (operation.action === "price" || operation.action === "promotion") {
      try { validateProductPromotion({ price: row.price, salePrice: row.salePrice, saleStartsAt: row.saleStartsAt, saleEndsAt: row.saleEndsAt, ...data }); }
      catch { issues.push({ id: item.id, code: "INVALID_PROMOTION", message: "El precio y la oferta resultantes no forman una promoción válida." }); }
    }
    changes.push({ id: row.id, name: row.name, skipped, before: { price: row.price, salePrice: row.salePrice, saleStartsAt: row.saleStartsAt, saleEndsAt: row.saleEndsAt, categoryId: row.categoryId }, after: data });
  }
  return { changes, issues, categoryVersion: category?.updatedAt.toISOString() ?? null };
}

export function makeProductBulkService(database = prisma) {
  const transaction = <T>(catalogId: string, userId: string, work: (tx: Prisma.TransactionClient) => Promise<T>) => database.$transaction(async tx => {
    await tx.$executeRaw`SET LOCAL lock_timeout = '1500ms'`;
    await tx.$executeRaw`SET LOCAL statement_timeout = '5000ms'`;
    const catalog = await lockCatalogWrites(tx, catalogId, userId);
    if (catalog.archivedAt) throw new Error("CATALOG_ARCHIVED");
    return work(tx);
  }, { maxWait: 1500, timeout: 10000 });
  return {
    async preview(catalogId: string, userId: string, input: BulkRequest, secret: string) {
      const request = bulkPreviewSchema.parse(input);
      return transaction(catalogId, userId, async tx => {
        const result = await inspect(tx, catalogId, userId, request);
        const affected = result.issues.length ? 0 : result.changes.filter(change => !change.skipped).length;
        return { ...result, totalSelected: request.items.length, affected,
          token: result.issues.length || !affected ? null : sign({ purpose: "PRODUCT_BULK_V1", catalogId, userId, expires: Date.now() + 10 * 60_000, categoryVersion: result.categoryVersion, request }, secret) };
      });
    },
    async confirm(catalogId: string, userId: string, token: string, secret: string, confirmation?: string) {
      const plan = read(token, secret, catalogId, userId);
      const destructive = plan.request.operation.action === "delete" || plan.request.operation.action === "discard";
      if (destructive && confirmation !== `${plan.request.operation.action === "delete" ? "ELIMINAR" : "DESCARTAR"} ${plan.request.items.length}`) throw new Error("BULK_CONFIRMATION_REQUIRED");
      return transaction(catalogId, userId, async tx => {
        await tx.$queryRaw(Prisma.sql`SELECT id FROM products WHERE "catalogId" = ${catalogId} AND id IN (${Prisma.join(plan.request.items.map(item => item.id))}) ORDER BY id FOR UPDATE`);
        const result = await inspect(tx, catalogId, userId, plan.request, plan.categoryVersion);
        if (result.issues.length) throw new BulkProductError(result.issues);
        if (destructive) await enqueueDeletedProductImages(tx, catalogId, result.changes.filter(change => !change.skipped).map(change => change.id));
        let changed = 0;
        for (const change of result.changes) {
          if (change.skipped) continue;
          const version = plan.request.items.find(item => item.id === change.id);
          if (!version) throw new Error("INVALID_BULK_PREVIEW");
          const where = { id: change.id, catalogId, catalog: { userId }, updatedAt: new Date(version.updatedAt) };
          // All delegates share THIS transaction. Never call individual transaction-opening services.
          const write = destructive ? await tx.product.deleteMany({ where }) : await tx.product.updateMany({ where, data: change.after });
          if (write.count !== 1) throw new BulkProductError([{ id: change.id, code: "PRODUCT_CHANGED", message: "Cambió un producto. No se aplicó el lote." }]);
          changed++;
        }
        return { totalSelected: plan.request.items.length, changed, skipped: result.changes.length - changed,
          storageWarning: destructive ? "Se eliminaron los registros y se encoló la limpieza de sus archivos. Si Storage falla, se reintentará automáticamente." : null };
      });
    },
  };
}
