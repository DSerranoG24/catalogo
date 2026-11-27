// Pure helpers of Vender › Historial and the sale detail panel (F2a-3b). No network. Money is a decimal string or
// BigInt, never a Number, and every figure (paid, balance, refundDue…) is the server's (GET /sales, GET /sales/:id,
// docs/sales-payments-cartera-contract.md section 17). These helpers only validate, label and choose actions.
import { displayStatus, hasPendingUnits } from "./sales-ui.mjs";

const object = v => v !== null && typeof v === "object" && !Array.isArray(v);
const money = v => typeof v === "string" && /^(0|[1-9][0-9]*)$/.test(v);
const text = v => v === null || v === undefined || typeof v === "string";
const date = v => typeof v === "string" && Number.isFinite(Date.parse(v));
const uuidText = v => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const STAGES = ["PENDING_ORDER", "PAID", "BALANCE_DUE", "REFUND_DUE", "SETTLED"];
const KINDS = ["PAYMENT", "CREDIT_USE", "EXCESS_TO_CREDIT", "SALE_REFUND", "REVERSAL", "RECEIPT_ALLOCATION"];
const METHODS = ["CASH", "NEQUI", "DAVIPLATA", "BANK_TRANSFER", "CARD", "OTHER"];

export const isSaleId = uuidText;

/** Status filter of Historial: every display status, including «Devuelta parcialmente». */
export const HISTORY_FILTERS = ["all", "DRAFT", "CONFIRMED", "DELIVERED", "PARTIALLY_RETURNED", "RETURNED", "CANCELLED"];
export const FILTER_LABELS = { all: "Todos los estados", DRAFT: "Borrador", CONFIRMED: "Confirmada", DELIVERED: "Entregada", PARTIALLY_RETURNED: "Devuelta parcialmente", RETURNED: "Devuelta", CANCELLED: "Cancelada" };
/** Status pills in the panel palette (text on background ≥ 4.5:1), without the old green. */
export const VY_STATUS_TONES = {
  DRAFT: "border-[#CBD5E6] bg-[#F1F4FA] text-[#4A5878]",
  CONFIRMED: "border-[#B9CCF7] bg-[#E8EFFE] text-[#0341BD]",
  DELIVERED: "border-[#ABEFC6] bg-[#ECFDF3] text-[#067647]",
  PARTIALLY_RETURNED: "border-[#F9DBAF] bg-[#FFF6ED] text-[#B93815]",
  RETURNED: "border-[#D9D6FE] bg-[#F4F3FF] text-[#5925DC]",
  CANCELLED: "border-[#FECDCA] bg-[#FEF3F2] text-[#B42318]",
};
export const STAGE_LABELS = { PENDING_ORDER: "Por cobrar", PAID: "Pagada", BALANCE_DUE: "Con saldo", REFUND_DUE: "Por devolver", SETTLED: "Sin saldo" };
export const REFUND_METHODS = METHODS;
export const REFUND_METHOD_LABELS = { CASH: "Efectivo", NEQUI: "Nequi", DAVIPLATA: "Daviplata", BANK_TRANSFER: "Transferencia bancaria", CARD: "Tarjeta", OTHER: "Otro" };

function validEntry(e) {
  return object(e) && uuidText(e.id) && KINDS.includes(e.kind) && money(e.amount) && (e.method === null || METHODS.includes(e.method))
    && text(e.methodNote) && text(e.reference) && (e.cashReceived === null || money(e.cashReceived)) && (e.change === null || money(e.change))
    && (e.reversesEntryId === null || uuidText(e.reversesEntryId)) && text(e.reason) && typeof e.voided === "boolean" && date(e.createdAt);
}

/**
 * The `payments` block of a sale (GET /sales and GET /sales/:id). LEGACY sales (before F2a, or confirmed without
 * payments) have no figures: «sin registro de pagos». A sale from an API without the block is shown the same way.
 */
export function salePayments(sale) {
  const p = sale?.payments;
  if (p === undefined || (object(p) && p.mode === "LEGACY")) {
    const credit = object(p) && money(p.customerCredit) ? p.customerCredit : null;
    return { mode: "LEGACY", customerCredit: credit };
  }
  const ok = object(p) && p.mode === "TRACKED" && typeof p.creditSalesEnabled === "boolean"
    && ["total", "returnedValue", "effectiveTotal", "paid", "balance", "refundDue"].every(key => money(p[key]))
    && (p.stage === null || STAGES.includes(p.stage))
    && (p.entries === undefined || (Array.isArray(p.entries) && p.entries.every(validEntry)))
    && (p.customerCredit === undefined || p.customerCredit === null || money(p.customerCredit));
  if (!ok) throw new Error("Los pagos de la venta no son válidos. Recarga antes de continuar.");
  return { mode: "TRACKED", total: p.total, returnedValue: p.returnedValue, effectiveTotal: p.effectiveTotal, paid: p.paid, balance: p.balance, refundDue: p.refundDue,
    stage: p.stage, entries: p.entries ?? [], customerCredit: p.customerCredit ?? null };
}

/** Pagado / saldo of a list row; null for LEGACY rows (they show «sin registro de pagos»). */
export function rowMoney(sale) {
  const p = salePayments(sale);
  return p.mode === "LEGACY" ? null : { paid: p.paid, balance: p.balance, refundDue: p.refundDue, stage: p.stage };
}

