import { z } from "zod";

const phoneSchema = z.string().trim().max(30).regex(/^\+?[0-9\s().-]+$/).refine(
  (value) => value.replace(/\D/g, "").length >= 7,
  "El teléfono debe incluir al menos 7 dígitos"
);
const httpUrlSchema = z.string().trim().url().max(2048).refine((value) => {
  try {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}, "La URL debe usar HTTP o HTTPS");

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
  description: z.string().max(500).nullable().optional(),
  whatsappPhone: z.string().regex(/^\+[1-9]\d{7,14}$/).optional(),
  phone: phoneSchema.optional(),
  address: z.string().trim().max(250).optional(),
  businessHours: z.string().trim().max(500).optional(),
  instagramUrl: httpUrlSchema.optional(),
  facebookUrl: httpUrlSchema.optional(),
  tiktokUrl: httpUrlSchema.optional(),
  email: z.string().trim().email().max(254).optional(),
  mapUrl: httpUrlSchema.optional(),
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
  description: z.string().max(500).nullable().optional(),
  active: z.boolean().optional(),
  whatsappPhone: z.string().regex(/^\+[1-9]\d{7,14}$/).nullable().optional(),
  phone: phoneSchema.nullable().optional(),
  address: z.string().trim().max(250).nullable().optional(),
  businessHours: z.string().trim().max(500).nullable().optional(),
  instagramUrl: httpUrlSchema.nullable().optional(),
  facebookUrl: httpUrlSchema.nullable().optional(),
  tiktokUrl: httpUrlSchema.nullable().optional(),
  email: z.string().trim().email().max(254).nullable().optional(),
  mapUrl: httpUrlSchema.nullable().optional(),
  template: z.enum(["EDITORIAL", "GRID", "BOUTIQUE"]).optional(),
});