import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { createProductSchema, updateProductSchema } from "../schemas/product.schema";
import { importProductRowSchema, ImportProductRow, ImportBatch } from "../schemas/product-import.schema";
import { ImportAccess, ImportWrite, ProductImportStore, productImportStore } from "../repositories/product-import.repository";
import { validateProductPromotion } from "./product-pricing";
import { ImportPlanEntry, importDigest, importNameKey, rowDigest, newImportPlan, markImportConflicts, readImportPlan, signImportPlan } from "./product-import-plan";

export class ProductImportError extends Error {
  constructor(public readonly code: string, public readonly fields: string[] = []) { super(code); }
}
const knownCodes = new Set(["CATALOG_NOT_FOUND", "CATALOG_ARCHIVED", "IMPORT_STATE_CHANGED", "INVALID_IMPORT_PREVIEW"]);
export function importErrorCode(error: unknown): string {
  if (error instanceof ProductImportError) return error.code;
  if (error instanceof Error && knownCodes.has(error.message)) return error.message;
  if (error instanceof Error && error.message === "INVALID_PRODUCT_PROMOTION") return "INVALID_PROMOTION";
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return "UNIQUE_CONFLICT";
  return "IMPORT_UNAVAILABLE";
}
const reasons: Record<string, string> = {
  INVALID_ROW: "Revisa los campos y sus límites; no se admiten columnas adicionales.",
  INVALID_FIELDS: "Faltan campos obligatorios o contienen valores inválidos.",
  INVALID_PROMOTION: "La oferta debe ser menor al precio y tener un intervalo de fechas válido.",
  PROMOTION_FLAG_CONFLICT: "No programar descuento es incompatible con enviar datos de oferta.",
  AMBIGUOUS_PRODUCT: "Hay varios productos coincidentes. Corrige su identificación antes de importar.",
  UNKNOWN_CATEGORY: "La categoría no existe en este catálogo.",
  AMBIGUOUS_CATEGORY: "Hay varias categorías con ese nombre en el catálogo.",
  FILE_CONFLICT: "Varias filas del archivo comparten identidad o apuntan al mismo producto.",
  IMPORT_STATE_CHANGED: "El producto o la categoría cambiaron desde la vista previa. Previsualiza de nuevo.",
  UNIQUE_CONFLICT: "Cambió un identificador único. Previsualiza de nuevo.",
  CATALOG_ARCHIVED: "El catálogo está archivado.",
  CATALOG_NOT_FOUND: "El catálogo no está disponible para este usuario.",
  NOT_PROCESSED: "No se procesó esta fila; revisa el resultado antes de reintentar.",
  IMPORT_UNAVAILABLE: "No se pudo procesar esta fila en este momento.",
};
export type ImportRowResult = { rowNumber: number; action: "create" | "update" | "error" | "not_processed";
  code: string; reason: string; productId?: string; fields?: string[] };
const errorResult = (rowNumber: number, code: string, fields: string[] = []): ImportRowResult => ({ rowNumber,
  action: code === "NOT_PROCESSED" ? "not_processed" : "error", code,
  reason: `${reasons[code] ?? reasons.IMPORT_UNAVAILABLE ?? "Error de importación"}${fields.length ? ` Campos: ${fields.join(", ")}.` : ""}`,
  ...(fields.length ? { fields } : {}) });
const issueFields = (issues: { path: PropertyKey[] }[]) => [...new Set(issues.map(i => i.path.map(String).join(".")).filter(Boolean))].slice(0, 20);
function report(rows: ImportRowResult[]) {
  return { rows, summary: { new: rows.filter(r => r.action === "create").length,
    updates: rows.filter(r => r.action === "update").length, errors: rows.filter(r => r.action === "error").length,
    notProcessed: rows.filter(r => r.action === "not_processed").length } };
}
const baseSlug = (name: string) => name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
  .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 130).replace(/-+$/g, "") || "producto";
async function unusedSlug(name: string, access: ImportAccess) {
  const base = baseSlug(name), used = new Set(await access.slugs(base));
  let slug = base, suffix = 1;
  while (used.has(slug)) slug = `${base}-${++suffix}`;
  return slug;
}