/** Historial filters, applied to the sales already read (status is the display status: «Devuelta parcialmente» included). */
export function filterSales(sales, status) {
  return status === "all" ? sales : sales.filter(sale => displayStatus(sale) === status);
}
/** API status of GET /customers/:id/sales for a display filter (a partial return is a DELIVERED sale with returns). */
export function apiStatusOf(filter) { return filter === "PARTIALLY_RETURNED" ? "DELIVERED" : filter; }

/**
 * What the detail offers for this sale (only operations of the F2a-2b API; the server checks them again):
 * - CONFIRMED with a balance: «Cobrar y entregar» (deliver with the payments) and «Registrar pago» (advance);
 * - CONFIRMED paid, or a LEGACY CONFIRMED sale: «Entregar»; any CONFIRMED: «Cancelar venta»;
 * - DELIVERED with units still out: «Registrar devolución»;
 * - money «por devolver» on a sale without customer: «Devolver dinero»; customer credit: «Devolver saldo a favor»;
 * - «Anular» on each payment, credit use or refund that is still standing (TRACKED, not a draft).
 */
export function detailActions(sale, payments = salePayments(sale)) {
  const tracked = payments.mode === "TRACKED", status = sale.status;
  const balance = tracked ? BigInt(payments.balance) : 0n, refundDue = tracked ? BigInt(payments.refundDue) : 0n;
  const credit = payments.customerCredit === null ? 0n : BigInt(payments.customerCredit);
  return {
    continueDraft: status === "DRAFT",
    chargeAndDeliver: status === "CONFIRMED" && tracked && balance > 0n,
    registerPayment: status === "CONFIRMED" && tracked && balance > 0n,
    deliver: status === "CONFIRMED" && (!tracked || balance === 0n),
    cancel: status === "CONFIRMED",
    registerReturn: status === "DELIVERED" && hasPendingUnits(sale),
    refundMoney: tracked && !sale.customerId && refundDue > 0n,
    refundCredit: Boolean(sale.customerId) && credit > 0n,
    voidable: tracked && status !== "DRAFT" ? payments.entries.filter(e => ["PAYMENT", "CREDIT_USE", "SALE_REFUND"].includes(e.kind) && !e.voided).map(e => e.id) : [],
  };
}

/** Rows of the payments book: every movement but the reversals, each with its sign, label and, if voided, the reason. */
export function ledgerRows(entries) {
  const reversals = new Map(entries.filter(e => e.kind === "REVERSAL" && e.reversesEntryId).map(e => [e.reversesEntryId, e]));
  return entries.filter(e => e.kind !== "REVERSAL").map(e => {
    const reversal = reversals.get(e.id);
    const method = e.method === "OTHER" && e.methodNote ? `Otro: ${e.methodNote}` : e.method ? REFUND_METHOD_LABELS[e.method] : null;
    const label = e.kind === "PAYMENT" ? method ?? "Pago" : e.kind === "CREDIT_USE" ? "Saldo a favor" : e.kind === "EXCESS_TO_CREDIT" ? "Pasó a saldo a favor del cliente"
      : e.kind === "SALE_REFUND" ? `Dinero devuelto${method ? ` · ${method}` : ""}` : "Abono";
    return { id: e.id, kind: e.kind, label, amount: e.amount, sign: e.kind === "EXCESS_TO_CREDIT" || e.kind === "SALE_REFUND" ? -1 : 1, createdAt: e.createdAt,
      change: e.kind === "PAYMENT" && e.change !== null && BigInt(e.change) > 0n ? e.change : null, reference: e.reference ?? null,
      voided: e.voided, voidReason: reversal?.reason ?? null, voidedAt: reversal?.createdAt ?? null, reason: e.kind === "SALE_REFUND" ? e.reason ?? null : null };
  });
}
/** Change handed back on the cash payments still standing (informative: never part of any total). */
export function changeGiven(entries) {
  return entries.filter(e => e.kind === "PAYMENT" && !e.voided && e.change !== null).reduce((sum, e) => sum + BigInt(e.change), 0n);
}

/** Reason of a money correction (refund, void, cancellation, return): 3 to 300 characters. */
export function reasonError(value) {
  const length = String(value ?? "").trim().length;
  return length >= 3 && length <= 300 ? null : "Escribe un motivo de 3 a 300 caracteres.";
}
/** Method of a refund («Devolver ahora», «Devolver dinero»): OTHER needs a note of 3 to 80 characters. */
export function refundMethod(method, note) {
  if (!METHODS.includes(method)) return { error: "Elige cómo devolviste el dinero." };
  if (method !== "OTHER") return { value: { method } };
  const trimmed = String(note ?? "").trim();
  return trimmed.length >= 3 && trimmed.length <= 80 ? { value: { method, methodNote: trimmed } } : { error: "Con «Otro», escribe cómo devolviste el dinero (3 a 80 caracteres)." };
}

/** What a cancellation does with the money already received (contract section 4), from the server's figures. */
export function cancelOutcome(sale, payments = salePayments(sale)) {
  if (payments.mode !== "TRACKED" || BigInt(payments.paid) <= 0n) return { kind: "none" };
  return sale.customerId ? { kind: "credit", amount: payments.paid } : { kind: "refund", amount: payments.paid };
}

/** Id of a sale from a list row or the URL (?venta=): only a UUID opens the detail. */
export function saleIdFrom(value) { return uuidText(value) ? value.toLowerCase() : null; }
