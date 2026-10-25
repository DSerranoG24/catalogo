import { z } from "zod";

const optionalText = z.string().max(4000).nullable();
export const quotationSellerSchema = z.object({
  name: z.string().min(1).max(100),
  nit: optionalText,
  phone: optionalText,
  whatsappPhone: optionalText,
  address: optionalText,
  businessHours: optionalText,
  email: optionalText,
  instagramUrl: optionalText,
  facebookUrl: optionalText,
  tiktokUrl: optionalText,
  quotationTerms: optionalText,
});
export type QuotationSeller = z.infer<typeof quotationSellerSchema>;
export const QUOTATION_VALIDITY_DAYS = 15;

export function quotationLabel(number: number): string {
  if (!Number.isSafeInteger(number) || number < 1) throw new Error("INVALID_QUOTATION_NUMBER");
  return `COT-${String(number).padStart(6, "0")}`;
}

export function quotationBaseUrl(): string {
  const value = process.env.PUBLIC_API_URL;
  if (!value) throw new Error("PUBLIC_API_URL_REQUIRED");
  const url = new URL(value);
  const local = process.env.NODE_ENV !== "production" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(local && url.protocol === "http:"))
    || url.username || url.password || url.search || url.hash
    || !url.pathname.replace(/\/$/, "").endsWith("/api")) throw new Error("INVALID_PUBLIC_API_URL");
  return url.toString().replace(/\/$/, "");
}

export function quotationUrl(base: string, publicId: string, orderId: string, token: string): string {
  return `${base}/public/catalogs/${encodeURIComponent(publicId)}/orders/${encodeURIComponent(orderId)}/quotation.pdf?token=${encodeURIComponent(token)}`;
}
