import type { PublicProduct } from "./api";

export type PublicCartItem = { quantity: number; unitPrice: number | null };
export type PublicCart = { version: number; items: Record<string, PublicCartItem> };
export type PublicCartRow = { productId: string; item: PublicCartItem; product: PublicProduct | null; unavailable: boolean; priceChanged: boolean; subtotal: number };

export function parsePublicCart(raw: string | null): PublicCart;
export function serializePublicCart(cart: PublicCart): string;
export function publicCartQuantities(cart: PublicCart): Record<string, number>;
export function setPublicCartQuantity(cart: PublicCart, product: PublicProduct, quantity: number): PublicCart;
export function removePublicCartItem(cart: PublicCart, productId: string): PublicCart;
export function hydratePublicCartPrices(cart: PublicCart, products: PublicProduct[]): PublicCart;
export function acceptPublicCartPrices(cart: PublicCart, products: PublicProduct[]): PublicCart;
export function reconcilePublicCart(cart: PublicCart, products: PublicProduct[]): { rows: PublicCartRow[]; total: number; hasPriceChanges: boolean; hasUnavailable: boolean };
export function canSubmitPublicCart(reconciliation: ReturnType<typeof reconcilePublicCart>): boolean;
