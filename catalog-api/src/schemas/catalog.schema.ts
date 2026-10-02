import { z } from "zod";

export const createCatalogSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z
    .string()
    .min(1)
    .max(100)
    .regex(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      "El slug solo puede contener letras minúsculas, números y guiones"
    ),
  description: z.string().max(500).optional(),
  whatsappPhone: z.string().regex(/^\+[1-9]\d{7,14}$/).optional(),
  template: z.enum(["EDITORIAL", "GRID", "BOUTIQUE"]).optional(),
});

export const updateCatalogSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  slug: z
    .string()
    .min(1)
    .max(100)
    .regex(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      "El slug solo puede contener letras minúsculas, números y guiones"
    )
    .optional(),
  description: z.string().max(500).optional(),
  active: z.boolean().optional(),
  whatsappPhone: z.string().regex(/^\+[1-9]\d{7,14}$/).nullable().optional(),
  template: z.enum(["EDITORIAL", "GRID", "BOUTIQUE"]).optional(),
});