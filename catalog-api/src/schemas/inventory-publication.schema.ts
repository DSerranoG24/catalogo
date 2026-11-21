import { z } from "zod";
const uuid = z.uuid();
const money = z.preprocess(v => typeof v === "number" && Number.isSafeInteger(v) ? v : v, z.number().int().min(0).max(2147483647).optional().nullable());
export const inventoryPublicationStatusSchema = z.enum(["DRAFT", "PUBLISHED", "UNPUBLISHED"]);
export const inventoryPublicationSchema = z.object({ id: uuid, inventoryItemId: uuid, catalogId: uuid, productId: uuid, userId: uuid, status: inventoryPublicationStatusSchema, titleOverride: z.string().trim().min(1).max(160).nullable(), descriptionOverride: z.string().trim().max(5000).nullable(), priceOverride: money, version: z.number().int().positive() }).strict();
export const createInventoryPublicationSchema = z.object({ operationId: uuid, inventoryItemId: uuid, catalogId: uuid, titleOverride: z.string().trim().min(1).max(160).optional().nullable(), descriptionOverride: z.string().trim().max(5000).optional().nullable(), priceOverride: money }).strict();
export const updateInventoryPublicationSchema = z.object({ operationId: uuid, expectedVersion: z.number().int().positive(), status: inventoryPublicationStatusSchema.optional(), titleOverride: z.string().trim().min(1).max(160).optional().nullable(), descriptionOverride: z.string().trim().max(5000).optional().nullable(), priceOverride: money }).strict();
