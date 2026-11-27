import assert from "node:assert/strict";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { privatePanelFixture } from "./private-panel-browser-fixture.mjs";

// Vender › Historial and the sale detail panel (F2a-3b): real Chromium, real Next proxy, simulated API with the rules
// of docs/sales-payments-cartera-contract.md sections 4–5 and 17 (F2a-2b): payments book, advances, deliver with the
// rest, excess to customer credit or «por devolver», refunds, voids, idempotency receipts and the closure preview.
// Optional screenshots: DETAIL_SCREENSHOTS=<folder outside the repo>. Run from C:\ (uppercase) like the other browser tests.
const checks = [], mutations = [], unknown = [];
let clock = Date.parse("2026-11-27T14:00:00.000Z");
const stamp = () => new Date(clock += 60000).toISOString();
class Fail extends Error { constructor(status, code) { super(code); this.status = status; this.code = code; } }
const customers = [{ id: randomUUID(), fullName: "Ana Gómez", phone: "3001234567", archivedAt: null, credit: [] }];
const ana = customers[0];
const catalog = { id: randomUUID(), publicId: randomUUID(), name: "Tienda de prueba", slug: "prueba", template: "TECH", active: true, archivedAt: null, logoUrl: null };
const order = (n, name) => ({ id: randomUUID(), customerName: name, customerPhone: "3000000000", customerEmail: null, customerAddress: null, notes: null, customerConsentAt: null, customerConsentVersion: null,
  anonymizedAt: null, quotationSellerSnapshot: null, status: "PENDING", total: 4000 * n, createdAt: "2026-11-27T12:00:00.000Z", quotationNumber: null, items: [{ productName: "Funda de pedido", quantity: n, unitPrice: 4000, subtotal: 4000 * n }], convertedSale: null });
const orders = [order(1, "Comprador escritorio"), order(2, "Comprador móvil")];
const sales = new Map(), receipts = new Map(), creditOps = new Map();
let dropNext = null, forceExcess = false, closurePreviewOverride = null, closed = false;

function line(name, sku, price, quantity) { return { id: randomUUID(), inventoryItemId: randomUUID(), quantity, itemName: name, sku, unitPrice: String(price), unitDiscount: "0", lineTotal: String(price * quantity), unitCost: null }; }
function addSale({ status, customer = null, mode = "TRACKED", lines, payments = [] }) {
  const s = { id: randomUUID(), status, version: 2, paymentMode: mode, customerId: customer?.id ?? null, lines, returns: [], entries: [], createdAt: stamp(),
    confirmedAt: status === "DRAFT" ? null : stamp(), deliveredAt: status === "DELIVERED" ? stamp() : null, cancelledAt: null, returnedAt: null };
  s.total = lines.reduce((t, l) => t + BigInt(l.lineTotal), 0n);
  for (const p of payments) entry(s, { kind: "PAYMENT", amount: BigInt(p.amount), method: p.method, cashReceived: p.cashReceived ? BigInt(p.cashReceived) : null });
  sales.set(s.id, s); return s;
}
function entry(s, data) { const e = { id: randomUUID(), method: null, methodNote: null, reference: null, cashReceived: null, reversesEntryId: null, reason: null, operationId: randomUUID(), createdAt: stamp(), ...data }; s.entries.push(e); return e; }
const creditOf = c => c.credit.reduce((t, e) => t + e.sign * e.amount, 0n);
function figures(s) {
  const returned = s.returns.flatMap(r => r.lines).reduce((t, rl) => { const l = s.lines.find(x => x.id === rl.saleLineId); return t + (BigInt(l.unitPrice) - BigInt(l.unitDiscount)) * BigInt(rl.receivedQuantity); }, 0n);
  const effectiveTotal = ["CANCELLED", "RETURNED"].includes(s.status) ? 0n : s.total - returned;
  const byId = new Map(s.entries.map(e => [e.id, e]));
  const sign = e => e.kind === "REVERSAL" ? -sign(byId.get(e.reversesEntryId)) : ["PAYMENT", "CREDIT_USE"].includes(e.kind) ? 1n : -1n;
  const paid = s.entries.reduce((t, e) => t + sign(e) * e.amount, 0n), raw = effectiveTotal - paid;
  const balance = raw > 0n ? raw : 0n, refundDue = raw < 0n && !s.customerId ? -raw : 0n;
  const stage = s.status === "CONFIRMED" ? (balance > 0n ? "PENDING_ORDER" : "PAID") : s.status === "DELIVERED" ? (refundDue > 0n ? "REFUND_DUE" : balance > 0n ? "BALANCE_DUE" : "PAID")
    : s.status === "DRAFT" ? null : refundDue > 0n ? "REFUND_DUE" : "SETTLED";
  return { total: s.total, returnedValue: returned, effectiveTotal, paid, balance, refundDue, stage };
}
const str = v => typeof v === "bigint" ? v.toString() : v;
function view(s, detail) {
  const c = s.customerId ? customers.find(x => x.id === s.customerId) : null;
  const base = { id: s.id, status: s.status, version: s.version, currency: "COP", subtotal: s.total.toString(), discountTotal: "0", total: s.total.toString(), createdAt: s.createdAt, confirmedAt: s.confirmedAt,
    deliveredAt: s.deliveredAt, cancelledAt: s.cancelledAt, returnedAt: s.returnedAt, paymentMode: s.paymentMode, customerId: s.customerId, customerNameSnapshot: c?.fullName ?? null, customerPhoneSnapshot: c?.phone ?? null,
    customerEmailSnapshot: null, customerName: null, customerPhone: null, sourceOrderId: null, customer: c ? { id: c.id, fullName: c.fullName, phone: c.phone, email: null, archivedAt: null } : null,
    lines: s.lines.map(l => ({ ...l })), returns: s.returns.map(r => ({ ...r, lines: r.lines.map(x => ({ ...x })) })) };
  if (s.paymentMode !== "TRACKED") return { ...base, payments: { mode: "LEGACY", ...(detail ? { customerCredit: c ? creditOf(c).toString() : null } : {}) } };
  const f = figures(s), reversed = new Set(s.entries.map(e => e.reversesEntryId).filter(Boolean));
  return { ...base, payments: { mode: "TRACKED", creditSalesEnabled: false, ...Object.fromEntries(Object.entries(f).map(([k, v]) => [k, str(v)])),
    ...(detail ? { entries: s.entries.map(e => ({ id: e.id, kind: e.kind, amount: e.amount.toString(), method: e.method, methodNote: e.methodNote, reference: e.reference, cashReceived: str(e.cashReceived),
      change: e.cashReceived === null ? null : (e.cashReceived - e.amount).toString(), reversesEntryId: e.reversesEntryId, reason: e.reason, voided: reversed.has(e.id), operationId: e.operationId, createdAt: e.createdAt })),
      customerCredit: c ? creditOf(c).toString() : null } : {}) } };
}
/** Excess after any change: to the customer's credit balance, or (no customer) refunded now / left «por devolver». */
function settle(s, refundNow, reason) {
  const f = figures(s), excess = f.paid - f.effectiveTotal;
  if (excess <= 0n) return;
  if (s.customerId) { entry(s, { kind: "EXCESS_TO_CREDIT", amount: excess }); customers.find(c => c.id === s.customerId).credit.push({ sign: 1n, amount: excess, kind: "FROM_SALE" }); }
  else if (refundNow) entry(s, { kind: "SALE_REFUND", amount: excess, method: refundNow.method, methodNote: refundNow.methodNote ?? null, reason });
}
function payments(s, list = [], creditAmount, operationId = randomUUID()) {
  for (const p of list) {
    if (!["CASH", "NEQUI", "DAVIPLATA", "BANK_TRANSFER", "CARD", "OTHER"].includes(p.method) || !/^[1-9][0-9]*$/.test(p.amount)) throw new Fail(400, "INVALID_PAYMENT_INPUT");
    if (p.cashReceived !== undefined && (p.method !== "CASH" || BigInt(p.cashReceived) < BigInt(p.amount))) throw new Fail(400, "INVALID_PAYMENT_INPUT");
  }
  const credit = BigInt(creditAmount ?? "0"), incoming = list.reduce((t, p) => t + BigInt(p.amount), 0n) + credit;
  if (forceExcess || incoming > figures(s).balance) { forceExcess = false; throw new Fail(409, "PAYMENT_EXCEEDS_BALANCE"); }
  if (credit > 0n) { const c = customers.find(x => x.id === s.customerId); if (!c) throw new Fail(409, "CUSTOMER_REQUIRED_FOR_CREDIT"); if (creditOf(c) < credit) throw new Fail(409, "CREDIT_INSUFFICIENT"); c.credit.push({ sign: -1n, amount: credit, kind: "USED" }); entry(s, { kind: "CREDIT_USE", amount: credit, operationId }); }
  for (const p of list) entry(s, { kind: "PAYMENT", amount: BigInt(p.amount), method: p.method, cashReceived: p.cashReceived ? BigInt(p.cashReceived) : null, operationId });
}
const hashOf = body => JSON.stringify(Object.fromEntries(Object.entries(body).filter(([key]) => key !== "requestId")));
const reason = body => { if (typeof body.reason !== "string" || body.reason.trim().length < 3 || body.reason.trim().length > 300) throw new Fail(400, "INVALID_PAYMENT_INPUT"); };

