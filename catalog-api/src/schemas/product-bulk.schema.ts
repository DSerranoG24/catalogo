import { z } from "zod";

const date = z.iso.datetime({ offset: true }).max(32);
const amount = z.number().int().min(0).max(2147483647);
export const bulkOperationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("delete") }).strict(),
  z.object({ action: z.literal("discard") }).strict(),
  z.object({ action: z.literal("price"), price: amount }).strict(),
  z.object({ action: z.literal("promotion"), promotion: z.object({ salePrice: amount, saleStartsAt: date, saleEndsAt: date }).strict().nullable() }).strict(),
  z.object({ action: z.literal("category"), categoryId: z.string().uuid().nullable() }).strict(),
]);
export const bulkPreviewSchema = z.object({
  items: z.array(z.object({ id: z.string().uuid(), updatedAt: date }).strict()).min(1).max(96)
    .refine(items => new Set(items.map(item => item.id)).size === items.length, "No repitas productos"),
  operation: bulkOperationSchema,
}).strict();
export const bulkConfirmSchema = z.object({ token: z.string().min(1).max(24000), confirmation: z.string().max(80).optional() }).strict();
export type BulkRequest = z.infer<typeof bulkPreviewSchema>;
export type BulkOperation = z.infer<typeof bulkOperationSchema>;
