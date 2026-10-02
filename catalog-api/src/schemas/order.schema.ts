import { OrderStatus } from "@prisma/client";
import { z } from "zod";

export const createPublicOrderSchema = z.object({
  customerName: z.string().trim().min(1).max(100),
  customerPhone: z.string().trim().min(7).max(24).regex(/^[+0-9() .-]+$/),
  customerEmail: z.string().trim().email().max(254).optional().or(z.literal("")),
  customerAddress: z.string().trim().min(5).max(300),
  consent: z.literal(true),
  notes: z.string().trim().max(500).optional(),
  items: z.array(z.object({
    productId: z.string().uuid(),
    quantity: z.number().int().min(1).max(99),
  })).min(1).max(50).refine(
    (items) => new Set(items.map((item) => item.productId)).size === items.length,
    "No repitas productos en la orden"
  ),
});

export const updateOrderSchema = z.object({
  status: z.nativeEnum(OrderStatus),
});
