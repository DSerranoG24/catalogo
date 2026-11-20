import { z } from "zod";

const mappingField = z.enum(["ignore", "id", "name", "sku", "quantity", "unitSalePrice", "referenceUnitCost", "minimumStock"]);
export const workbookPreviewSchema = z.object({
  workbookId: z.string().trim().min(1).max(160), sheetId: z.string().trim().min(1).max(160),
  expectedVersion: z.number().int().positive(), headerRow: z.number().int().min(1).max(10000),
  firstRow: z.number().int().min(1).max(10000), lastRow: z.number().int().min(1).max(10000),
  confirmed: z.literal(true),
  mapping: z.record(z.string().regex(/^\d+$/), mappingField),
}).strict().superRefine((v, ctx) => {
  if (v.firstRow <= v.headerRow || v.lastRow < v.firstRow || v.lastRow - v.firstRow + 1 > 500) ctx.addIssue({ code: "custom", message: "El rango debe estar después de los encabezados y contener máximo 500 filas.", path: ["firstRow"] });
  const mapped = Object.values(v.mapping).filter(x => x !== "ignore");
  if (!mapped.includes("sku") && !mapped.includes("id")) ctx.addIssue({ code: "custom", message: "Asigna SKU o ID para identificar los productos.", path: ["mapping"] });
  if (new Set(mapped).size !== mapped.length) ctx.addIssue({ code: "custom", message: "No puedes asignar el mismo significado a dos columnas.", path: ["mapping"] });
});
export type WorkbookPreviewInput = z.infer<typeof workbookPreviewSchema>;
export const workbookPreviewApplySchema = workbookPreviewSchema.extend({ batchId: z.uuid(), operationId: z.uuid(), reason: z.string().trim().min(3).max(300) }).strict();
export type WorkbookPreviewApplyInput = z.infer<typeof workbookPreviewApplySchema>;