/** One receipt per operationId: same content answers the stored reply; other content is a conflict. */
function once(body, kind, work) {
  const prior = receipts.get(body.operationId);
  if (prior) { if (prior.hash !== hashOf(body) || prior.kind !== kind) throw new Fail(409, "IDEMPOTENCY_CONFLICT"); return { ...prior.reply, replayed: true }; }
  const reply = work(); receipts.set(body.operationId, { hash: hashOf(body), kind, reply }); return reply;
}
function mutate(method, p, body) {
  if (closed) throw new Fail(401, "AUTH_REQUIRED");
  let m = p.match(/^\/api\/sales\/([^/]+)\/(deliver|cancel|returns|payments|refunds)$/);
  if (method === "POST" && m) {
    const s = sales.get(m[1]); if (!s) throw new Fail(404, "NOT_FOUND");
    const op = m[2], money = ["payments", "refunds"].includes(op);
    return once(body, op, () => {
      if (op === "deliver") {
        if (s.status !== "CONFIRMED" || s.version !== body.expectedVersion) throw new Fail(409, "INVALID_TRANSITION");
        if ((body.payments || body.customerCreditAmount) && s.paymentMode !== "TRACKED") throw new Fail(409, "LEGACY_SALE_PAYMENTS_UNSUPPORTED");
        if (s.paymentMode === "TRACKED") { if (body.payments || body.customerCreditAmount) payments(s, body.payments, body.customerCreditAmount, body.operationId); if (figures(s).balance > 0n) { s.entries = s.entries.filter(e => e.operationId !== body.operationId); throw new Fail(409, "SALE_BALANCE_DUE"); } }
        Object.assign(s, { status: "DELIVERED", deliveredAt: stamp(), version: s.version + 1 });
      } else if (op === "cancel") {
        if (s.status !== "CONFIRMED" || s.version !== body.expectedVersion) throw new Fail(409, "INVALID_TRANSITION");
        if (typeof body.reason !== "string" || body.reason.trim().length < 3) throw new Fail(400, "INVALID_SALE_INPUT");
        if (body.refundNow && s.customerId) throw new Fail(400, "INVALID_PAYMENT_INPUT");
        Object.assign(s, { status: "CANCELLED", cancelledAt: stamp(), version: s.version + 1 });
        if (s.paymentMode === "TRACKED") settle(s, body.refundNow, body.reason);
      } else if (op === "returns") {
        if (s.status !== "DELIVERED" || s.version !== body.expectedVersion) throw new Fail(409, "INVALID_TRANSITION");
        s.returns.push({ id: randomUUID(), reason: body.reason, createdAt: stamp(), lines: body.lines.map(l => ({ id: randomUUID(), ...l })) });
        const back = new Map(); for (const r of s.returns) for (const l of r.lines) back.set(l.saleLineId, (back.get(l.saleLineId) ?? 0) + l.receivedQuantity);
        s.version++; if (s.lines.every(l => back.get(l.id) === l.quantity)) Object.assign(s, { status: "RETURNED", returnedAt: stamp() });
        if (s.paymentMode === "TRACKED") settle(s, body.refundNow, body.reason);
      } else if (op === "payments") {
        if (s.paymentMode !== "TRACKED") throw new Fail(409, "LEGACY_SALE_PAYMENTS_UNSUPPORTED");
        if (s.version !== body.expectedVersion) throw new Fail(409, "VERSION_CONFLICT");
        // F2a-3c: a DELIVERED sale only takes payments while it has a balance left by an older plain void.
        if (s.status !== "CONFIRMED" && !(s.status === "DELIVERED" && figures(s).balance > 0n)) throw new Fail(409, "INVALID_PAYMENT_STATE");
        if (!body.payments?.length && !body.customerCreditAmount) throw new Fail(400, "INVALID_PAYMENT_INPUT");
        payments(s, body.payments, body.customerCreditAmount, body.operationId); s.version++;
      } else {
        reason(body);
        if (s.version !== body.expectedVersion) throw new Fail(409, "VERSION_CONFLICT");
        if (s.customerId) throw new Fail(409, "REFUND_REQUIRES_NO_CUSTOMER");
        if (BigInt(body.amount) > figures(s).refundDue) throw new Fail(409, "REFUND_EXCEEDS_DUE");
        entry(s, { kind: "SALE_REFUND", amount: BigInt(body.amount), method: body.method, methodNote: body.methodNote ?? null, reason: body.reason }); s.version++;
      }
      return money ? { result: { result: view(s, true), idempotent: false } } : { result: view(s, true) };
    });
  }
  m = p.match(/^\/api\/sales\/([^/]+)\/payments\/([^/]+)\/void$/);
  if (method === "POST" && m) {
    const s = sales.get(m[1]); if (!s) throw new Fail(404, "NOT_FOUND");
    return once(body, "void", () => {
      reason(body);
      if (s.version !== body.expectedVersion) throw new Fail(409, "VERSION_CONFLICT");
      const target = s.entries.find(e => e.id === m[2]); if (!target) throw new Fail(404, "PAYMENT_NOT_FOUND");
      if (s.entries.some(e => e.reversesEntryId === target.id)) throw new Fail(409, "PAYMENT_ALREADY_VOIDED");
      if (s.status === "DELIVERED" && ["PAYMENT", "CREDIT_USE"].includes(target.kind)) throw new Fail(409, "VOID_REQUIRES_REPLACEMENT");
      entry(s, { kind: "REVERSAL", amount: target.amount, reversesEntryId: target.id, reason: body.reason });
      if (figures(s).paid < 0n) {
        const moved = s.entries.filter(e => e.kind === "EXCESS_TO_CREDIT" && !s.entries.some(r => r.reversesEntryId === e.id)).at(-1);
        if (!moved) throw new Fail(409, "PAYMENT_ALREADY_REFUNDED");
        entry(s, { kind: "REVERSAL", amount: moved.amount, reversesEntryId: moved.id, reason: body.reason });
        customers.find(c => c.id === s.customerId).credit.push({ sign: -1n, amount: moved.amount, kind: "REVERSAL" });
      }
      s.version++;
      return { result: { result: view(s, true), idempotent: false } };
    });
  }
  m = p.match(/^\/api\/sales\/([^/]+)\/payments\/([^/]+)\/replace$/);
  if (method === "POST" && m) {
    const s = sales.get(m[1]); if (!s) throw new Fail(404, "NOT_FOUND");
    return once(body, "replace", () => {
      reason(body);
      if (s.version !== body.expectedVersion) throw new Fail(409, "VERSION_CONFLICT");
      const target = s.entries.find(e => e.id === m[2]); if (!target) throw new Fail(404, "PAYMENT_NOT_FOUND");
      if (!["PAYMENT", "CREDIT_USE"].includes(target.kind)) throw new Fail(409, "PAYMENT_NOT_VOIDABLE");
      if (s.entries.some(e => e.reversesEntryId === target.id)) throw new Fail(409, "PAYMENT_ALREADY_VOIDED");
      const pay = body.payment ?? {};
      if (!["CASH", "NEQUI", "DAVIPLATA", "BANK_TRANSFER", "CARD", "OTHER"].includes(pay.method) || (pay.cashReceived !== undefined && (pay.method !== "CASH" || BigInt(pay.cashReceived) < BigInt(pay.amount)))) throw new Fail(400, "INVALID_PAYMENT_INPUT");
      if (BigInt(pay.amount) !== target.amount) throw new Fail(409, "REPLACEMENT_AMOUNT_MISMATCH");
      entry(s, { kind: "REVERSAL", amount: target.amount, reversesEntryId: target.id, reason: body.reason, operationId: body.operationId });
      entry(s, { kind: "PAYMENT", amount: BigInt(pay.amount), method: pay.method, cashReceived: pay.cashReceived ? BigInt(pay.cashReceived) : null, operationId: body.operationId });
      s.version++;
      return { result: { result: view(s, true), idempotent: false } };
    });
  }
  m = p.match(/^\/api\/orders\/([^/]+)\/convert-to-sale$/);
  if (method === "POST" && m) {
    const o = orders.find(x => x.id === m[1]); if (!o) throw new Fail(404, "ORDER_NOT_FOUND");
    if (body.mode === "DELIVERED") return { status: 409, body: { success: false, error: "ORDER_CONVERSION_DELIVERY_REMOVED", message: "ORDER_CONVERSION_DELIVERY_REMOVED" } };
    if (o.convertedSale) throw new Fail(409, "ORDER_ALREADY_CONVERTED");
    const s = addSale({ status: body.mode === "CONFIRMED" ? "CONFIRMED" : "DRAFT", lines: o.items.map(i => line(i.productName, "PED-1", i.unitPrice, i.quantity)), mode: body.mode === "CONFIRMED" ? "TRACKED" : "LEGACY" });
    if (body.mode === "CONFIRMED") payments(s, body.payments ?? [], body.customerCreditAmount, body.operationId);
    o.convertedSale = view(s, false);
    return { status: 200, body: { success: true, sale: view(s, true), idempotent: false } };
  }
  m = p.match(/^\/api\/customers\/([^/]+)\/credit\/refunds$/);
  if (method === "POST" && m) {
    const c = customers.find(x => x.id === m[1]); if (!c) throw new Fail(404, "CUSTOMER_NOT_FOUND");
    return once(body, "creditRefund", () => {
      reason(body);
      if (creditOf(c) < BigInt(body.amount)) throw new Fail(409, "CREDIT_INSUFFICIENT");
      c.credit.push({ sign: -1n, amount: BigInt(body.amount), kind: "REFUND", method: body.method, reason: body.reason }); creditOps.set(body.operationId, body);
      return { result: { result: { customerId: c.id, entryId: randomUUID(), balance: creditOf(c).toString() }, idempotent: false } };
    });
  }
  if (method === "POST" && p === "/api/auth/close") {
    if (body.confirmation !== "CERRAR CUENTA" || body.password !== "fixture-password") return { status: 403, body: { success: false, message: "Verifica de nuevo tu identidad." } };
    const preview = closurePreview();
    if (preview.requiresConfirmation && body.confirmOpenBalances !== true) return { status: 409, body: { success: false, error: "ACCOUNT_CLOSURE_REQUIRES_CONFIRMATION", preview, message: "Antes de cerrar, revisa…" } };
    closed = true; return { status: 202, body: { success: true, job: { id: "job", phase: "PENDING" } } };
  }
  if (method === "POST" && p === "/api/auth/logout") return { status: 200, body: { success: true } };
  return null;
}
function closurePreview() {
  if (closurePreviewOverride) return closurePreviewOverride;
  let pendingOrderBalance = 0n, balanceDue = 0n, refundDue = 0n, refundDueSales = 0;
  for (const s of sales.values()) { if (s.paymentMode !== "TRACKED" || s.status === "DRAFT") continue; const f = figures(s);
    if (s.status === "CONFIRMED") pendingOrderBalance += f.balance; if (s.status === "DELIVERED") balanceDue += f.balance; if (f.refundDue > 0n) { refundDue += f.refundDue; refundDueSales++; } }
  const credits = customers.map(creditOf).filter(v => v > 0n), undeliveredSales = [...sales.values()].filter(s => s.status === "CONFIRMED").length;
  const creditTotal = credits.reduce((t, v) => t + v, 0n);
  return { unresolvedOrders: 0, undeliveredSales, pendingOrderBalance: str(pendingOrderBalance), balanceDue: str(balanceDue), customerCredit: { total: str(creditTotal), customers: credits.length },
    refundDue: { total: str(refundDue), sales: refundDueSales }, requiresConfirmation: undeliveredSales > 0 || pendingOrderBalance > 0n || balanceDue > 0n || refundDue > 0n || creditTotal > 0n };
}
function read(url) {
  const p = url.pathname, q = url.searchParams;
  if (p === "/api/me") return { user: { emailVerifiedAt: "2026-11-01T00:00:00Z", hasLocalPassword: true } };
  if (p === "/api/sales") return { result: [...sales.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(s => view(s, false)) };
  let m = p.match(/^\/api\/sales\/([^/]+)$/);
  if (m) { const s = sales.get(m[1]); if (!s) throw new Fail(404, "NOT_FOUND"); return { result: view(s, true) }; }
  if (p === "/api/customers") { const term = (q.get("q") ?? "").toLowerCase(); return { success: true, customers: customers.filter(c => !term || c.fullName.toLowerCase().includes(term)).map(c => ({ id: c.id, fullName: c.fullName, phone: c.phone, archivedAt: c.archivedAt })), hasMore: false, page: Number(q.get("page") ?? "1"), pageSize: 25 }; }
  m = p.match(/^\/api\/customers\/([^/]+)\/sales$/);
  if (m) { const c = customers.find(x => x.id === m[1]); const status = q.get("status"); return { success: true, customer: { id: c.id, fullName: c.fullName, archivedAt: null },
    sales: [...sales.values()].filter(s => s.customerId === c.id && (status === "all" || s.status === status)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(s => ({ id: s.id, status: s.status, version: s.version, currency: "COP", total: s.total.toString(), createdAt: s.createdAt, sourceOrderId: null, customerNameSnapshot: c.fullName, customerName: null })), nextCursor: null }; }
  if (p === "/api/auth/close/preview") return { success: true, preview: closurePreview() };
  // Catalog workspace (Pedidos → «Convertir a venta», F2a-3c).
  if (p === "/api/catalogs") return { catalogs: [catalog] };
  if (p === `/api/catalogs/${catalog.id}`) return { catalog };
  if (p === `/api/categories/catalog/${catalog.id}`) return { categories: [] };
  if (p.endsWith("/featured")) return { products: [], selectedCount: 0, validCount: 0, visible: false, warning: null };
  if (p.endsWith("/list")) return { products: [], page: 1, pageSize: 24, totalProducts: 0, totalFiltered: 0, totalPages: 1, needsCompletionCount: 0 };
  if (p.endsWith("/suggestions")) return { products: [] };
  if (p === `/api/orders/catalog/${catalog.id}`) return { orders, nextCursor: null };
  return null;
}
async function api(req, res) {
  const url = new URL(req.url, "https://127.0.0.1:4339");
  const reply = (body, status = 200) => { res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "private, no-store" }); res.end(JSON.stringify(body)); };
  let raw = ""; for await (const chunk of req) raw += chunk;
  try {
    if (req.method === "GET") { const result = read(url); if (!result) { unknown.push(`GET ${url.pathname}`); return reply({}, 404); } return reply(result); }
    const body = raw ? JSON.parse(raw) : {};
    mutations.push({ method: req.method, path: url.pathname, body });
    const result = mutate(req.method, url.pathname, body);
    if (!result) { unknown.push(`${req.method} ${url.pathname}`); return reply({}, 404); }
    if (dropNext && url.pathname.endsWith(dropNext)) { dropNext = null; req.socket.destroy(); return; } // committed, reply lost
    if (result.status) return reply(result.body, result.status);
    const out = { ...result }; delete out.replayed; return reply(out);
  } catch (error) {
    if (error instanceof Fail) return reply({ success: false, error: error.code, message: error.code }, error.status);
    throw error;
  }
}

