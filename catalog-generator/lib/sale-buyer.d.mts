export function saleBuyer(sale: {
  customerNameSnapshot?: string | null; customerPhoneSnapshot?: string | null; customerEmailSnapshot?: string | null;
  customerName?: string | null; customerPhone?: string | null;
}): { name: string | null; phone: string | null; email: string | null };
