import assert from "node:assert/strict";
import { apiStatusOf, cancelOutcome, changeGiven, detailActions, filterSales, ledgerRows, reasonError, refundMethod, rowMoney, saleIdFrom, salePayments } from "../lib/sale-detail-ui.mjs";
import { closureNoticeRows, parseClosurePreview } from "../lib/account-closure-ui.mjs";
import { formatPesos } from "../lib/pos-ui.mjs";

// Vender › Historial and the sale detail (F2a-3b): validation of the server's payments block, actions by state,
// payments book, filters, reasons and the account closure notice. Every amount is the server's.
const checks = [];
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const entry = (n, kind, amount, extra = {}) => ({ id: id(n), kind, amount, method: kind === "PAYMENT" ? "CASH" : null, methodNote: null, reference: null, cashReceived: null, change: null,
  reversesEntryId: null, reason: null, voided: false, operationId: id(900 + n), createdAt: "2026-11-27T15:00:00.000Z", ...extra });
const tracked = (figures, entries = [], customerCredit = null) => ({ mode: "TRACKED", creditSalesEnabled: false, total: "500000", returnedValue: "0", effectiveTotal: "500000", paid: "0",
  balance: "500000", refundDue: "0", stage: "PENDING_ORDER", ...figures, entries, customerCredit });
const line = { id: id(50), inventoryItemId: id(60), quantity: 2, itemName: "Forro", sku: "F", unitPrice: "250000", unitDiscount: "0", lineTotal: "500000" };
const sale = (status, payments, extra = {}) => ({ id: id(1), status, version: 3, currency: "COP", subtotal: "500000", discountTotal: "0", total: "500000", customerId: null, lines: [line], returns: [], payments, ...extra });

// Payments block: LEGACY without figures, TRACKED validated, malformed rejected.
assert.deepEqual(salePayments(sale("DELIVERED", { mode: "LEGACY" })), { mode: "LEGACY", customerCredit: null });
assert.deepEqual(salePayments(sale("DELIVERED", undefined)), { mode: "LEGACY", customerCredit: null }, "an API without the block reads as LEGACY");
assert.equal(salePayments(sale("CONFIRMED", tracked({ paid: "200000", balance: "300000" }))).balance, "300000");
assert.throws(() => salePayments(sale("CONFIRMED", tracked({ paid: 200000 }))), /pagos de la venta/);
assert.throws(() => salePayments(sale("CONFIRMED", tracked({}, [{ ...entry(1, "PAYMENT", "1"), voided: "no" }]))));
assert.equal(rowMoney(sale("DELIVERED", { mode: "LEGACY" })), null, "LEGACY rows: no paid nor balance");
assert.deepEqual(rowMoney(sale("CONFIRMED", tracked({ paid: "200000", balance: "300000" }))), { paid: "200000", balance: "300000", refundDue: "0", stage: "PENDING_ORDER" });
checks.push("Payments block: LEGACY (or missing) has no figures; TRACKED figures are decimal strings from the server; malformed blocks are rejected");