// Seed: an advance to charge, an advance to retry, one to over-pay, cancellations with and without customer, LEGACY and a draft.
const cargador = () => [line("Cargador 20W", "CARG-20W", 250000, 2)];
const advance = addSale({ status: "CONFIRMED", lines: cargador(), payments: [{ method: "NEQUI", amount: "200000" }] });
const retry = addSale({ status: "CONFIRMED", lines: [line("Audífonos BT", "AUD-BT", 89000, 1)], payments: [{ method: "CASH", amount: "40000" }] });
const overpay = addSale({ status: "CONFIRMED", lines: [line("Forro iPhone 13", "FOR-IP13", 150000, 2)], payments: [] });
const withCustomer = addSale({ status: "CONFIRMED", customer: ana, lines: cargador(), payments: [{ method: "BANK_TRANSFER", amount: "200000" }] });
const refundNow = addSale({ status: "CONFIRMED", lines: [line("Vidrio templado", "VID-TEMP", 15000, 4)], payments: [{ method: "CASH", amount: "60000" }] });
const refundLater = addSale({ status: "CONFIRMED", lines: [line("Cable USB-C", "CAB-USBC", 18000, 2)], payments: [{ method: "DAVIPLATA", amount: "36000" }] });
const delivered = addSale({ status: "DELIVERED", lines: [line("Parlante", "PAR-01", 60000, 1)], payments: [{ method: "CASH", amount: "60000", cashReceived: "100000" }] });
const legacy = addSale({ status: "DELIVERED", mode: "LEGACY", lines: [line("Soporte", "SOP-01", 30000, 1)] });
const draft = addSale({ status: "DRAFT", mode: "LEGACY", lines: [line("Memoria 64 GB", "MEM-64", 40000, 1)] });

