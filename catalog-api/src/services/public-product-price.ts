const MAX_PRODUCT_PRICE = 2_147_483_647n;

type PublicPriceSource = {
  price: number;
  inventoryItem?: { userId: string; commercialTerms: { userId: string; unitSalePrice: bigint } | null } | null;
  publication?: { userId: string; priceOverride: number | null } | null;
};

export function resolvePublicProductPrice(product: PublicPriceSource, catalogUserId: string) {
  if (product.inventoryItem == null) return product.price;
  if (product.inventoryItem.userId !== catalogUserId) return null;
  const override = product.publication?.userId === catalogUserId ? product.publication.priceOverride : null;
  if (override !== null) return override;
  const terms = product.inventoryItem.commercialTerms;
  if (!terms || terms.userId !== catalogUserId || terms.unitSalePrice < 0n || terms.unitSalePrice > MAX_PRODUCT_PRICE) return null;
  return Number(terms.unitSalePrice);
}
