import { z } from "zod";

export const createProductReviewSchema = z.object({
  displayName: z.string().trim().min(2).max(60).optional(),
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().min(10).max(1200),
});

export const moderateProductReviewSchema = z.object({
  status: z.enum(["APPROVED", "REJECTED"]),
});