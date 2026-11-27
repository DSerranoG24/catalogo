// Pure helpers of Vender › Nueva venta (F2a-3a): availability of a product and the payment box of the ticket.
// Money is a decimal string or BigInt, never a Number. The total is always the server's (the saved draft);
// these helpers only split it among payment rows, they never compute what a sale costs.

/** Payment methods the API accepts (F2a-2b), plus CREDIT for «Saldo a favor» (sent as customerCreditAmount). */
export const PAYMENT_METHODS = ["CASH", "NEQUI", "DAVIPLATA", "BANK_TRANSFER", "CARD", "CREDIT"];
export const TRANSFER_METHODS = ["NEQUI", "DAVIPLATA", "BANK_TRANSFER"];
export const METHOD_LABELS = { CASH: "Efectivo", NEQUI: "Nequi", DAVIPLATA: "Daviplata", BANK_TRANSFER: "Transferencia bancaria", CARD: "Tarjeta", CREDIT: "Saldo a favor" };
/** The four buttons of the payment box. Transferencia opens as Nequi and can switch to Daviplata or banco. */
export const METHOD_BUTTONS = [
  { id: "CASH", label: "Efectivo", method: "CASH" },
  { id: "TRANSFER", label: "Transferencia", method: "NEQUI" },
  { id: "CARD", label: "Tarjeta", method: "CARD" },
  { id: "CREDIT", label: "Saldo a favor", method: "CREDIT" },
];
const MAX = 1_000_000_000_000n;

