import assert from "node:assert/strict";
import { addPaymentRow, amountText, applySoldLines, availability, cashChange, formatPesos, METHOD_BUTTONS, parseAmountText, parseCreditBalance, parsePosItems, paymentsBody, paymentStatus,
  payExactly, totalChange, validatePayments } from "../lib/pos-ui.mjs";

// Payment box of Vender › Nueva venta (F2a-3a). The total is the server's; these helpers only split it.
const button = id => METHOD_BUTTONS.find(b => b.id === id);
const checks = [];
const row = (method, amount, received = "") => ({ key: `${method}-${amount}`, method, amount, received });

// Amount fields: thousands separators, digits only.
assert.equal(parseAmountText("139.000"), 139000n);
assert.equal(parseAmountText("139000"), 139000n);
for (const bad of ["", "1,5", "abc", "-3", "1000000000001"]) assert.equal(parseAmountText(bad), null, bad);
assert.equal(amountText(1250000n), "1.250.000");
assert.equal(formatPesos("139000"), "$ 139.000");
checks.push("Amounts: thousands separators in and out; empty, commas, signs and amounts above 1e12 are rejected");

// Falta / Completo / Sobran against the server total.
assert.deepEqual(paymentStatus("139000", []), { total: 139000n, paid: 0n, remaining: 139000n, excess: 0n, complete: false });
assert.equal(paymentStatus("139000", [row("CASH", "100.000"), row("NEQUI", "39.000")]).complete, true);
assert.deepEqual(paymentStatus("139000", [row("CASH", "140.000")]).excess, 1000n);
assert.equal(paymentStatus("0", []).complete, true, "a zero-total sale needs no payment");
checks.push("Status: missing, complete and excess against the server total; a zero total is complete");

// Tapping a method adds a row with what is still missing; complete → empty amount.
let rows = addPaymentRow([], button("CASH"), "139000", null, "a");
assert.deepEqual(rows.map(r => [r.method, r.amount]), [["CASH", "139.000"]]);
rows = [{ ...rows[0], amount: "100.000" }];
rows = addPaymentRow(rows, button("TRANSFER"), "139000", null, "b");
assert.deepEqual(rows.map(r => [r.method, r.amount]), [["CASH", "100.000"], ["NEQUI", "39.000"]], "Transferencia starts as Nequi with the rest");
rows = addPaymentRow(rows, button("CARD"), "139000", null, "c");
assert.equal(rows.at(-1).amount, "", "nothing missing: empty amount");
checks.push("Rows: each method adds a row with what is missing (Transferencia as Nequi); nothing missing → empty");

// Saldo a favor: never more than available, a single row.
let credit = addPaymentRow([], button("CREDIT"), "139000", "70000", "k");
assert.deepEqual(credit.map(r => [r.method, r.amount]), [["CREDIT", "70.000"]]);
assert.equal(addPaymentRow(credit, button("CREDIT"), "139000", "70000", "k2").length, 1, "one credit row");
credit = addPaymentRow([], button("CREDIT"), "50000", "70000", "k");
assert.equal(credit[0].amount, "50.000", "never more than what is missing");
const tooMuch = validatePayments("139000", [row("CREDIT", "80.000"), row("CASH", "59.000")], "70000");
assert.ok(tooMuch.errors.some(e => e.includes("saldo a favor disponible es $ 70.000")));
assert.equal(tooMuch.canDeliver, false);
checks.push("Saldo a favor: proposes min(missing, available), one row only, and more than available is an error");

// Cash received and change.
assert.equal(cashChange(row("CASH", "89.000", "100.000")), 11000n);
assert.equal(cashChange(row("CASH", "89.000", "")), null);
assert.equal(cashChange(row("CASH", "89.000", "50.000")), null);
assert.equal(cashChange(row("NEQUI", "89.000", "100.000")), null);
assert.equal(totalChange([row("CASH", "50.000", "60.000"), row("CASH", "39.000", "40.000"), row("CARD", "50.000")]), 11000n);
const short = validatePayments("89000", [row("CASH", "89.000", "50.000")], null);
assert.ok(short.errors.includes("El efectivo recibido no alcanza para el pago en efectivo."));
checks.push("Cash: change = received − amount, only for cash; received below the amount is an error");

