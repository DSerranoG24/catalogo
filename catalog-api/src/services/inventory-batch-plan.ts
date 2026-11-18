import { createHash } from "node:crypto";
import { z } from "zod";
import { inventoryValuesSchema, type InventoryItemView, type InventoryPlanRow } from "../schemas/inventory-batch.schema";

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).filter(([, entry]) => entry !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
export const inventoryHash = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");
export function inventoryJson(value: unknown) { return z.record(z.string(), z.json()).parse(JSON.parse(JSON.stringify(value))); }

type SourceRow = { rowId: string; rowNumber: number; revision: number; reservedItemId: string; excluded: boolean; values: unknown };
export function buildInventoryPlan(rows: SourceRow[], items: InventoryItemView[], defaultReason: string | null): InventoryPlanRow[] {
  const byId = new Map(items.map(item => [item.id, item])), bySku = new Map(items.map(item => [item.sku, item]));
  const result = rows.map((row): InventoryPlanRow => {
    const base: InventoryPlanRow = { rowId: row.rowId, rowNumber: row.rowNumber, rowRevision: row.revision, selected: !row.excluded, itemId: row.reservedItemId, action: row.excluded ? "EXCLUDED" : "UNCHANGED", before: null, after: null, values: {}, delta: 0, errors: [] };
    if (row.excluded) return base;
    const parsed = inventoryValuesSchema.safeParse(row.values);
    if (!parsed.success) {
      base.action = "ERROR"; base.errors = parsed.error.issues.map(issue => ({ field: String(issue.path[0] ?? "row"), code: "INVALID_FIELD", message: "Revisa el formato y los límites del campo." })); return base;
    }
    const values = parsed.data; base.values = values;
    const error = (field: string, code: string, message: string) => { base.errors.push({ field, code, message }); };
    const existing = values.id ? byId.get(values.id) : values.sku ? bySku.get(values.sku) : undefined;
    if (values.id && !existing) error("id", "ID_NOT_FOUND", "El ID no corresponde a un artículo disponible de tu cuenta.");
    if (!values.id && !values.sku) error("sku", "SKU_REQUIRED", "Indica un SKU o un ID existente.");
    if (!existing && !values.name) error("name", "NAME_REQUIRED", "El nombre es obligatorio para crear un artículo.");
    if (!existing && !values.sku) error("sku", "SKU_REQUIRED", "El SKU es obligatorio para crear un artículo.");
    if (values.sku && bySku.has(values.sku) && bySku.get(values.sku)?.id !== existing?.id) error("sku", "ID_SKU_CONFLICT", "Ese SKU ya pertenece a otro artículo.");
    base.before = existing ?? null; base.itemId = existing?.id ?? row.reservedItemId;
    if (existing) {
      for (const [field, actual] of [["dataVersion", existing.dataVersion], ["stockVersion", existing.stockVersion], ["termsVersion", existing.commercialTerms?.version]] as const) {
        if (values[field] !== undefined && values[field] !== actual) error(field, "STALE_VERSION", "El archivo contiene una versión anterior. Recarga el artículo y revisa los cambios.");
      }
    }
    const priorTerms = existing?.commercialTerms ?? null;
    const action = values.costAction ?? (values.referenceUnitCost !== undefined ? "ASIGNAR" : "CONSERVAR");
    if ((action === "BORRAR" || action === "CONSERVAR") && values.referenceUnitCost !== undefined) error("referenceUnitCost", "COST_ACTION_CONFLICT", "La acción de costo contradice su valor.");
    if (action === "ASIGNAR" && values.referenceUnitCost === undefined) error("referenceUnitCost", "COST_REQUIRED", "Indica el costo que quieres asignar.");
    const price = values.unitSalePrice ?? priorTerms?.unitSalePrice;
    const cost = action === "BORRAR" ? null : values.referenceUnitCost ?? priorTerms?.referenceUnitCost ?? null;
    if (price === undefined && values.referenceUnitCost !== undefined) error("unitSalePrice", "PRICE_REQUIRED_FOR_TERMS", "Configura el precio antes de guardar el costo de referencia.");
    const terms = price === undefined ? null : { unitSalePrice: price, referenceUnitCost: cost, currency: "COP" as const, version: priorTerms?.version ?? 1 };
    const stock = values.targetStock ?? existing?.stock ?? 0;
    base.delta = stock - (existing?.stock ?? 0);
    const reason = values.reason ?? defaultReason ?? undefined;
    if (base.delta && (!reason || reason.length < 3)) error("reason", "REASON_REQUIRED", "Escribe un motivo de al menos tres caracteres para el ajuste.");
    if (reason) base.values.reason = reason;
    base.after = { id: base.itemId, name: values.name ?? existing?.name ?? "", sku: values.sku ?? existing?.sku ?? "", minimumStock: values.minimumStock ?? existing?.minimumStock ?? 0, stock, dataVersion: existing?.dataVersion ?? 1, stockVersion: existing?.stockVersion ?? 1, commercialTerms: terms };
    base.action = base.errors.length ? "ERROR" : !existing ? "NEW" : canonical(base.after) === canonical(existing) ? "UNCHANGED" : "MODIFIED";
    return base;
  });
  for (const key of [(row: InventoryPlanRow) => row.before?.id ?? row.values.id, (row: InventoryPlanRow) => row.after?.sku ?? row.values.sku]) {
    const groups = new Map<string, InventoryPlanRow[]>();
    for (const row of result.filter(row => row.selected)) { const value = key(row); if (value) groups.set(value, [...(groups.get(value) ?? []), row]); }
    for (const group of groups.values()) if (group.length > 1) for (const row of group) {
      row.action = "ERROR"; row.errors.push({ field: "sku", code: "SKU_DUPLICATE_IN_BATCH", message: "Varias filas identifican el mismo artículo o SKU. Corrige o excluye las filas repetidas." });
    }
  }
  return result;
}
