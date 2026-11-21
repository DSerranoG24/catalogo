import { z } from "zod";
const money = z.preprocess(v => typeof v === "number" && Number.isSafeInteger(v) ? String(v) : v, z.string().refine(v => /^\d+$/.test(v) && BigInt(v) <= 9223372036854775807n, "COP entero válido"));
const quantity = z.number().int().positive().max(2147483647);
const uuid = z.uuid();
export const saleOperationStatusSchema = z.enum(["PREPARED", "SUCCEEDED", "REJECTED", "ABANDONED"]);
export const saleMovementRoleSchema = z.enum(["SALE_CONFIRMATION", "SALE_CANCELLATION", "SALE_RETURN_RESELLABLE", "SALE_RETURN_DAMAGED"]);
export const saleOperationSchema = z.object({ operationId: uuid, requestId: uuid, expectedSaleVersion: z.number().int().positive().nullable(), status: saleOperationStatusSchema, requestHash: z.string().regex(/^[a-f0-9]{64}$/), responseSnapshot: z.unknown().nullable() }).strict();
export const saleLineInputSchema = z.object({ inventoryItemId: uuid, quantity, unitDiscount: money }).strict();
export const createSaleSchema = z.object({ operationId: uuid, requestId: uuid, customerName: z.string().trim().max(160).optional(), customerPhone: z.string().trim().max(40).optional() }).strict();
export const updateDraftSaleSchema = z.object({ operationId: uuid, expectedVersion: z.number().int().positive(), lines: z.array(saleLineInputSchema).min(1).max(100), customerName: z.string().trim().max(160).nullable().optional(), customerPhone: z.string().trim().max(40).nullable().optional() }).strict();
export const confirmSaleSchema = z.object({ operationId: uuid, requestId: uuid, expectedVersion: z.number().int().positive(), deliverImmediately: z.boolean().default(false) }).strict();
export const transitionSaleSchema = z.object({ operationId: uuid, requestId: uuid, expectedVersion: z.number().int().positive() }).strict();
export const cancelSaleSchema = transitionSaleSchema.extend({ reason: z.string().trim().min(3).max(300) }).strict();
export const returnLineSchema = z.object({ saleLineId: uuid, receivedQuantity: quantity, resellableQuantity: z.number().int().min(0), damagedQuantity: z.number().int().min(0) }).strict().superRefine((v, ctx) => { if (v.resellableQuantity + v.damagedQuantity !== v.receivedQuantity) ctx.addIssue({ code: "custom", message: "La disposición debe coincidir con la cantidad recibida.", path: ["resellableQuantity"] }); });
export const returnSaleSchema = transitionSaleSchema.extend({ reason: z.string().trim().min(3).max(300), lines: z.array(returnLineSchema).min(1).max(100) }).strict();
export const convertOrderToSaleSchema = z.object({
  operationId: uuid,
  requestId: uuid,
  mode: z.enum(["DRAFT", "CONFIRMED", "DELIVERED"]).default("DRAFT"),
  acceptPriceDifference: z.boolean().default(false),
}).strict().superRefine((value, ctx) => { if (value.operationId === value.requestId) ctx.addIssue({ code: "custom", path: ["requestId"], message: "operationId y requestId deben ser distintos." }); });