// Actions by state, only what the F2a-2b API offers.
const a = s => detailActions(s, salePayments(s));
let act = a(sale("CONFIRMED", tracked({ paid: "200000", balance: "300000" }, [entry(1, "PAYMENT", "200000")])));
assert.deepEqual([act.chargeAndDeliver, act.registerPayment, act.deliver, act.cancel, act.registerReturn, act.voidable], [true, true, false, true, false, [id(1)]], "advance: charge the rest or pay; cancel");
act = a(sale("CONFIRMED", tracked({ paid: "500000", balance: "0", stage: "PAID" })));
assert.deepEqual([act.chargeAndDeliver, act.deliver, act.cancel], [false, true, true], "paid: Entregar");
act = a(sale("CONFIRMED", { mode: "LEGACY" }));
assert.deepEqual([act.chargeAndDeliver, act.registerPayment, act.deliver, act.cancel, act.voidable], [false, false, true, true, []], "LEGACY confirmed: deliver as before, no payments");
act = a(sale("DELIVERED", tracked({ paid: "500000", balance: "0", stage: "PAID" }, [entry(1, "PAYMENT", "500000")])));
assert.deepEqual([act.registerReturn, act.cancel, act.deliver, act.registerPayment], [true, false, false, false], "delivered: returns, no new balance");
assert.deepEqual([act.voidable, act.replaceable], [[], [id(1)]], "F2a-3c: on a delivered sale a payment is only voided with its replacement");
act = a(sale("DELIVERED", tracked({ paid: "300000", balance: "200000", stage: "BALANCE_DUE" })));
assert.deepEqual([act.registerPayment, act.chargeAndDeliver], [true, false], "an old balance on a delivered sale can be paid down");
act = a(sale("RETURNED", tracked({ effectiveTotal: "0", paid: "60000", balance: "0", refundDue: "60000", stage: "REFUND_DUE" }, [entry(1, "PAYMENT", "60000"), entry(2, "SALE_REFUND", "10000")])));
assert.deepEqual([act.voidable, act.replaceable], [[id(1), id(2)], []], "after a full return a plain void leaves no balance");
act = a(sale("CANCELLED", tracked({ effectiveTotal: "0", paid: "200000", balance: "0", refundDue: "200000", stage: "REFUND_DUE" })));
assert.equal(act.refundMoney, true, "por devolver without customer: Devolver dinero");
act = a(sale("CANCELLED", tracked({ effectiveTotal: "0", paid: "0", balance: "0", stage: "SETTLED" }, [], "200000"), { customerId: id(7) }));
assert.deepEqual([act.refundMoney, act.refundCredit], [false, true], "customer with credit: Devolver saldo a favor");
assert.equal(a(sale("DRAFT", { mode: "LEGACY" })).continueDraft, true);
checks.push("Actions: «anular y reemplazar» for payments of delivered sales and «Registrar pago» only for an old balance (F2a-3c); charge-and-deliver and pay with a balance, deliver when paid or LEGACY, cancel while confirmed, returns once delivered, refunds of money due or of customer credit, continue a draft in Vender");

// Payments book: reversals hidden, the voided entry struck through with its reason; change only informative.
const pay = entry(1, "PAYMENT", "35000", { cashReceived: "50000", change: "15000", voided: true });
const rows = ledgerRows([pay, entry(2, "PAYMENT", "50000", { method: "NEQUI" }), entry(3, "REVERSAL", "35000", { reversesEntryId: id(1), reason: "Registrado dos veces", createdAt: "2026-11-27T16:00:00.000Z" }),
  entry(4, "EXCESS_TO_CREDIT", "50000"), entry(5, "SALE_REFUND", "10000", { method: "OTHER", methodNote: "Bono", reason: "Cliente devolvió" })]);
assert.deepEqual(rows.map(r => [r.label, r.sign, r.voided, r.voidReason]), [["Efectivo", 1, true, "Registrado dos veces"], ["Nequi", 1, false, null], ["Pasó a saldo a favor del cliente", -1, false, null],
  ["Dinero devuelto · Otro: Bono", -1, false, null]]);
assert.equal(rows[3].reason, "Cliente devolvió");
assert.equal(changeGiven([pay, entry(2, "PAYMENT", "1000", { cashReceived: "5000", change: "4000" })]), 4000n, "voided payments give no change");
checks.push("Payments book: reversals are not rows; the voided payment is struck through with its reason; transfers, credit moves and refunds labelled with their sign; change of standing cash payments only");

