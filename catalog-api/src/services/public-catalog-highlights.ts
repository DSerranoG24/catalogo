import { allowedBannerUrl } from "../schemas/catalog-banner.schema";

export function resolvePublicHighlights<P extends { id: string; featured: boolean }, B extends { linkType: string; linkValue: string; position: number }>(products: P[], categories: { id: string }[], banners: B[]) {
  const selected = products.filter(product => product.featured).slice(0, 5);
  const productIds = new Set(products.map(product => product.id));
  const categoryIds = new Set(categories.map(category => category.id));
  return {
    featuredProducts: selected.length >= 3 ? selected : [],
    banners: banners.filter(banner => banner.linkType === "PRODUCT" ? productIds.has(banner.linkValue)
      : banner.linkType === "CATEGORY" ? categoryIds.has(banner.linkValue)
      : banner.linkType === "EXTERNAL" && allowedBannerUrl(banner.linkValue))
      .sort((left, right) => left.position - right.position).slice(0, 3),
  };
}
