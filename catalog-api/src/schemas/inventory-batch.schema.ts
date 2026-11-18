import { z } from "zod";

const blank = (value: unknown) => value === null || (typeof value === "string" && !value.trim()) ? undefined : value;
const text = (max: number) => z.preprocess(blank, z.string().trim().min(1).max(max).optional());
const integer = (minimum = 0) => z.preprocess(value => {
  value = blank(value);
  return typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value.trim()) : value;
}, z.number().int().min(minimum).max(2147483647).optional());
export const inventoryMoney = z.preprocess(value => {
  value = blank(value);
  return typeof value === "number" && Number.isSafeInteger(value) ? String(value) : value;
}, z.string().trim().regex(/^\d{1,19}$/).refine(value => /^\d{1,19}$/.test(value) && BigInt(value) <= 9223372036854775807n)
  .transform(value => BigInt(value).toString()).optional());
export const inventoryValuesSchema = z.object({
  id: z.preprocess(blank, z.uuid().optional()), name: text(160),
  sku: z.preprocess(blank, z.string().trim().min(1).max(80).transform(value => value.toUpperCase()).pipe(z.string().max(80)).optional()),
  minimumStock: integer(), targetStock: integer(), reason: text(300),
  unitSalePrice: inventoryMoney, referenceUnitCost: inventoryMoney,
  costAction: z.preprocess(blank, z.enum(["CONSERVAR", "ASIGNAR", "BORRAR"]).optional()),
  dataVersion: integer(1), stockVersion: integer(1), termsVersion: integer(1),
}).strict();
export type InventoryValues = z.infer<typeof inventoryValuesSchema>;
export const batchCreateSchema = z.object({ id: z.uuid(), source: z.enum(["GRID", "PASTE", "XLSX", "CSV"]), totalRows: z.number().int().min(1).max(500), reason: text(300) }).strict();
export const batchRowSchema = z.object({
  rowId: z.uuid(), rowNumber: z.number().int().min(2).max(1048576), revision: z.number().int().positive().optional(),
  excluded: z.boolean().default(false), values: z.record(z.string().max(40), z.union([z.string().max(500), z.number(), z.boolean(), z.null()])),
}).strict().refine(value => Object.keys(value.values).length <= 14);
export const batchChunkSchema = z.object({
  chunkId: z.uuid(), expectedRevision: z.number().int().positive(), totalRows: z.number().int().min(1).max(500),
  rows: z.array(batchRowSchema).min(1).max(50),
}).strict().refine(value => new Set(value.rows.map(row => row.rowId)).size === value.rows.length && new Set(value.rows.map(row => row.rowNumber)).size === value.rows.length);
export const batchRevisionSchema = z.object({ expectedRevision: z.number().int().positive() }).strict();
export const batchApplySchema = z.object({ expectedRevision: z.number().int().positive(), previewRevision: z.number().int().positive(), planHash: z.string().regex(/^[a-f0-9]{64}$/), operationId: z.uuid() }).strict();
export const inventoryEditSchema = z.object({ expectedVersion: z.number().int().positive(), name: z.string().trim().min(1).max(160), sku: z.string().trim().min(1).max(80).transform(value => value.toUpperCase()).pipe(z.string().max(80)), minimumStock: z.number().int().min(0).max(2147483647) }).strict();
export const inventoryTermsSchema = z.object({ expectedVersion: z.number().int().positive().nullable(), unitSalePrice: inventoryMoney, referenceUnitCost: inventoryMoney.nullable() }).strict().refine(value => value.unitSalePrice !== undefined && value.referenceUnitCost !== undefined);
export const inventoryTermsView = z.object({ unitSalePrice: z.string(), referenceUnitCost: z.string().nullable(), currency: z.literal("COP"), version: z.number().int() });
export const inventoryItemViewSchema = z.object({ id: z.uuid(), name: z.string(), sku: z.string(), minimumStock: z.number().int(), stock: z.number().int(), dataVersion: z.number().int(), stockVersion: z.number().int(), commercialTerms: inventoryTermsView.nullable() });
export type InventoryItemView = z.infer<typeof inventoryItemViewSchema>;
export const inventoryPlanRowSchema = z.object({
  rowId: z.uuid(), rowNumber: z.number().int(), rowRevision: z.number().int(), selected: z.boolean(), itemId: z.uuid(),
  action: z.enum(["NEW", "MODIFIED", "UNCHANGED", "ERROR", "EXCLUDED"]),
  before: inventoryItemViewSchema.nullable(), values: inventoryValuesSchema,
  after: inventoryItemViewSchema.nullable(), delta: z.number().int(),
  errors: z.array(z.object({ field: z.string(), code: z.string(), message: z.string() })),
});
export const inventoryPlanSchema = z.array(inventoryPlanRowSchema).max(500);
export type InventoryPlanRow = z.infer<typeof inventoryPlanRowSchema>;