try {
  await privatePanelFixture(api, async ({ command, evaluate, poll, fill }) => {
    const text = () => evaluate("document.body.innerText");
    const norm = value => value.replace(/\s+/g, " ");
    const waitFor = async (expression, label) => { try { await poll(() => evaluate(`Boolean(${expression})`)); } catch { throw new Error(`No se cumplió: ${label}\n--- pantalla ---\n${norm(await text()).slice(-1800)}`); } };
    const waitText = value => waitFor(`document.body.innerText.replace(/\\s+/g," ").includes(${JSON.stringify(value)})`, value);
    const panel = `(document.querySelector('[data-detail-panel]')??document.querySelector('[role="dialog"]'))`;
    const inPanel = selector => `${panel}?.querySelector(${JSON.stringify(selector)})`;
    const panelText = () => evaluate(`(${panel}?.innerText ?? '').replace(/\\s+/g," ")`);
    const button = label => `[...${panel}.querySelectorAll('button,a')].find(b=>(b.getAttribute('aria-label')??b.textContent).replace(/\\s+/g," ").trim()===${JSON.stringify(label)}&&b.getClientRects().length)`;
    const startsWith = label => `[...${panel}.querySelectorAll('button')].find(b=>b.textContent.replace(/\\s+/g," ").trim().startsWith(${JSON.stringify(label)})&&b.getClientRects().length)`;
    const click = async (expression, label) => { await waitFor(`(()=>{const b=${expression};return b&&!b.disabled})()`, `botón ${label}`); await evaluate(`${expression}.click()`); };
    const press = label => click(button(label), label);
    const pressStart = label => click(startsWith(label), label);
    const viewport = async width => { await command("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 }); await new Promise(r => setTimeout(r, 350)); };
    const shot = async name => { const folder = process.env.DETAIL_SCREENSHOTS; if (!folder) return; const { data } = await command("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(path.join(folder, `${name}.png`), Buffer.from(data, "base64")); };
    const row = id => `document.querySelector('[data-sale-row="${id}"]')`;
    const openSale = async s => { await click(row(s.id), `fila ${s.id}`); await waitFor(`${inPanel(`[data-sale-detail="${s.id}"]`)}`, `detalle ${s.id}`); };
    const money = key => evaluate(`${inPanel(`[data-money-row="${key}"] dd`)}?.textContent.replace(/\\s+/g," ")`);
    const typeIn = async (selector, value) => fill(`${selector}`, value);
    const writes = path => mutations.filter(m => m.path.endsWith(path));
    const historyUrl = "http://localhost:4338/dashboard/ventas/historial";

    // Historial: list with paid, balance and status; LEGACY rows without figures; no old screen.
    await viewport(1440);
    await command("Page.navigate", { url: historyUrl });
    await waitFor(`${row(advance.id)}`, "lista");
    const page = norm(await text());
    for (const part of ["Historial", "Nueva venta", "Pedidos", "Las 9 ventas más recientes", "Pagado $ 200.000", "Saldo $ 300.000", "sin registro de pagos"]) assert.ok(page.includes(part), part);
    for (const absent of ["Crear borrador", "← Catálogos", "Los totales no indican pagos recibidos", "Ventas vinculadas a un cliente"]) assert.ok(!page.includes(absent), `old screen: ${absent}`);
    assert.equal(await evaluate(`${row(legacy.id)}.querySelector('[data-row-legacy]')?.textContent`), "sin registro de pagos");
    assert.equal(await evaluate(`Boolean(${row(legacy.id)}.querySelector('[data-row-money]'))`), false, "LEGACY: no paid nor balance");
    assert.deepEqual(await evaluate(`[...document.querySelectorAll('nav[aria-label="Vender"] a')].map(a=>[a.textContent.trim(),a.getAttribute('aria-current')])`), [["Nueva venta", null], ["Pedidos", null], ["Historial", "page"]]);
    assert.deepEqual(mutations, [], "opening writes nothing");
    checks.push("Historial: new screen with the Vender tabs; each row with customer, date, items, total, paid, balance and status; LEGACY rows «sin registro de pagos» without figures; the old create form, «← Catálogos» and the payments notice are gone");

    // Status filter including «Devuelta parcialmente» (after a partial return below), and «Confirmada».
    await evaluate(`(()=>{const s=document.querySelector('#history-status');s.value='CONFIRMED';s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
    await waitFor(`document.querySelectorAll('[data-sale-row]').length===6`, "6 confirmadas");
    await evaluate(`(()=>{const s=document.querySelector('#history-status');s.value='all';s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
    await waitFor(`document.querySelectorAll('[data-sale-row]').length===9`, "todas");

    // Advance → charge the rest and deliver in one operation (cash with change).
    await openSale(advance);
    assert.equal(await evaluate(`new URL(location.href).searchParams.get('venta')`), advance.id, "direct link in the URL");
    assert.equal(await evaluate(`${row(advance.id)}.getAttribute('aria-current')`), "true");
    assert.deepEqual([await money("paid"), await money("balance")], ["$ 200.000", "$ 300.000"]);
    let detail = await panelText();
    for (const part of ["Venta " + advance.id.slice(0, 8), "Confirmada", "Por cobrar", "Cargador 20W", "2 × $ 250.000", "Nequi", "Cobrar y entregar · $ 300.000", "Registrar pago", "Cancelar venta"]) assert.ok(detail.includes(part), part);
    await pressStart("Cobrar y entregar");
    await press("Agregar pago: Efectivo");
    await waitFor(`${inPanel('[data-payment-row="CASH"] input')}?.value==="300.000"`, "efectivo con lo que falta");
    await typeIn(`[data-detail-panel] [data-payment-row="CASH"] input[id$="-received"]`, "350000");
    await waitFor(`${inPanel("[data-cash-change]")}?.textContent.replace(/\\s+/g," ")==="$ 50.000"`, "cambio");
    await click(inPanel("[data-detail-charge]"), "Cobrar y entregar");
    await waitFor(`${inPanel('[data-sale-status="DELIVERED"]')}`, "entregada");
    await waitText("Venta cobrada y entregada. Cambio $ 50.000.");
    assert.deepEqual([await money("paid"), await money("balance"), await money("change")], ["$ 500.000", "$ 0", "$ 50.000"]);
    const delivers = writes(`/sales/${advance.id}/deliver`);
    assert.equal(delivers.length, 1); assert.deepEqual(delivers[0].body.payments, [{ method: "CASH", amount: "300000", cashReceived: "350000" }]);
    assert.ok(delivers[0].body.operationId && delivers[0].body.requestId && delivers[0].body.expectedVersion === 2);
    await waitFor(`${row(advance.id)}?.querySelector('[data-sale-status="DELIVERED"]')`, "la lista se actualiza");
    await shot("1440-historial-detalle");
    checks.push("Advance → «Cobrar y entregar · $ 300.000»: cash proposes the rest, Recibido 350.000 → Cambio 50.000; one deliver call with the payment; Entregada, Pagado 500.000, Saldo 0, change shown; the list row updates");

    // Lost reply on «Cobrar y entregar»: «Reintentar» resends the same operation; one delivery, payments once.
    await openSale(retry);
    await pressStart("Cobrar y entregar");
    await press("Agregar pago: Tarjeta");
    await waitFor(`${inPanel('[data-payment-row="CARD"] input')}?.value==="49.000"`, "tarjeta con el resto");
    dropNext = "/deliver";
    await click(inPanel("[data-detail-charge]"), "Cobrar y entregar");
    await waitText("Reintenta: se enviará la misma operación y no se duplicará.");
    assert.equal(sales.get(retry.id).status, "DELIVERED", "committed before the reply was lost");
    await press("Reintentar");
    await waitFor(`${inPanel('[data-sale-status="DELIVERED"]')}`, "entregada tras reintentar");
    const [lost, again] = writes(`/sales/${retry.id}/deliver`);
    assert.equal(lost.body.operationId, again.body.operationId, "same operationId"); assert.notEqual(lost.body.requestId, again.body.requestId, "new requestId");
    assert.equal(sales.get(retry.id).entries.filter(e => e.kind === "PAYMENT").length, 2, "advance + one card payment, not two");
    assert.equal([...sales.values()].length, 9, "no new sale");
    assert.equal(await money("paid"), "$ 89.000");
    checks.push("Lost reply after the commit: retry message, «Reintentar» resends the same operationId with a new requestId; the receipt answers: one delivery, the card payment recorded once, no new sale");

    // Paying more than the balance: blocked on screen with «Pagar el total»; a server rejection is explained.
    await openSale(overpay);
    await press("Registrar pago");
    await press("Agregar pago: Efectivo");
    await typeIn(`[data-detail-panel] [data-payment-row="CASH"] input:not([id$="-received"])`, "400000");
    await waitText("Los pagos superan el total por $ 100.000");
    assert.equal(await evaluate(`${inPanel("[data-detail-pay]")}.disabled`), true, "over the balance: cannot register");
    await click(inPanel("[data-pay-total]"), "Pagar el total");
    await waitFor(`${inPanel('[data-payment-row="CASH"] input')}?.value==="300.000"`, "ajustado al saldo");
    await typeIn(`[data-detail-panel] [data-payment-row="CASH"] input:not([id$="-received"])`, "100000");
    forceExcess = true; // another device paid meanwhile: the server rejects
    await click(inPanel("[data-detail-pay]"), "Registrar pago");
    await waitText("Los pagos superan lo que falta");
    assert.equal(figures(sales.get(overpay.id)).paid, 0n, "nothing recorded");
    await press("Recargar la venta");
    await click(inPanel("[data-detail-pay]"), "Registrar pago");
    await waitText("Pago registrado.");
    assert.deepEqual([await money("paid"), await money("balance")], ["$ 100.000", "$ 200.000"]);
    assert.equal(await evaluate(`Boolean(${button("Cobrar y entregar · $ 200.000")})`), true, "with a partial advance the sale can now be charged and delivered");
    checks.push("More than the balance: «Los pagos superan…» and «Registrar pago» disabled, «Pagar el total» trims to $ 300.000; a server PAYMENT_EXCEEDS_BALANCE records nothing and is explained; an advance of 100.000 leaves «Cobrar y entregar · $ 200.000»");

    // Void a payment: the reason is mandatory; the entry stays struck through with it.
    await press("Anular Efectivo de $ 100.000");
    await click(inPanel("[data-detail-void]"), "Sí, anular");
    await waitText("Escribe un motivo de 3 a 300 caracteres.");
    assert.equal(writes("/void").length, 0, "no void without a reason");
    await typeIn("#void-reason", "Registrado dos veces");
    await click(inPanel("[data-detail-void]"), "Sí, anular");
    await waitText("Movimiento anulado.");
    await waitFor(`${inPanel('[data-ledger-entry="PAYMENT"][data-voided] [data-void-reason]')}?.textContent.includes("Registrado dos veces")`, "anulado tachado con su motivo");
    assert.equal(await evaluate(`getComputedStyle(${inPanel('[data-ledger-entry="PAYMENT"][data-voided] span')}).textDecorationLine`), "line-through");
    assert.equal(await money("balance"), "$ 300.000");
    assert.equal(writes("/void")[0].body.reason, "Registrado dos veces");
    checks.push("«Anular» a payment requires a reason (no request without it); the payment stays in the book struck through with «Anulado · Motivo: …» and the balance goes back to $ 300.000");

    // Cancel with an advance and a customer → credit balance; then «Devolver saldo a favor» requires a reason.
    await openSale(withCustomer);
    await press("Cancelar venta");
    assert.ok((await panelText()).includes("Lo pagado ($ 200.000) queda como saldo a favor de Ana Gómez."));
    await click(inPanel("[data-detail-cancel]"), "Sí, cancelar");
    await waitText("Escribe un motivo de 3 a 300 caracteres.");
    assert.equal(writes(`/sales/${withCustomer.id}/cancel`).length, 0);
    await typeIn("#cancel-reason", "El cliente desistió");
    await click(inPanel("[data-detail-cancel]"), "Sí, cancelar");
    await waitFor(`${inPanel('[data-sale-status="CANCELLED"]')}`, "cancelada");
    await waitFor(`${inPanel('[data-ledger-entry="EXCESS_TO_CREDIT"]')}`, "pasó a saldo a favor");
    assert.ok((await panelText()).includes("Saldo a favor de Ana Gómez: $ 200.000"));
    assert.equal(writes(`/sales/${withCustomer.id}/cancel`)[0].body.refundNow, undefined, "with a customer there is no «Devolver ahora»");
    await press("Devolver saldo a favor");
    await waitFor(`document.querySelector('#credit-amount')?.value==="200.000"`, "importe propuesto");
    await click(inPanel("[data-detail-refund]"), "Registrar devolución");
    await waitText("Escribe un motivo de 3 a 300 caracteres.");
    assert.equal(writes("/credit/refunds").length, 0, "no refund without a reason");
    await typeIn("#credit-amount", "50000");
    await evaluate(`(()=>{const s=document.querySelector('#credit-method');s.value='NEQUI';s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
    await typeIn("#credit-reason", "Pidió una parte en efectivo");
    await click(inPanel("[data-detail-refund]"), "Registrar devolución");
    await waitText("Saldo a favor devuelto: $ 50.000.");
    assert.deepEqual(writes("/credit/refunds")[0].body, { ...writes("/credit/refunds")[0].body, amount: "50000", method: "NEQUI", reason: "Pidió una parte en efectivo" });
    await waitText("Saldo a favor de Ana Gómez: $ 150.000");
    checks.push("Cancel with an advance and a customer: reason required, the $ 200.000 become her credit balance (EXCESS_TO_CREDIT in the book); «Devolver saldo a favor» requires a reason and leaves $ 150.000");

    // Cancel without a customer: «Devolver ahora» (Nequi) or leave it «por devolver», then «Devolver dinero» with a reason.
    await openSale(refundNow);
    await press("Cancelar venta");
    await evaluate(`[...${panel}.querySelectorAll('input[name="cancel-refund"]')][0].click()`);
    await evaluate(`(()=>{const s=document.querySelector('#cancel-method');s.value='NEQUI';s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
    await typeIn("#cancel-reason", "Producto equivocado");
    await click(inPanel("[data-detail-cancel]"), "Sí, cancelar");
    await waitText("el dinero quedó devuelto");
    assert.deepEqual(writes(`/sales/${refundNow.id}/cancel`)[0].body.refundNow, { method: "NEQUI" });
    await waitFor(`${inPanel('[data-ledger-entry="SALE_REFUND"]')}?.textContent.includes("Dinero devuelto · Nequi")`, "devuelto en el acto");
    assert.equal(await money("balance"), "$ 0");
    await openSale(refundLater);
    await press("Cancelar venta");
    await typeIn("#cancel-reason", "Se arrepintió");
    await click(inPanel("[data-detail-cancel]"), "Sí, cancelar");
    await waitText("el dinero queda por devolver");
    assert.equal(await money("refund-due"), "$ 36.000");
    await waitFor(`${row(refundLater.id)}?.textContent.replace(/\\s+/g," ").includes("Por devolver $ 36.000")`, "la fila dice por devolver");
    await press("Devolver dinero");
    await waitFor(`document.querySelector('#refund-amount')?.value==="36.000"`, "importe por devolver");
    await click(inPanel("[data-detail-refund]"), "Registrar devolución");
    await waitText("Escribe un motivo de 3 a 300 caracteres.");
    assert.equal(writes(`/sales/${refundLater.id}/refunds`).length, 0, "no refund without a reason");
    await typeIn("#refund-reason", "Se le devolvió en caja");
    await click(inPanel("[data-detail-refund]"), "Registrar devolución");
    await waitText("Devolución de dinero registrada: $ 36.000.");
    assert.equal(await money("balance"), "$ 0");
    checks.push("Cancel without a customer: «Devolver ahora» sends refundNow (Nequi) and the book shows «Dinero devuelto · Nequi»; «Dejarlo por devolver» leaves «Por devolver $ 36.000» (also in the row) and «Devolver dinero» requires a reason");

    // Delivered sale: partial return with the existing flow → «Devuelta parcialmente», money «por devolver».
    await openSale(delivered);
    assert.equal(await money("change"), "$ 40.000");
    await press("Registrar devolución");
    await waitFor(`document.querySelector('#return-reason')`, "formulario de devolución");
    assert.equal(await evaluate(`Boolean(${panel}.querySelector('input[name="return-refund"]'))`), true, "without customer: refund now or later");
    await evaluate(`(()=>{const i=document.querySelector('[aria-label="Revendibles de Parlante"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'1');i.dispatchEvent(new Event('input',{bubbles:true}))})()`);
    await typeIn("#return-reason", "No funcionaba");
    await click(inPanel("[data-detail-return]"), "Registrar devolución");
    await waitText("Devolución registrada.");
    await waitFor(`${inPanel('[data-sale-status="RETURNED"]')}`, "devuelta");
    assert.equal(await money("refund-due"), "$ 60.000");
    checks.push("Delivered: «Registrar devolución» with the current return flow (resellable/damaged and reason); without a customer it offers «Devolver ahora» or later; the whole return leaves $ 60.000 «por devolver»");

    // LEGACY detail and the draft.
    await openSale(legacy);
    detail = await panelText();
    assert.ok(detail.includes("Pago no registrado (venta anterior al registro de pagos)."));
    assert.equal(await evaluate(`Boolean(${inPanel('[data-money-row="paid"]')})`), false, "LEGACY: no Pagado");
    assert.equal(await evaluate(`Boolean(${inPanel('[aria-label="Libro de pagos"]')})`), false);
    await openSale(draft);
    assert.equal(await evaluate(`${button("Continuar en Vender")}?.getAttribute('href')`), `/dashboard/ventas?borrador=${draft.id}`);
    checks.push("LEGACY detail: «Pago no registrado (venta anterior…)» without paid, balance or book; a draft offers «Continuar en Vender» (/dashboard/ventas?borrador=<id>)");

    // Partial return filter: a 2-unit sale returned by one unit.
    const partial = addSale({ status: "DELIVERED", mode: "LEGACY", lines: [line("Mouse", "MOU-01", 20000, 2)] });
    partial.returns.push({ id: randomUUID(), reason: "Una falló", createdAt: stamp(), lines: [{ id: randomUUID(), saleLineId: partial.lines[0].id, receivedQuantity: 1, resellableQuantity: 0, damagedQuantity: 1 }] });
    await command("Page.navigate", { url: historyUrl });
    await waitFor(`${row(partial.id)}`, "nueva venta en la lista");
    await evaluate(`(()=>{const s=document.querySelector('#history-status');s.value='PARTIALLY_RETURNED';s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
    await waitFor(`document.querySelectorAll('[data-sale-row]').length===1&&${row(partial.id)}`, "solo la devuelta parcialmente");
    await evaluate(`(()=>{const s=document.querySelector('#history-status');s.value='all';s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
    checks.push("Status filter «Devuelta parcialmente» shows only the delivered sale with a partial return");

    // Customer filter: Ana's linked sales (the former «Ventas vinculadas a un cliente»).
    await typeIn("#history-customer-q", "Ana");
    await click(`[...document.querySelectorAll('form button')].find(b=>b.getAttribute('aria-label')==='Buscar clientes')`, "buscar clientes");
    await click(`[...document.querySelectorAll('[aria-label="Clientes encontrados"] button')].find(b=>b.textContent.includes('Ana Gómez'))`, "Ana");
    await waitText("Ventas de Ana Gómez");
    await waitFor(`document.querySelectorAll('[data-sale-row]').length===1&&${row(withCustomer.id)}`, "solo la venta de Ana");
    assert.ok(mutations.length > 0 && !unknown.length);
    await click(`document.querySelector('[aria-label="Quitar el filtro de Ana Gómez"]')`, "quitar filtro");
    await waitFor(`document.querySelectorAll('[data-sale-row]').length===10`, "todas otra vez");
    checks.push("Customer filter: search, choose Ana → only her linked sale (GET /customers/:id/sales); removing the filter brings back the recent list");

    // Direct link ?venta= (also what Inicio links to): the detail opens on load; closing removes the parameter.
    await command("Page.navigate", { url: `${historyUrl}?venta=${overpay.id}` });
    await waitFor(`${inPanel(`[data-sale-detail="${overpay.id}"]`)}`, "detalle por enlace directo");
    await waitFor(`document.activeElement?.id==="sale-detail-title"`, "foco en el título del detalle");
    await press("Cerrar detalle");
    await waitFor(`!document.querySelector('[data-detail-panel]')&&!new URL(location.href).searchParams.has('venta')`, "cerrado sin ?venta");
    // F2a-3c: an incomplete id, or a sale that does not exist, says so instead of leaving the panel closed.
    await command("Page.navigate", { url: `${historyUrl}?venta=no-es-un-id` });
    await waitFor(`${row(advance.id)}`, "lista");
    await waitFor(`document.querySelector('[data-detail-panel] [data-sale-missing]')?.innerText.includes("No encontramos esa venta")`, "mensaje de id incompleto");
    await command("Page.navigate", { url: `${historyUrl}?venta=${randomUUID()}` });
    await waitFor(`document.querySelector('[data-detail-panel]')?.innerText.includes("No encontramos esa venta")`, "mensaje de venta inexistente");
    checks.push("Direct link /dashboard/ventas/historial?venta=<id> opens the detail with focus on its title; closing removes ?venta; an incomplete id or a sale that does not exist shows «No encontramos esa venta»");

    // No old green on the page and the panel (control element first).
    const OLD = ["#0F6B57", "#0B5646", "#E8F3EF", "#0B2E27", "#EDF3EC", "#D6DFD7", "#E2E8E0", "#A8C2AF", "#52655A", "#68756E", "#FCFDFB", "#52675B", "#DCE4DC", "#F3F5F2", "#CFD6CF", "#3F4A43",
      "#B8DCC6", "#ECF7F0", "#1F5B37", "#5A886C", "#2F7A52", "#F2FAF4", "#9FC4AE", "#C3E5D4", "#B8DEC8", "#37443D", "#87928B", "#D9E2D9", "#263B31", "#C9E0D1"]
      .map(h => `rgb(${parseInt(h.slice(1, 3), 16)},${parseInt(h.slice(3, 5), 16)},${parseInt(h.slice(5, 7), 16)})`);
    const noOldGreen = async label => {
      const found = await evaluate(`(()=>{const old=${JSON.stringify(OLD)};const out=[];for(const root of document.querySelectorAll('main,[role="dialog"]'))for(const e of [root,...root.querySelectorAll('*')]){const cs=getComputedStyle(e);for(const p of ['color','backgroundColor','borderTopColor','borderBottomColor','outlineColor']){const v=cs[p].replaceAll(' ','');if(old.includes(v))out.push((e.id||e.tagName)+' '+p+' '+v)}}return out.slice(0,8)})()`);
      assert.deepEqual(found, [], `old green on ${label}`);
    };
    await command("Page.navigate", { url: `${historyUrl}?venta=${overpay.id}` });
    await waitFor(`${inPanel(`[data-sale-detail="${overpay.id}"]`)}`, "detalle");
    await evaluate(`(()=>{const p=document.createElement('p');p.id='old-green-control';p.style.color='#0F6B57';document.querySelector('main').append(p)})()`);
    await assert.rejects(noOldGreen("the control"), /old green on the control/);
    await evaluate(`document.querySelector('#old-green-control').remove()`);
    await noOldGreen("Historial with the detail");
    checks.push("No old green on Historial and the detail panel (computed styles), with a positive control");

    // 320–1440 px with the panel and a payment form open: no horizontal overflow; under 1024 px a bottom sheet.
    const outside = `(()=>{const root=${panel};const r=root.getBoundingClientRect();return [...root.querySelectorAll('input,button,label,select,output,textarea,dd')].filter(e=>e.getClientRects().length).filter(e=>{const b=e.getBoundingClientRect();return b.right>r.right+0.5||b.left<r.left-0.5}).map(e=>(e.id||e.tagName)+':'+Math.round(e.getBoundingClientRect().right)+'>'+Math.round(r.right)).slice(0,5)})()`;
    for (const width of [320, 375, 414, 768, 1024, 1132, 1280, 1440]) {
      await viewport(width);
      const mobile = width < 1024;
      await waitFor(mobile ? `document.querySelector('[role="dialog"] [data-sale-detail]')` : `document.querySelector('[data-detail-panel] [data-sale-detail]')`, `detalle a ${width}px`);
      if (!(await evaluate(`Boolean(${inPanel("[data-detail-form]")})`))) { await pressStart("Cobrar y entregar"); await press("Agregar pago: Transferencia"); await press("Agregar pago: Efectivo"); }
      await waitFor(`${inPanel('[data-payment-row="NEQUI"]')}&&${inPanel('[data-payment-row="CASH"]')}`, "formulario de cobro abierto");
      const overflow = await evaluate(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
      const wide = overflow > 0 ? await evaluate(`[...document.querySelectorAll('main *,[role="dialog"] *')].filter(e=>e.getBoundingClientRect().right>document.documentElement.clientWidth+1).slice(-4).map(e=>e.tagName+'.'+String(e.className).slice(0,50))`) : [];
      assert.ok(overflow <= 0, `overflow ${overflow}px at ${width}px: ${JSON.stringify(wide)}`);
      assert.deepEqual(await evaluate(outside), [], `detail controls inside the panel at ${width}px`);
      assert.equal(await evaluate(`Boolean(document.querySelector('[role="dialog"] [data-sale-detail]'))`), mobile, `bottom sheet at ${width}px`);
      if (mobile) {
        const sheet = await evaluate(`(()=>{const r=document.querySelector('[role="dialog"]').getBoundingClientRect();return {bottom:Math.round(r.bottom),left:Math.round(r.left),right:Math.round(r.right)}})()`);
        if (width < 640) assert.deepEqual([sheet.bottom, sheet.left, sheet.right], [900, 0, width], `sheet anchored to the bottom at ${width}px`);
        await noOldGreen(`the sheet at ${width}px`);
      }
      if (width === 375 || width === 1132 || width === 1440) await shot(`${width}-historial-detalle`);
    }
    await viewport(375);
    await click(`document.querySelector('[role="dialog"] button[aria-label="Cerrar"]')`, "cerrar hoja");
    await waitFor(`!document.querySelector('[role="dialog"]')&&!new URL(location.href).searchParams.has('venta')`, "hoja cerrada sin ?venta");
    await viewport(1440);
    checks.push("320–1440 px (1132 included) with the detail and the charge form open (Transferencia and Efectivo rows): no horizontal overflow, controls inside the panel; under 1024 px the detail is a sheet (anchored to the bottom under 640 px); closing it removes ?venta");

    // Account closure: the notice of the contract and an explicit confirmation (no export offered).
    await command("Page.navigate", { url: "http://localhost:4338/dashboard/cuenta" });
    await waitFor(`document.querySelector('[data-closure-notice]')`, "aviso de cierre");
    const notice = norm(await evaluate(`document.querySelector('[data-closure-notice]').innerText`));
    for (const part of ["Tu cuenta tiene dinero o entregas abiertas", "Por cobrar de ventas confirmadas", "$ 300.000", "Saldos a favor de 1 cliente", "$ 150.000", "Dinero por devolver (1 venta sin cliente)", "$ 60.000", "Ventas confirmadas sin entregar", "Todavía no hay exportación"])
      assert.ok(notice.includes(part), part);
    assert.ok(!/exportar/i.test(notice.replace("Todavía no hay exportación", "")), "no export button");
    const acknowledge = `[...document.querySelectorAll('input[type="checkbox"]')].find(i=>!i.closest('[data-closure-notice]'))`;
    await typeIn('input[type="password"]', "fixture-password");
    await evaluate(`${acknowledge}.click()`);
    await typeIn('input[autocomplete="off"]', "CERRAR CUENTA");
    const closeButton = `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Cerrar cuenta')`;
    assert.equal(await evaluate(`${closeButton}.disabled`), true, "closing needs the explicit confirmation");
    await evaluate(`[...document.querySelectorAll('[data-closure-notice] input[type="checkbox"]')][0].click()`);
    await waitFor(`!${closeButton}.disabled`, "confirmado");
    await evaluate(`${closeButton}.click()`);
    await waitFor(`location.pathname==='/cuenta-cerrada'`, "cuenta cerrada");
    const close = writes("/auth/close").at(-1);
    assert.equal(close.body.confirmOpenBalances, true);
    checks.push("Account closure: the notice lists pending, credit balances, money to refund and undelivered sales; «Cerrar cuenta» stays disabled until the owner confirms; POST /auth/close carries confirmOpenBalances; no export");

    // A 409 after a stale preview: the server's figures are shown and the owner confirms again.
    closed = false; closurePreviewOverride = { unresolvedOrders: 0, undeliveredSales: 0, pendingOrderBalance: "0", balanceDue: "0", customerCredit: { total: "0", customers: 0 }, refundDue: { total: "0", sales: 0 }, requiresConfirmation: false };
    await command("Network.setCookie", { name: "catalogo_session", value: "synthetic-fixture", url: "http://localhost:4338/", httpOnly: true, sameSite: "Lax" }); // closing cleared it
    await command("Page.navigate", { url: "http://localhost:4338/dashboard/cuenta" });
    await waitFor(`document.querySelector('[data-closure-preview="loaded"]')&&document.querySelector('input[type="password"]')`, "formulario con la vista previa");
    assert.equal(await evaluate(`Boolean(document.querySelector('[data-closure-notice]'))`), false, "nothing open: no notice");
    // The preview said nothing was open; the server's own check, at closing time, finds the open money.
    closurePreviewOverride = null; const before = writes("/auth/close").length;
    assert.equal(closurePreview().requiresConfirmation, true);
    await typeIn('input[type="password"]', "fixture-password");
    await evaluate(`${acknowledge}.click()`);
    await typeIn('input[autocomplete="off"]', "CERRAR CUENTA");
    await evaluate(`${closeButton}.click()`);
    await waitFor(`document.querySelector('[data-closure-notice]')`, "aviso tras el 409");
    await waitText("Antes de cerrar, revisa lo que queda abierto y confírmalo.");
    assert.equal(writes("/auth/close").length, before + 1); assert.equal(writes("/auth/close").at(-1).body.confirmOpenBalances, undefined);
    assert.equal(await evaluate(`${closeButton}.disabled`), true, "after the 409: confirm and authenticate again");
    checks.push("Stale preview: the server answers 409 ACCOUNT_CLOSURE_REQUIRES_CONFIRMATION with its figures; the notice appears and closing waits for the confirmation and the password again");

    // ---- F2a-3c ----
    await command("Network.setCookie", { name: "catalogo_session", value: "synthetic-fixture", url: "http://localhost:4338/", httpOnly: true, sameSite: "Lax" });
    await viewport(1440);

    // «Anular y reemplazar» on a delivered sale: Nequi → cash for the same amount; the balance stays at 0; a lost reply is retried once.
    const nequiSale = addSale({ status: "DELIVERED", lines: [line("Celular", "CEL-01", 85000, 1)], payments: [{ method: "NEQUI", amount: "85000" }] });
    await command("Page.navigate", { url: `${historyUrl}?venta=${nequiSale.id}` });
    await waitFor(`${inPanel(`[data-sale-detail="${nequiSale.id}"]`)}`, "venta entregada");
    assert.equal(await evaluate(`Boolean(${button("Anular Nequi de $ 85.000")})`), false, "no plain void on a delivered sale");
    assert.equal(await evaluate(`Boolean(${button("Registrar pago")})`), false, "a paid delivered sale takes no new payment");
    await press("Anular y reemplazar Nequi de $ 85.000");
    await waitText("Anular y reemplazar Nequi de $ 85.000");
    await click(inPanel("[data-detail-replace]"), "Anular y registrar");
    await waitText("Escribe un motivo de 3 a 300 caracteres.");
    assert.equal(writes("/replace").length, 0, "nothing sent without a reason");
    await typeIn("#replace-reason", "Pagó en efectivo, no por Nequi");
    assert.equal(await evaluate(`${inPanel("[data-replace-amount]")}.textContent.replace(/\\s+/g," ")`), "$ 85.000", "the amount is fixed: the voided one");
    await typeIn("#replace-received", "100000");
    await waitFor(`${inPanel("[data-replace-change]")}?.textContent.replace(/\\s+/g," ")==="$ 15.000"`, "cambio informativo");
    await shot("1440-anular-reemplazar");
    dropNext = "/replace";
    await click(inPanel("[data-detail-replace]"), "Anular y registrar Efectivo");
    await waitText("Reintenta: se enviará la misma operación y no se duplicará.");
    await press("Reintentar");
    await waitText("Pago reemplazado: Efectivo por $ 85.000. Cambio $ 15.000.");
    const [lostReplace, retriedReplace] = writes("/replace");
    assert.equal(lostReplace.body.operationId, retriedReplace.body.operationId);
    assert.deepEqual(lostReplace.body.payment, { method: "CASH", amount: "85000", cashReceived: "100000" });
    assert.equal(sales.get(nequiSale.id).entries.filter(e => e.kind === "PAYMENT").length, 2, "one voided payment and one replacement, no duplicate");
    assert.deepEqual(await evaluate(`[...${panel}.querySelectorAll('[data-ledger-entry]')].map(e=>[e.dataset.ledgerEntry,Boolean(e.dataset.voided),e.querySelector('span').textContent])`),
      [["PAYMENT", true, "Nequi"], ["PAYMENT", false, "Efectivo"]], "the voided payment struck through, the new one below");
    assert.ok((await panelText()).includes("Motivo: Pagó en efectivo, no por Nequi"));
    assert.deepEqual([await money("paid"), await money("balance")], ["$ 85.000", "$ 0"]);
    checks.push("«Anular y reemplazar» on a delivered sale (Nequi → Efectivo): no plain «Anular», reason required, amount fixed to the voided one, change informative; a lost reply is retried with the same operation; the voided payment struck through with its reason and the new one below; balance stays $ 0");

    // Repair: a delivered sale left with a balance by a plain void before F2a-3c can be paid down, never above the balance.
    const holed = addSale({ status: "DELIVERED", lines: [line("Parlante", "PAR-02", 60000, 1)], payments: [{ method: "CASH", amount: "60000" }] });
    entry(holed, { kind: "REVERSAL", amount: 60000n, reversesEntryId: holed.entries[0].id, reason: "Anulado antes de la regla" });
    await command("Page.navigate", { url: `${historyUrl}?venta=${holed.id}` });
    await waitFor(`${inPanel(`[data-sale-detail="${holed.id}"]`)}`, "venta con saldo previo");
    assert.equal(await money("balance"), "$ 60.000");
    assert.equal(await evaluate(`Boolean(${startsWith("Cobrar y entregar")})`), false);
    await press("Registrar pago");
    await waitText("quedó con saldo por una anulación anterior");
    await press("Agregar pago: Efectivo");
    await typeIn(`[data-detail-panel] [data-payment-row="CASH"] input:not([id$="-received"])`, "70000");
    await waitText("Los pagos superan el total por $ 10.000");
    assert.equal(await evaluate(`${inPanel("[data-detail-pay]")}.disabled`), true, "never above the balance");
    await click(inPanel("[data-pay-total]"), "Pagar el total");
    await click(inPanel("[data-detail-pay]"), "Registrar pago");
    await waitText("Pago registrado.");
    assert.equal(await money("balance"), "$ 0");
    assert.equal(await evaluate(`Boolean(${button("Registrar pago")})`), false, "once repaired, no more payments");
    checks.push("A delivered sale with an old balance offers «Registrar pago» (no «Cobrar y entregar»), limited to the balance; once paid it disappears");

    // 320–1440 px with «Anular y reemplazar» open (transfer selector and cash rows): no overflow, controls inside the panel.
    const layoutSale = addSale({ status: "DELIVERED", lines: [line("Tablet", "TAB-01", 1250000, 1)], payments: [{ method: "DAVIPLATA", amount: "1250000" }] });
    await command("Page.navigate", { url: `${historyUrl}?venta=${layoutSale.id}` });
    for (const width of [320, 375, 414, 768, 1024, 1132, 1280, 1440]) {
      await viewport(width);
      const mobile = width < 1024;
      await waitFor(mobile ? `document.querySelector('[role="dialog"] [data-sale-detail]')` : `document.querySelector('[data-detail-panel] [data-sale-detail]')`, `detalle a ${width}px`);
      if (!(await evaluate(`Boolean(${inPanel("[data-detail-replace]")})`))) await press("Anular y reemplazar Daviplata de $ 1.250.000");
      const transfer = `[...${panel}.querySelectorAll('[role="radio"]')].find(b=>b.textContent.trim()==="Transferencia")`;
      const cash = `[...${panel}.querySelectorAll('[role="radio"]')].find(b=>b.textContent.trim()==="Efectivo")`;
      await click(transfer, "Transferencia");
      await waitFor(`[...${panel}.querySelectorAll('[role="radio"]')].some(b=>b.textContent.trim()==="Banco")`, "selector de transferencia");
      assert.deepEqual(await evaluate(outside), [], `transfer selector inside the panel at ${width}px`);
      await click(cash, "Efectivo");
      await waitFor(`${inPanel("#replace-received")}`, "recibido");
      assert.deepEqual(await evaluate(outside), [], `cash fields inside the panel at ${width}px`);
      assert.ok(await evaluate(`document.documentElement.scrollWidth - document.documentElement.clientWidth`) <= 0, `no overflow at ${width}px`);
      const placeholder = await evaluate(`(()=>{const i=${inPanel("#replace-received")};return i.scrollWidth<=i.clientWidth+1})()`);
      assert.ok(placeholder, `«Recibido» shown whole at ${width}px`);
      if (width === 375 || width === 1440) await shot(`${width}-anular-reemplazar-form`);
      if (mobile) { await click(`document.querySelector('[role="dialog"] button[aria-label="Cerrar"]')`, "cerrar hoja"); await command("Page.navigate", { url: `${historyUrl}?venta=${layoutSale.id}` }); }
    }
    checks.push("320–1440 px with «Anular y reemplazar» open (Transferencia with Nequi/Daviplata/Banco, Efectivo with Recibido and Cambio): no overflow, controls inside the panel or sheet, «Recibido» shown whole");

    // Pedidos → «Convertir a venta»: no «Confirmar y entregar»; a confirmed conversion opens its detail, charged and delivered there.
    for (const [width, target] of [[1440, orders[0]], [375, orders[1]]]) {
      await viewport(width);
      await command("Page.navigate", { url: `http://localhost:4338/dashboard/catalogos/${catalog.id}` });
      await waitFor(`[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Órdenes')`, "espacio del catálogo");
      await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Órdenes').click()`);
      const article = `[...document.querySelectorAll('article')].find(a=>a.textContent.includes(${JSON.stringify(target.customerName)}))`;
      await waitFor(article, "pedido");
      await evaluate(`[...${article}.querySelectorAll('button')].find(b=>b.textContent.trim()==='Convertir a venta').click()`);
      await waitFor(`${article}.querySelector('select')`, "modo de conversión");
      assert.deepEqual(await evaluate(`[...${article}.querySelectorAll('select option')].map(o=>[o.value,o.textContent])`),
        [["DRAFT", "Crear borrador"], ["CONFIRMED", "Crear y confirmar (cobrar y entregar en Historial)"]], "no «Confirmar y entregar»");
      await evaluate(`(()=>{const s=${article}.querySelector('select');s.value='CONFIRMED';s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
      await evaluate(`[...${article}.querySelectorAll('button')].find(b=>b.textContent.trim()==='Confirmar conversión').click()`);
      await waitFor(`location.pathname==='/dashboard/ventas/historial'&&new URL(location.href).searchParams.has('venta')`, "detalle de la venta nueva");
      const conversion = writes(`/orders/${target.id}/convert-to-sale`).at(-1);
      assert.deepEqual([conversion.body.mode, conversion.body.payments], ["CONFIRMED", []], "a confirmed conversion with an advance of 0");
      const newId = await evaluate(`new URL(location.href).searchParams.get('venta')`);
      assert.equal(sales.get(newId)?.paymentMode, "TRACKED");
      await waitFor(`${inPanel(`[data-sale-detail="${newId}"]`)}`, "detalle abierto");
      const total = width === 1440 ? "$ 4.000" : "$ 8.000";
      await waitFor(`${startsWith("Cobrar y entregar")}?.textContent.replace(/\\s+/g," ").includes(${JSON.stringify(total)})`, "cobro a la vista");
      await shot(`${width}-conversion-detalle`);
      await pressStart("Cobrar y entregar");
      await press("Agregar pago: Efectivo");
      await click(inPanel("[data-detail-charge]"), "Cobrar y entregar");
      await waitFor(`${inPanel('[data-sale-status="DELIVERED"]')}`, "entregada");
      assert.equal(sales.get(newId).status, "DELIVERED");
      if (width < 1024) await click(`document.querySelector('[role="dialog"] button[aria-label="Cerrar"]')`, "cerrar hoja");
    }
    checks.push("Pedidos: «Convertir a venta» only offers «Crear borrador» and «Crear y confirmar»; confirming sends payments: [] (TRACKED, advance of 0) and opens /dashboard/ventas/historial?venta=<id> with «Cobrar y entregar» in view (1440 px panel, 375 px sheet); charged and delivered there");

    assert.deepEqual(unknown, [], "every request was expected");
    assert.ok(mutations.filter(m => m.path.startsWith("/api/sales/")).every(m => m.body.operationId && m.body.requestId), "money actions carry operationId and requestId");
  });
  console.log(JSON.stringify({ success: true, checks }, null, 2));
} catch (error) {
  console.log(JSON.stringify({ success: false, error: error instanceof Error ? error.message.slice(0, 3000) : String(error), checks }, null, 2));
  process.exitCode = 1;
}
