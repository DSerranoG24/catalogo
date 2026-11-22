export type CartQuote = {
  token: string;
  available: boolean;
  lines: { productId: string; quantity: number; product: null | {
    id: string; name: string; price: number; stock: number;
    regularPrice: number | null; discountPercent: number | null; saleEndsAt: string | null;
  } }[];
};
export function parsePublicCartQuote(value: unknown, items: { productId: string; quantity: number }[]): CartQuote;
export function isConfirmedCartQuote(quote: CartQuote | null, token: string | null, items: { productId: string; quantity: number }[]): boolean;