/** Digits of an amount typed with thousands separators ("12.345" → 12345n). Empty, commas or letters → null. */
export function parseAmountText(text) {
  const raw = String(text ?? "").trim().replaceAll(".", "");
  if (!/^[0-9]+$/.test(raw)) return null;
  const value = BigInt(raw);
  return value > MAX ? null : value;
}
/** 12345n → "12.345" (the format of the amount fields). */
export function amountText(value) {
  return BigInt(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** Sum of the valid row amounts. Invalid rows count as 0 here and are reported by validatePayments. */
export function paidOf(rows) {
  return rows.reduce((sum, row) => sum + (parseAmountText(row.amount) ?? 0n), 0n);
}
/** What is missing or left over against the server total. */
export function paymentStatus(total, rows) {
  const due = BigInt(total), paid = paidOf(rows);
  const remaining = due > paid ? due - paid : 0n, excess = paid > due ? paid - due : 0n;
  return { total: due, paid, remaining, excess, complete: paid === due };
}
/** Change of one cash row: received − amount, or null when nothing (or too little) was received. */
export function cashChange(row) {
  if (row.method !== "CASH") return null;
  const amount = parseAmountText(row.amount), received = parseAmountText(row.received);
  if (amount === null || received === null || received < amount) return null;
  return received - amount;
}
export const totalChange = rows => rows.reduce((sum, row) => sum + (cashChange(row) ?? 0n), 0n);

/**
 * Adds the row of a method with what is still missing as its default amount (0 when complete). «Saldo a favor» is
 * a single row and never proposes more than the customer has; tapping it again does nothing.
 */
export function addPaymentRow(rows, button, total, creditAvailable, key) {
  if (button.method === "CREDIT" && rows.some(row => row.method === "CREDIT")) return rows;
  const { remaining } = paymentStatus(total, rows);
  let amount = remaining;
  if (button.method === "CREDIT") amount = remaining < BigInt(creditAvailable ?? 0) ? remaining : BigInt(creditAvailable ?? 0);
  return [...rows, { key, method: button.method, amount: amount > 0n ? amountText(amount) : "", received: "" }];
}

/**
 * Checks the rows against the server total. `deliver` (Cobrar y entregar) needs exactly the total, because fiado is
 * off until F2; `later` (Confirmar, entregar después) accepts an advance from 0 up to the total.
 */
export function validatePayments(total, rows, creditAvailable) {
  const errors = [];
  if (rows.some(row => { const value = parseAmountText(row.amount); return value === null || value < 1n; })) errors.push("Escribe el importe de cada pago (mínimo $ 1).");
  if (rows.some(row => row.method === "CASH" && row.received && parseAmountText(row.received) === null)) errors.push("Revisa el efectivo recibido: solo números.");
  if (rows.some(row => row.method === "CASH" && parseAmountText(row.received) !== null && parseAmountText(row.amount) !== null && parseAmountText(row.received) < parseAmountText(row.amount)))
    errors.push("El efectivo recibido no alcanza para el pago en efectivo.");
  const credit = rows.filter(row => row.method === "CREDIT").reduce((sum, row) => sum + (parseAmountText(row.amount) ?? 0n), 0n);
  if (credit > BigInt(creditAvailable ?? 0)) errors.push(`El saldo a favor disponible es ${formatPesos(creditAvailable ?? 0)}.`);
  const status = paymentStatus(total, rows);
  if (status.excess > 0n) errors.push(`Los pagos superan el total por ${formatPesos(status.excess)}. Si te dieron de más en efectivo, escríbelo en «Recibido».`);
  const valid = errors.length === 0;
  return {
    errors, status,
    canDeliver: valid && status.complete,
    canConfirmLater: valid,
    deliverBlockedReason: !valid ? null : status.complete ? null
      : `Falta ${formatPesos(status.remaining)}. Por ahora la venta se entrega pagada por completo: registra el resto o usa «Confirmar, entregar después».`,
  };
}

/** Body fields of confirm (F2a-2b): payments always present (so the sale is TRACKED), credit apart. */
export function paymentsBody(rows) {
  const payments = rows.filter(row => row.method !== "CREDIT").map(row => {
    const amount = parseAmountText(row.amount).toString(), received = row.method === "CASH" ? parseAmountText(row.received) : null;
    return { method: row.method, amount, ...(received !== null && received >= BigInt(amount) ? { cashReceived: received.toString() } : {}) };
  });
  const credit = rows.filter(row => row.method === "CREDIT").reduce((sum, row) => sum + parseAmountText(row.amount), 0n);
  return { payments, ...(credit > 0n ? { customerCreditAmount: credit.toString() } : {}) };
}

/** "$ 12.345" with a non-breaking space, like formatCop in sales-ui. */
export function formatPesos(value) {
  const amount = BigInt(value), negative = amount < 0n;
  return `${negative ? "−" : ""}$ ${amountText(negative ? -amount : amount)}`;
}

/** One availability fact per product card: Agotado (red), Quedan n (orange, at or under the minimum or ≤ 3) or n disponibles. */
export function availability(stock, minimumStock = 0) {
  if (stock <= 0) return { tone: "out", label: "Agotado" };
  if (stock <= Math.max(minimumStock, 3)) return { tone: "low", label: `Quedan ${stock}` };
  return { tone: "ok", label: `${stock} disponible${stock === 1 ? "" : "s"}` };
}

/** Inventory items for the product grid (GET /inventory/items). Items without price can't be sold. */
export function parsePosItems(value) {
  const items = value?.result?.items;
  if (!Array.isArray(items)) throw new Error("No se pudo validar la lista de productos.");
  return items.map(raw => {
    if (!raw || typeof raw.id !== "string" || typeof raw.name !== "string" || typeof raw.sku !== "string" || !Number.isSafeInteger(raw.stock)) throw new Error("No se pudo validar la lista de productos.");
    const price = raw.commercialTerms?.unitSalePrice;
    return { id: raw.id, name: raw.name, sku: raw.sku, stock: raw.stock, minimumStock: Number.isSafeInteger(raw.minimumStock) ? raw.minimumStock : 0,
      price: typeof price === "string" && /^[0-9]+$/.test(price) ? price : null };
  });
}
/** GET /customers/:id/credit → balance as a decimal string. */
export function parseCreditBalance(value) {
  const balance = value?.result?.balance;
  if (typeof balance !== "string" || !/^[0-9]+$/.test(balance)) throw new Error("No se pudo leer el saldo a favor.");
  return balance;
}