async function resolveRow(row: ImportProductRow, access: ImportAccess) {
  const hits = await access.products(row.name, row.sku);
  const skuHits = row.sku ? hits.filter(p => p.sku?.trim() === row.sku) : [];
  const matches = skuHits.length ? skuHits : hits.filter(p => importNameKey(p.name) === importNameKey(row.name));
  if (matches.length > 1) throw new ProductImportError("AMBIGUOUS_PRODUCT");
  const product = matches[0];
  let categoryId = product?.categoryId ?? undefined;
  let categoryVersion: string | null = null;
  if (row.categoryName) {
    const categories = await access.categories(row.categoryName);
    if (!categories.length) throw new ProductImportError("UNKNOWN_CATEGORY");
    if (categories.length > 1) throw new ProductImportError("AMBIGUOUS_CATEGORY");
    const category = categories[0];
    if (!category) throw new ProductImportError("UNKNOWN_CATEGORY");
    categoryId = category.id;
    categoryVersion = importDigest(JSON.stringify(category));
  }
  if (row.saleEnabled === false && [row.salePrice, row.saleStartsAt, row.saleEndsAt].some(v => v != null)) {
    throw new ProductImportError("PROMOTION_FLAG_CONFLICT");
  }
  const candidate = {
    name: row.name, slug: product?.slug ?? baseSlug(row.name),
    price: row.price ?? product?.price, stock: row.stock ?? product?.stock ?? 0,
    sku: row.sku ?? product?.sku ?? undefined,
    description: row.description ?? product?.description ?? undefined,
    brand: row.brand ?? product?.brand ?? undefined, model: row.model ?? product?.model ?? undefined,
    categoryId,
    salePrice: row.salePrice ?? product?.salePrice ?? null,
    saleStartsAt: row.saleStartsAt ?? product?.saleStartsAt?.toISOString() ?? null,
    saleEndsAt: row.saleEndsAt ?? product?.saleEndsAt?.toISOString() ?? null,
  };
  const parsed = (product ? updateProductSchema : createProductSchema).safeParse(candidate);
  if (!parsed.success) throw new ProductImportError("INVALID_FIELDS", issueFields(parsed.error.issues));
  if (parsed.data.price === undefined) throw new ProductImportError("INVALID_FIELDS", ["price"]);
  const data = parsed.data;
  const promotion = { price: parsed.data.price, salePrice: data.salePrice ?? null,
    saleStartsAt: data.saleStartsAt ? new Date(data.saleStartsAt) : null,
    saleEndsAt: data.saleEndsAt ? new Date(data.saleEndsAt) : null };
  if (row.saleEnabled === true && promotion.salePrice === null) throw new ProductImportError("INVALID_PROMOTION");
  validateProductPromotion(promotion);
  const write: ImportWrite & { price: number } = { name: row.name,
    sku: data.sku, description: data.description, brand: data.brand, model: data.model,
    stock: data.stock, categoryId: data.categoryId, ...promotion };
  const entry: ImportPlanEntry = {
    rowNumber: row.rowNumber, hash: rowDigest(row), action: product ? "update" : "create",
    productId: product?.id ?? null, productVersion: product ? importDigest(JSON.stringify(product)) : null,
    categoryId: categoryId ?? null, categoryVersion, nameKey: importDigest(importNameKey(row.name)),
    skuKey: row.sku ? importDigest(row.sku) : "", bySku: skuHits.length > 0, error: null, conflict: false, fields: [],
  };
  return { entry, write };
}

function entryResult(entry: ImportPlanEntry): ImportRowResult {
  if (entry.conflict) return errorResult(entry.rowNumber, "FILE_CONFLICT");
  if (entry.action === "error") return errorResult(entry.rowNumber, entry.error ?? "INVALID_ROW", entry.fields);
  return { rowNumber: entry.rowNumber, action: entry.action, code: entry.action === "create" ? "NEW_PRODUCT" : entry.bySku ? "MATCHED_SKU" : "MATCHED_NAME",
    reason: entry.action === "create" ? "Se creará un producto." : "Se actualizará el producto conservando su slug y visibilidad.",
    ...(entry.productId ? { productId: entry.productId } : {}) };
}

