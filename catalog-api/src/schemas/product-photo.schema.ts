import { z } from "zod";

export const photoPlanInput = z.object({ count: z.number().int().min(1).max(30) }).strict();
export const photoPlan = z.object({
  purpose: z.literal("PRODUCT_PHOTOS"), userId: z.string().uuid(), catalogId: z.string().uuid(),
  products: z.array(z.string().uuid()).min(1).max(30), expiresAt: z.number().int(),
}).strict();
export const photoItemInput = z.object({ token: z.string().max(4096), index: z.coerce.number().int().min(0).max(29) }).strict();
export const completePhotoInput = z.object({
  name: z.string().trim().min(1).max(150), price: z.number().int().min(0).max(2147483647),
  reviewed: z.literal(true), categoryId: z.string().uuid().nullable().optional(),
  description: z.string().trim().max(2000).optional(),
}).strict();
export type CompletePhotoInput = z.infer<typeof completePhotoInput>;
