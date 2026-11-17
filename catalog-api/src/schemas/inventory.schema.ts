import { z } from "zod";

const quantity = z.number().int().min(0).max(2147483647);
export const inventoryItemSchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1).max(160),
  sku: z.string().trim().min(1).max(80).transform(value => value.toUpperCase()),
  minimumStock: quantity,
}).strict();
export const inventoryPageSchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  q: z.string().trim().max(160).default(""),
});
export const inventoryMovementSchema = z.object({
  key: z.uuid(),
  type: z.enum(["IN", "OUT", "ADJUSTMENT"]),
  quantity,
  reason: z.string().trim().min(3).max(300),
}).strict().refine(value => value.type === "ADJUSTMENT" || value.quantity > 0);
export type InventoryMovementInput = z.infer<typeof inventoryMovementSchema>;