// Filters: display status (partial returns) and the API status for a customer's pages.
const partial = sale("DELIVERED", { mode: "LEGACY" }, { id: id(2), returns: [{ id: id(80), reason: "x", lines: [{ saleLineId: id(50), receivedQuantity: 1, resellableQuantity: 1, damagedQuantity: 0 }] }] });
const delivered = sale("DELIVERED", { mode: "LEGACY" }, { id: id(3) });
assert.deepEqual(filterSales([partial, delivered], "PARTIALLY_RETURNED").map(s => s.id), [id(2)]);
assert.deepEqual(filterSales([partial, delivered], "DELIVERED").map(s => s.id), [id(3)]);
assert.equal(filterSales([partial, delivered], "all").length, 2);
assert.equal(apiStatusOf("PARTIALLY_RETURNED"), "DELIVERED"); assert.equal(apiStatusOf("CANCELLED"), "CANCELLED");
checks.push("Filters: «Devuelta parcialmente» is a delivered sale with returns (DELIVERED in the customer's pages, then filtered); «Entregada» excludes it");

// Reasons and refund methods; ids from the URL.
assert.equal(reasonError("  ab "), "Escribe un motivo de 3 a 300 caracteres.");
assert.equal(reasonError("Cliente devolvió"), null);
assert.equal(reasonError("x".repeat(301)) !== null, true);
assert.deepEqual(refundMethod("NEQUI", ""), { value: { method: "NEQUI" } });
assert.ok(refundMethod("OTHER", "ab").error); assert.deepEqual(refundMethod("OTHER", " Bono "), { value: { method: "OTHER", methodNote: "Bono" } });
assert.ok(refundMethod("CREDIT", "").error, "only real methods");
assert.equal(saleIdFrom(id(1).toUpperCase()), id(1)); assert.equal(saleIdFrom("../x"), null); assert.equal(saleIdFrom(null), null);
checks.push("Reasons 3–300 characters; refund method with a note only for «Otro»; only a UUID in ?venta= opens a sale");

// Cancellation outcome from the server's figures (contract section 4).
assert.deepEqual(cancelOutcome(sale("CONFIRMED", tracked({ paid: "200000", balance: "300000" })), undefined), { kind: "refund", amount: "200000" });
assert.deepEqual(cancelOutcome(sale("CONFIRMED", tracked({ paid: "200000", balance: "300000" }), { customerId: id(7) })), { kind: "credit", amount: "200000" });
assert.deepEqual(cancelOutcome(sale("CONFIRMED", tracked({}))), { kind: "none" });
assert.deepEqual(cancelOutcome(sale("CONFIRMED", { mode: "LEGACY" })), { kind: "none" }, "LEGACY: as before, no money moves");
checks.push("Cancellation with an advance: with customer to credit balance; without customer to refund now or keep «por devolver»; LEGACY moves no money");

// Account closure notice (correction C).
const preview = { unresolvedOrders: 0, undeliveredSales: 2, pendingOrderBalance: "300000", balanceDue: "0", customerCredit: { total: "70000", customers: 1 }, refundDue: { total: "60000", sales: 1 }, requiresConfirmation: true };
assert.deepEqual(parseClosurePreview({ success: true, preview }), preview);
assert.deepEqual(parseClosurePreview({ success: false, error: "ACCOUNT_CLOSURE_REQUIRES_CONFIRMATION", preview }), preview, "the 409 carries the same figures");
assert.throws(() => parseClosurePreview({ preview: { ...preview, balanceDue: 0 } }));
assert.deepEqual(closureNoticeRows(preview, formatPesos).map(r => [r.key, r.value]), [["pendingOrderBalance", formatPesos("300000")], ["customerCredit", formatPesos("70000")], ["refundDue", formatPesos("60000")], ["undeliveredSales", "2"]]);
assert.equal(closureNoticeRows(preview, formatPesos)[1].label, "Saldos a favor de 1 cliente");
checks.push("Closure notice: preview and 409 parsed alike; only open figures listed (owed, pending, credit balances, money to refund, undelivered sales)");

console.log(JSON.stringify({ success: true, checks }, null, 2));
