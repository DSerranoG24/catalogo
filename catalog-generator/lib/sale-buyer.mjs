export function saleBuyer(sale) {
  return {
    name: sale.customerNameSnapshot ?? sale.customerName ?? null,
    phone: sale.customerPhoneSnapshot ?? sale.customerPhone ?? null,
    email: sale.customerEmailSnapshot ?? null,
  };
}
