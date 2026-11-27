// Account closure notice (F2a-3b, contract section 7.4, correction C). Amounts are the server's, as decimal strings.
const money = v => typeof v === "string" && /^(0|[1-9][0-9]*)$/.test(v);
const count = v => Number.isSafeInteger(v) && v >= 0;
const object = v => v !== null && typeof v === "object" && !Array.isArray(v);

/** GET /auth/close/preview → preview, or the `preview` of a 409 ACCOUNT_CLOSURE_REQUIRES_CONFIRMATION. */
export function parseClosurePreview(value) {
  const p = object(value) && object(value.preview) ? value.preview : value;
  const ok = object(p) && count(p.unresolvedOrders) && count(p.undeliveredSales) && money(p.pendingOrderBalance) && money(p.balanceDue)
    && object(p.customerCredit) && money(p.customerCredit.total) && count(p.customerCredit.customers)
    && object(p.refundDue) && money(p.refundDue.total) && count(p.refundDue.sales) && typeof p.requiresConfirmation === "boolean";
  if (!ok) throw new Error("No se pudo leer el resumen del cierre.");
  return { unresolvedOrders: p.unresolvedOrders, undeliveredSales: p.undeliveredSales, pendingOrderBalance: p.pendingOrderBalance, balanceDue: p.balanceDue,
    customerCredit: { total: p.customerCredit.total, customers: p.customerCredit.customers }, refundDue: { total: p.refundDue.total, sales: p.refundDue.sales },
    requiresConfirmation: p.requiresConfirmation };
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
/** Lines of the notice, only for what is open (key, label, value). No export is offered until F5. */
export function closureNoticeRows(preview, format) {
  const rows = [];
  if (preview.balanceDue !== "0") rows.push({ key: "balanceDue", label: "Lo que te deben (ventas entregadas)", value: format(preview.balanceDue) });
  if (preview.pendingOrderBalance !== "0") rows.push({ key: "pendingOrderBalance", label: "Por cobrar de ventas confirmadas", value: format(preview.pendingOrderBalance) });
  if (preview.customerCredit.total !== "0") rows.push({ key: "customerCredit", label: `Saldos a favor de ${plural(preview.customerCredit.customers, "cliente", "clientes")}`, value: format(preview.customerCredit.total) });
  if (preview.refundDue.total !== "0") rows.push({ key: "refundDue", label: `Dinero por devolver (${plural(preview.refundDue.sales, "venta", "ventas")} sin cliente)`, value: format(preview.refundDue.total) });
  if (preview.undeliveredSales > 0) rows.push({ key: "undeliveredSales", label: "Ventas confirmadas sin entregar", value: String(preview.undeliveredSales) });
  return rows;
}