export function makeProductImportService(store: ProductImportStore = productImportStore) {
  return {
    async preview(catalogId: string, userId: string, batch: ImportBatch, secret: string) {
      await store.authorize(catalogId, userId);
      const plan = batch.previewToken ? readImportPlan(batch.previewToken, secret, catalogId, userId, batch.totalRows)
        : newImportPlan(catalogId, userId, batch.totalRows);
      const deadline = Date.now() + 15_000;
      for (const raw of batch.rows) {
        const parsed = importProductRowSchema.safeParse(raw);
        const previous = plan.entries.find(e => e.rowNumber === raw.rowNumber);
        if (previous) {
          if (!parsed.success || previous.hash !== rowDigest(parsed.data)) throw new ProductImportError("INVALID_IMPORT_PREVIEW");
          continue;
        }
        if (plan.entries.length >= batch.totalRows) throw new ProductImportError("INVALID_IMPORT_PREVIEW");
        try {
          if (Date.now() >= deadline) throw new ProductImportError("NOT_PROCESSED");
          if (!parsed.success) throw new ProductImportError("INVALID_ROW", issueFields(parsed.error.issues));
          const resolved = await resolveRow(parsed.data, store.read(catalogId));
          plan.entries.push(resolved.entry);
        } catch (error) {
          plan.entries.push({ rowNumber: raw.rowNumber, hash: parsed.success ? rowDigest(parsed.data) : "", action: "error",
            error: importErrorCode(error), productId: null, productVersion: null, categoryId: null, categoryVersion: null,
            nameKey: "", skuKey: "", bySku: false, conflict: false,
            fields: error instanceof ProductImportError ? error.fields : [] });
        }
      }
      markImportConflicts(plan.entries);
      return { ...report(plan.entries.filter(e => batch.rows.some(r => r.rowNumber === e.rowNumber)).map(entryResult)),
        previewToken: signImportPlan(plan, secret), ready: plan.entries.length === plan.totalRows,
        fileSummary: report(plan.entries.map(entryResult)).summary,
        invalidatedRows: plan.entries.filter(e => e.conflict).map(e => e.rowNumber) };
    },
    async confirm(catalogId: string, userId: string, batch: ImportBatch, secret: string) {
      await store.authorize(catalogId, userId);
      if (!batch.previewToken) throw new ProductImportError("INVALID_IMPORT_PREVIEW");
      const plan = readImportPlan(batch.previewToken, secret, catalogId, userId, batch.totalRows);
      if (plan.entries.length !== plan.totalRows) throw new ProductImportError("INVALID_IMPORT_PREVIEW");
      const batchId = randomUUID();
      const results: ImportRowResult[] = [];
      const deadline = Date.now() + 15_000;
      for (const raw of batch.rows) {
        const expected = plan.entries.find(e => e.rowNumber === raw.rowNumber);
        if (!expected) { results.push(errorResult(raw.rowNumber, "INVALID_ROW")); continue; }
        if (expected.conflict || expected.action === "error") { results.push(entryResult(expected)); continue; }
        try {
          if (Date.now() >= deadline) { results.push(errorResult(raw.rowNumber, "NOT_PROCESSED")); continue; }
          const parsed = importProductRowSchema.safeParse(raw);
          if (!parsed.success || rowDigest(parsed.data) !== expected.hash) throw new ProductImportError("IMPORT_STATE_CHANGED");
          const result = await store.row(catalogId, userId, async access => {
            const resolved = await resolveRow(parsed.data, access);
            for (const key of ["action", "productId", "productVersion", "categoryId", "categoryVersion"] as const) {
              if (resolved.entry[key] !== expected[key]) throw new ProductImportError("IMPORT_STATE_CHANGED");
            }
            let productId: string;
            if (resolved.entry.action === "create") productId = await access.create({ ...resolved.write, slug: await unusedSlug(parsed.data.name, access) });
            else {
              if (!resolved.entry.productId) throw new ProductImportError("IMPORT_STATE_CHANGED");
              productId = resolved.entry.productId;
              await access.update(productId, resolved.write);
            }
            return { ...entryResult(resolved.entry), productId };
          });
          results.push(result);
        } catch (error) { results.push(errorResult(raw.rowNumber, importErrorCode(error), error instanceof ProductImportError ? error.fields : [])); }
      }
      return { ...report(results), batchId };
    },
  };
}
