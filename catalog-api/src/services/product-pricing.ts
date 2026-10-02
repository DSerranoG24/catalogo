export type ProductPromotion = {
  price: number;
  salePrice: number | null;
  saleStartsAt: Date | null;
  saleEndsAt: Date | null;
};

export function validateProductPromotion(promotion: ProductPromotion) {
  const hasSalePrice = promotion.salePrice !== null;
  const hasSaleDates = promotion.saleStartsAt !== null || promotion.saleEndsAt !== null;

  if (!hasSalePrice) {
    if (hasSaleDates) throw new Error("INVALID_PRODUCT_PROMOTION");
    return;
  }

  if (
    !Number.isInteger(promotion.salePrice) ||
    promotion.salePrice! < 0 ||
    promotion.salePrice! >= promotion.price ||
    !promotion.saleStartsAt ||
    !promotion.saleEndsAt ||
    !Number.isFinite(promotion.saleStartsAt.getTime()) ||
    !Number.isFinite(promotion.saleEndsAt.getTime()) ||
    promotion.saleStartsAt >= promotion.saleEndsAt
  ) {
    throw new Error("INVALID_PRODUCT_PROMOTION");
  }
}

export function getCurrentProductPricing(
  promotion: ProductPromotion,
  now = new Date()
) {
  validateProductPromotion(promotion);

  const saleIsActive = Boolean(
    promotion.salePrice !== null &&
    promotion.saleStartsAt &&
    promotion.saleEndsAt &&
    now >= promotion.saleStartsAt &&
    now < promotion.saleEndsAt
  );

  if (!saleIsActive) {
    return {
      price: promotion.price,
      regularPrice: null,
      discountPercent: null,
      saleEndsAt: null,
    };
  }

  return {
    price: promotion.salePrice!,
    regularPrice: promotion.price,
    discountPercent: Math.round(((promotion.price - promotion.salePrice!) / promotion.price) * 100),
    saleEndsAt: promotion.saleEndsAt!.toISOString(),
  };
}