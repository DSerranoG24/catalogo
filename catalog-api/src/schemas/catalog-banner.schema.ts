import { z } from "zod";

export function allowedBannerUrl(value: string) {
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password;
  } catch { return false; }
}

export const bannerFieldsSchema = z.object({
  title: z.string().trim().min(1).max(150),
  subtitle: z.string().trim().max(300).nullable().optional(),
  linkType: z.enum(["PRODUCT", "CATEGORY", "EXTERNAL"]),
  linkValue: z.string().trim().min(1).max(2048),
  position: z.number().int().min(0).max(2).optional(),
  active: z.boolean().optional(),
});
export const createBannerSchema = bannerFieldsSchema.superRefine(validateLink);
export const updateBannerSchema = bannerFieldsSchema.partial();

function validateLink(value: { linkType: string; linkValue: string }, ctx: z.RefinementCtx) {
  if (value.linkType === "EXTERNAL" ? !allowedBannerUrl(value.linkValue) : !z.string().uuid().safeParse(value.linkValue).success) {
    ctx.addIssue({ code: "custom", path: ["linkValue"], message: "El destino del banner no es válido." });
  }
}
export type BannerInput = z.infer<typeof createBannerSchema>;

export const bannerOrderSchema = z.object({ ids: z.array(z.string().uuid()).max(3) })
  .refine(value => new Set(value.ids).size === value.ids.length, "No repitas banners.");
