import { getCurrentProductPricing } from "./product-pricing";

const MAX_INT = 2_147_483_647;

export type PublicOrderProduct = {
  id: string;
  name: string;
  price: number;
  salePrice: number | null;
  saleStartsAt: Date | null;
  saleEndsAt: Date | null;
};

export function calculatePublicOrder(items: { productId: string; quantity: number }[], products: PublicOrderProduct[], now = new Date()) {
  if (products.length !== items.length) throw new Error("PRODUCTS_UNAVAILABLE");

  const productById = new Map(products.map((product) => [product.id, product]));
  const orderItems = items.map((item) => {
    const product = productById.get(item.productId);
    if (!product) throw new Error("PRODUCTS_UNAVAILABLE");
    const unitPrice = getCurrentProductPricing(product, now).price;
    const subtotal = unitPrice * item.quantity;
    if (subtotal > MAX_INT) throw new Error("ORDER_TOTAL_INVALID");
    return { productId: product.id, productName: product.name, quantity: item.quantity, unitPrice, subtotal };
  });
  const total = orderItems.reduce((sum, item) => sum + item.subtotal, 0);
  if (total > MAX_INT) throw new Error("ORDER_TOTAL_INVALID");

  return { items: orderItems, total };
}
