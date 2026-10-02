import { z } from "zod";

export const createProductSchema = z.object({
  categoryId: z.string().uuid().optional(),

  name: z.string().min(1).max(150),

  slug: z
    .string()
    .min(1)
    .max(150)
    .regex(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      "El slug solo puede contener letras minúsculas, números y guiones"
    ),

  description: z.string().max(2000).optional(),

  brand: z.string().max(100).optional(),

  model: z.string().max(100).optional(),

  sku: z.string().max(100).optional(),

  price: z.number().int().min(0),

  salePrice: z.number().int().min(0).nullable().optional(),

  saleStartsAt: z.iso.datetime({ offset: true }).nullable().optional(),

  saleEndsAt: z.iso.datetime({ offset: true }).nullable().optional(),

  stock: z.number().int().min(0).optional(),

  specs: z.record(z.string(), z.any()).optional(),
});

export const updateProductSchema = z.object({
  categoryId: z.string().uuid().optional(),

  name: z.string().min(1).max(150).optional(),

  slug: z
    .string()
    .min(1)
    .max(150)
    .regex(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      "El slug solo puede contener letras minúsculas, números y guiones"
    )
    .optional(),

  description: z.string().max(2000).optional(),

  brand: z.string().max(100).optional(),

  model: z.string().max(100).optional(),

  sku: z.string().max(100).optional(),

  price: z.number().int().min(0).optional(),

  salePrice: z.number().int().min(0).nullable().optional(),

  saleStartsAt: z.iso.datetime({ offset: true }).nullable().optional(),

  saleEndsAt: z.iso.datetime({ offset: true }).nullable().optional(),

  stock: z.number().int().min(0).optional(),

  active: z.boolean().optional(),

  specs: z.record(z.string(), z.any()).optional(),
});