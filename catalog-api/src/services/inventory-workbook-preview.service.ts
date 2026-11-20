import { createHash } from "node:crypto";
import { prisma } from "../config/prisma";
import { lockInventoryOwner, inventoryItemView } from "../repositories/inventory.repository";
import type { WorkbookPreviewInput } from "../schemas/inventory-workbook-preview.schema";

const formulaErrors = new Set(["#REF!", "#VALUE!", "#NAME?", "#DIV/0!", "#NUM!", "#N/A", "#SPILL!", "#CALC!"]);
const blank = (v: unknown) => v === null || v === undefined || (typeof v === "string" && !v.trim());
const text = (v: unknown) => typeof v === "string" ? v.trim() : typeof v === "number" && Number.isSafeInteger(v) ? String(v) : "";
function parseSnapshot(raw: string): Record<string, any> {
  const value: unknown = JSON.parse(raw); if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_SNAPSHOT"); return value as Record<string, any>;
}
function error(field: string, code: string, message: string) { return { field, code, message }; }

export function makeInventoryWorkbookPreviewService(database = prisma) {
  return {
    async preview(userId: string, input: WorkbookPreviewInput) {
      return database.$transaction(async tx => {
        await lockInventoryOwner(tx, userId);
        const workbook = await tx.inventoryWorkbook.findUnique({ where: { userId }, select: { snapshot: true, version: true } });
        if (!workbook) throw new Error("WORKBOOK_NOT_FOUND");
        if (workbook.version !== input.expectedVersion) throw new Error("VERSION_CONFLICT");
        const root = parseSnapshot(workbook.snapshot);
        if (root.id !== input.workbookId) throw new Error("WORKBOOK_NOT_FOUND");
        const sheet = root.sheets?.[input.sheetId];
        if (!sheet || !root.sheetOrder?.includes(input.sheetId)) throw new Error("SHEET_NOT_FOUND");
        if (input.lastRow > sheet.rowCount || input.headerRow > sheet.rowCount) throw new Error("RANGE_OUT_OF_BOUNDS");
        const columns = Object.keys(input.mapping).map(Number);
        if (columns.some(c => c < 0 || c >= sheet.columnCount)) throw new Error("MAPPING_OUT_OF_BOUNDS");
        const header = sheet.cellData?.[String(input.headerRow - 1)] ?? {};
        const headerErrors = columns.filter(c => input.mapping[String(c)] !== "ignore" && blank(header[String(c)]?.v));
        if (headerErrors.length) throw new Error("INVALID_HEADERS");
        const identity = Object.entries(input.mapping).find(([, f]) => f === "id")?.[0];
        const skuColumn = Object.entries(input.mapping).find(([, f]) => f === "sku")?.[0];
        const ids: string[] = [], skus: string[] = [];
        const rawRows: any[] = [];
        for (let rowNumber = input.firstRow; rowNumber <= input.lastRow; rowNumber++) {
          const cells = sheet.cellData?.[String(rowNumber - 1)] ?? {}; const values: Record<string,string> = {}; const errors: any[] = []; let hasData = false;
          for (const [column, field] of Object.entries(input.mapping)) {
            if (field === "ignore") continue; const cell = cells[column]; const value = cell?.v; if (!blank(value)) hasData = true;
            if (cell?.f) errors.push(error(field, formulaErrors.has(String(value)) ? "FORMULA_ERROR" : "FORMULA_UNSUPPORTED", "Las fórmulas no se interpretan en el servidor; escribe un valor fijo."));
            if (blank(value)) { if (["id", "sku", "name"].includes(field)) errors.push(error(field, "REQUIRED", "Falta un valor.")); continue; }
            if (["id", "sku", "name"].includes(field)) { const v = text(value); if (!v) errors.push(error(field, "TEXT_REQUIRED", "Usa texto sin fórmulas.")); else values[field] = field === "sku" ? v.toUpperCase() : v; }
            else { const v = text(value); if (!/^\d{1,19}$/.test(v)) errors.push(error(field, "INVALID_INTEGER", "Usa un entero no negativo sin separadores.")); else values[field] = v; }
          }
          if (hasData) { if (values.id) ids.push(values.id); if (values.sku) skus.push(values.sku); }
          rawRows.push({ rowNumber, values, errors });
        }
        if (new Set(skus).size !== skus.length) for (const row of rawRows) if (row.values.sku && skus.filter(x => x === row.values.sku).length > 1) row.errors.push(error("sku", "DUPLICATE_IN_RANGE", "El SKU aparece varias veces en el rango."));
        const items = await tx.inventoryItem.findMany({ where: { userId, OR: [{ id: { in: ids } }, { sku: { in: skus } }] }, include: { commercialTerms: true } });
        const byId = new Map(items.map(i => [i.id, i])), bySku = new Map(items.map(i => [i.sku, i]));
        const rows = rawRows.map(row => {
          const item = row.values.id ? byId.get(row.values.id) : row.values.sku ? bySku.get(row.values.sku) : undefined;
          if (row.values.id && !item) row.errors.push(error("id", "NOT_FOUND", "El ID no pertenece a un producto de esta cuenta."));
          if (!item && !row.values.sku) row.errors.push(error("sku", "IDENTITY_REQUIRED", "Indica SKU o ID."));
          if (!item && row.values.sku && !row.values.name) row.errors.push(error("name", "NAME_REQUIRED_FOR_NEW", "Un producto nuevo requiere nombre."));
          const before = item ? inventoryItemView(item) : null;
          const changed = item && Object.entries(row.values).some(([k, v]) => ["name", "sku", "minimumStock"].includes(k) && String((before as any)[k]) !== v);
          const quantity = row.values.quantity !== undefined;
          const stockCurrent = item?.stock ?? 0;
          const stockTarget = quantity ? Number(row.values.quantity) : null;
          const delta = stockTarget === null ? 0 : stockTarget - stockCurrent;
          const empty = Object.keys(row.values).length === 0 && row.errors.length === 0;
          return { rowNumber: row.rowNumber, classification: empty ? "EMPTY" : row.errors.length ? "ERROR" : item ? (changed || delta !== 0 ? "POTENTIAL_UPDATE" : "UNCHANGED") : "NEW", canApply: false, before, values: row.values, stockCurrent, stockTarget, delta, errors: row.errors };
        });
        const sourceHash = createHash("sha256").update(workbook.snapshot).digest("hex");
        return { workbookVersion: workbook.version, sourceHash, sheetId: input.sheetId, headerRow: input.headerRow, rows, canApply: false };
      });
    },
  };
}
