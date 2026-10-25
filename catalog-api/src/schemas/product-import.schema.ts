import { z } from "zod";
import { createProductSchema } from "./product.schema";

export const IMPORT_BATCH_LIMIT = 50;
export const IMPORT_FILE_LIMIT = 500;
const blank = (v: unknown) => v === null || (typeof v === "string" && !v.trim()) ? undefined
  : typeof v === "string" ? v.trim().normalize("NFC") : v;
const fields = createProductSchema.shape;
export const importProductRowSchema = z.object({
  rowNumber: z.number().int().min(2).max(1048576),
  name: z.preprocess(blank, fields.name),
  brand: z.preprocess(blank, fields.brand),
  model: z.preprocess(blank, fields.model),
  sku: z.preprocess(blank, fields.sku),
  description: z.preprocess(blank, fields.description),
  price: z.preprocess(blank, fields.price.max(2147483647).optional()),
  stock: z.preprocess(blank, fields.stock.unwrap().max(2147483647).optional()),
  salePrice: z.preprocess(blank, fields.salePrice.unwrap().unwrap().max(2147483647).optional()),
  saleStartsAt: z.preprocess(blank, fields.saleStartsAt),
  saleEndsAt: z.preprocess(blank, fields.saleEndsAt),
  saleEnabled: z.preprocess(blank, z.boolean().optional()),
  categoryName: z.preprocess(blank, z.string().max(100).optional()),
}).strict();
export type ImportProductRow = z.infer<typeof importProductRowSchema>;

const rowEnvelope = z.object({ rowNumber: z.number().int().min(2).max(1048576) }).loose();
export const importBatchSchema = z.object({
  totalRows: z.number().int().min(1).max(IMPORT_FILE_LIMIT),
  rows: z.array(rowEnvelope).min(1).max(IMPORT_BATCH_LIMIT),
  previewToken: z.string().max(524288).optional(),
}).strict().refine(v => new Set(v.rows.map(r => r.rowNumber)).size === v.rows.length, "Número de fila repetido");
export type ImportBatch = z.infer<typeof importBatchSchema>;