// Cobrar y entregar needs exactly the total (fiado off); Confirmar, entregar después accepts an advance.
const partial = validatePayments("139000", [row("CASH", "50.000")], null);
assert.equal(partial.canDeliver, false); assert.equal(partial.canConfirmLater, true);
assert.match(partial.deliverBlockedReason, /Falta \$ 89\.000/);
const none = validatePayments("139000", [], null);
assert.equal(none.canConfirmLater, true, "confirming without an advance is allowed");
const over = validatePayments("139000", [row("CASH", "150.000")], null);
assert.equal(over.canDeliver, false); assert.equal(over.canConfirmLater, false); assert.ok(over.errors[0].includes("superan el total por $ 11.000"));
assert.equal(validatePayments("139000", [row("CARD", "")], null).canConfirmLater, false, "an empty row blocks");
const exact = validatePayments("139000", [row("CASH", "100.000", "100.000"), row("BANK_TRANSFER", "39.000")], null);
assert.equal(exact.canDeliver, true); assert.equal(exact.deliverBlockedReason, null);
checks.push("Actions: delivery needs exactly the total; confirm-later accepts 0..total; excess and empty rows block both");

// Body for POST /sales/:id/confirm.
assert.deepEqual(paymentsBody([row("CASH", "100.000", "120.000"), row("DAVIPLATA", "19.000"), row("CREDIT", "20.000")]),
  { payments: [{ method: "CASH", amount: "100000", cashReceived: "120000" }, { method: "DAVIPLATA", amount: "19000" }], customerCreditAmount: "20000" });
assert.deepEqual(paymentsBody([]), { payments: [] }, "payments: [] still marks the sale TRACKED");
assert.deepEqual(paymentsBody([row("CASH", "10.000", "")]), { payments: [{ method: "CASH", amount: "10000" }] }, "no cashReceived when nothing was typed");
checks.push("Body: payments always present, cashReceived only when typed, credit as customerCreditAmount");

// One availability fact per card.
assert.deepEqual(availability(0), { tone: "out", label: "Agotado" });
assert.deepEqual(availability(2), { tone: "low", label: "Quedan 2" });
assert.deepEqual(availability(5, 6), { tone: "low", label: "Quedan 5" });
assert.deepEqual(availability(12), { tone: "ok", label: "12 disponibles" });
assert.deepEqual(availability(4, 0), { tone: "ok", label: "4 disponibles" });
checks.push("Availability: Agotado, Quedan n (≤ 3 or ≤ the minimum) or n disponibles");

// Validators.
const items = parsePosItems({ result: { items: [{ id: "a", name: "Audífonos", sku: "AUD", stock: 18, minimumStock: 2, commercialTerms: { unitSalePrice: "89000" } },
  { id: "b", name: "Sin precio", sku: "SP", stock: 3, commercialTerms: null }] } });
assert.deepEqual(items.map(i => [i.id, i.price, i.minimumStock]), [["a", "89000", 2], ["b", null, 0]]);
assert.throws(() => parsePosItems({ result: {} }));
assert.throws(() => parsePosItems({ result: { items: [{ id: "a", name: "x", sku: "x", stock: 1.5 }] } }));
assert.equal(parseCreditBalance({ result: { balance: "70000" } }), "70000");
assert.throws(() => parseCreditBalance({ result: { balance: 70000 } }));
checks.push("Validators: inventory items (price or null) and credit balance as a decimal string");


// «Pagar el total» (F2a-3b): rows trimmed in order to exactly what is due; rows at 0 dropped, Recibido kept.
assert.deepEqual(payExactly([row("NEQUI", "45.000"), row("CASH", "90.000", "100.000")], "45000").map(r => [r.method, r.amount]), [["NEQUI", "45.000"]]);
assert.deepEqual(payExactly([row("CASH", "50.000", "100.000"), row("CARD", "50.000")], "70000").map(r => [r.method, r.amount, r.received]), [["CASH", "50.000", "100.000"], ["CARD", "20.000", ""]]);
assert.equal(paymentStatus("70000", payExactly([row("CASH", "200.000")], "70000")).complete, true);
assert.deepEqual(payExactly([row("CASH", "")], "70000"), [], "empty rows are dropped");
checks.push("Pagar el total: trims the rows in order to exactly the amount due, dropping rows at 0 and keeping Recibido");

// Stock on the cards right after a sale (F2a-3b, fix A.2), from the confirmed lines; never below 0.
assert.deepEqual(applySoldLines([{ id: "a", stock: 2 }, { id: "b", stock: 40 }, { id: "c", stock: 5 }], [{ inventoryItemId: "a", quantity: 2 }, { inventoryItemId: "b", quantity: 1 }, { inventoryItemId: "z", quantity: 3 }])
  .map(i => [i.id, i.stock]), [["a", 0], ["b", 39], ["c", 5]]);
assert.equal(applySoldLines([{ id: "a", stock: 1 }], [{ inventoryItemId: "a", quantity: 3 }])[0].stock, 0);
checks.push("Sold lines applied to the cards at once: stock minus what was sold, never negative; other items untouched");

console.log(JSON.stringify({ success: true, checks }, null, 2));
