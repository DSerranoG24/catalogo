const money = value => Number.isSafeInteger(value) && value >= 0;
export function parsePublicCartQuote(value, items) {
  const invalid = () => { throw new Error("No se pudo validar la cotización. Intenta actualizarla."); };
  if (!value || typeof value !== "object" || !/^q1\.[a-f0-9]{64}$/.test(value.token) || typeof value.available !== "boolean" || !Array.isArray(value.lines) || value.lines.length !== items.length) invalid();
  const seen = new Set();
  for (const line of value.lines) {
    const item = items.find(item => item.productId === line?.productId);
    if (!item || line.quantity !== item.quantity || seen.has(line.productId)) invalid();
    seen.add(line.productId);
    const p = line.product;
    if (p !== null && (!p || p.id !== line.productId || typeof p.name !== "string" || !money(p.price) || !Number.isSafeInteger(p.stock) || (p.regularPrice !== null && !money(p.regularPrice)) || (p.discountPercent !== null && !Number.isFinite(p.discountPercent)) || (p.saleEndsAt !== null && (typeof p.saleEndsAt !== "string" || !Number.isFinite(Date.parse(p.saleEndsAt)))))) invalid();
  }
  if (value.available !== value.lines.every(line => line.product !== null)) invalid();
  return value;
}

export function isConfirmedCartQuote(quote, token, items) {
  return Boolean(quote?.available && quote.token === token && quote.lines.length === items.length && quote.lines.every(line => items.some(item => item.productId === line.productId && item.quantity === line.quantity)));
}
