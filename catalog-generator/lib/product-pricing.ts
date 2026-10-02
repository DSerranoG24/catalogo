import type { Product } from "@/lib/api";

export type SellerPromotionStatus = "active" | "scheduled" | "expired";

export function getDiscountPercent(regularPrice: number, salePrice: number) {
  if (regularPrice <= 0 || salePrice < 0 || salePrice >= regularPrice) return 0;
  return Math.round(((regularPrice - salePrice) / regularPrice) * 100);
}

export function getSellerPromotionStatus(
  product: Pick<Product, "salePrice" | "saleStartsAt" | "saleEndsAt">,
  now = new Date()
): SellerPromotionStatus | null {
  if (product.salePrice === null) return null;
  if (!product.saleStartsAt || !product.saleEndsAt) return "expired";

  const startsAt = new Date(product.saleStartsAt);
  const endsAt = new Date(product.saleEndsAt);
  if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime())) return "expired";
  if (now < startsAt) return "scheduled";
  if (now >= endsAt) return "expired";
  return "active";
}

export function toDateTimeLocalValue(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}