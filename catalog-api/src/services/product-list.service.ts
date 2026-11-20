import { listProductPage, suggestProducts } from "../repositories/product-list.repository";
import type { ListedProduct } from "../repositories/product-list.repository";
import type { ProductListQuery } from "../schemas/product-list.schema";

export function makeProductListingService(sign: (path: string) => Promise<string>, store = { listProductPage, suggestProducts }) {
  return {
    async list(catalogId: string, userId: string, query: ProductListQuery) {
      const result = await store.listProductPage(catalogId, userId, query);
      if (!result) return null;
      const products = await Promise.all(result.products.map(async (product: ListedProduct) => {
        const inherited = product.inventoryItem?.images[0];
        const images = inherited
          ? [{ id: inherited.id, productId: product.id, url: await sign(inherited.storagePath), position: inherited.position, alt: inherited.alt }]
          : await Promise.all(product.images.map(async image => ({ ...image, url: await sign(image.url) })));
        return { ...product, stock: product.inventoryItem?.stock ?? product.stock, images };
      }));
      return { ...result, products };
    },
    suggest: store.suggestProducts,
  };
}
export type ProductListingService = ReturnType<typeof makeProductListingService>;
