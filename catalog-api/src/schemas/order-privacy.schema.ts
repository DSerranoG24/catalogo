import { z } from "zod";

export const sellerFields = ["name", "nit", "phone", "whatsappPhone", "address", "businessHours", "email", "instagramUrl", "facebookUrl", "tiktokUrl", "quotationTerms"] as const;
export const anonymizeOrderSchema = z.object({
  confirmation: z.literal("ANONIMIZAR"),
  clientDataReviewed: z.literal(true),
  redactProductNames: z.boolean(),
  redactSellerFields: z.array(z.enum(sellerFields)).max(sellerFields.length),
}).strict();
export type AnonymizeOrderInput = z.infer<typeof anonymizeOrderSchema>;

export const deleteOrderSchema = z.object({
  confirmation: z.literal("ELIMINAR"),
  customerName: z.string().min(1).max(100),
}).strict();
