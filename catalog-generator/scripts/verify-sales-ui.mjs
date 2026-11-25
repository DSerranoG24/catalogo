import assert from "node:assert/strict";
import { allowedActions, buildReturn, describeFailure, displayStatus, draftEstimate, formatCop, insufficientItems, intentFingerprint, lineBalances,
  parseMoneyInput, parseQuantityInput, parseSale, parseSaleList, SALE_STATUSES, STATUS_LABELS, STATUS_TONES, validateDraft } from "../lib/sales-ui.mjs";

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const line = (n, quantity = 2, extra = {}) => ({ id: id(100 + n), inventoryItemId: id(200 + n), quantity, itemName: `Artículo ${n}`, sku: `SKU-${n}`, unitPrice: "100000", unitDiscount: "0", lineTotal: String(100000 * quantity), unitCost: null, ...extra });
const sale = (status, extra = {}) => ({ id: id(1), status, version: 3, currency: "COP", subtotal: "200000", discountTotal: "0", total: "200000", createdAt: "2026-11-24T15:00:00.000Z",
  confirmedAt: null, deliveredAt: null, cancelledAt: null, returnedAt: null, customerNameSnapshot: null, customerName: null, lines: [line(1)], returns: [], ...extra });
const ret = (lines, n = 1) => ({ id: id(300 + n), reason: "Motivo", createdAt: "2026-11-24T16:00:00.000Z", lines });

// Money: strings/BigInt only, exact beyond Number.MAX_SAFE_INTEGER, Colombian grouping.
assert.equal(formatCop("200000"), "$ 200.000");
assert.equal(formatCop("0"), "$ 0");
assert.equal(formatCop(999n), "$ 999");
assert.equal(formatCop("9007199254740993"), "$ 9.007.199.254.740.993");
assert.equal(formatCop("9223372036854775807"), "$ 9.223.372.036.854.775.807");
assert.equal(parseMoneyInput(" 0012 "), "12");
for (const bad of ["", "1.000", "1,5", "-1", "1e3", "9223372036854775808", "abc"]) assert.equal(parseMoneyInput(bad), null, bad);
assert.equal(parseQuantityInput("3"), 3);
for (const bad of ["0", "-1", "1.5", "2147483648", ""]) assert.equal(parseQuantityInput(bad), null, bad);
const estimate = draftEstimate([
  { inventoryItemId: id(1), itemName: "A", sku: "A", unitPrice: "4503599627370497", stock: null, quantity: "2", unitDiscount: "1" },
  { inventoryItemId: id(2), itemName: "B", sku: "B", unitPrice: "100", stock: null, quantity: "abc", unitDiscount: "0" },
]);
assert.deepEqual([estimate.subtotal, estimate.discountTotal, estimate.total], ["9007199254740994", "2", "9007199254740992"]);
assert.equal(estimate.rows[0].lineTotal, "9007199254740992"); assert.equal(estimate.rows[1].lineTotal, null);

// Statuses: labels and tones for every displayed state, partial return derived from returns.
assert.deepEqual(SALE_STATUSES.map(s => STATUS_LABELS[s]), ["Borrador", "Confirmada", "Entregada", "Devuelta parcialmente", "Devuelta", "Cancelada"]);
for (const s of SALE_STATUSES) assert.ok(STATUS_TONES[s].includes("text-"), s);
assert.equal(displayStatus(sale("DELIVERED")), "DELIVERED");
const partial = sale("DELIVERED", { lines: [line(1, 3), line(2, 1)], returns: [ret([{ saleLineId: id(101), receivedQuantity: 1, resellableQuantity: 1, damagedQuantity: 0 }])] });
assert.equal(displayStatus(partial), "PARTIALLY_RETURNED");
assert.equal(displayStatus(sale("RETURNED")), "RETURNED");
const balances = lineBalances(partial);
assert.deepEqual(balances.get(id(101)), { sold: 3, returned: 1, pending: 2 });
assert.deepEqual(balances.get(id(102)), { sold: 1, returned: 0, pending: 1 });

// Action permissions per state.
const actions = status => Object.entries(allowedActions(status)).filter(([, v]) => v).map(([k]) => k);
assert.deepEqual(actions(sale("DRAFT")), ["editDraft", "confirm", "confirmAndDeliver"]);
assert.deepEqual(actions(sale("DRAFT", { lines: [] })), ["editDraft"], "an empty draft cannot be confirmed");
assert.deepEqual(actions(sale("CONFIRMED")), ["deliver", "cancel"]);
assert.deepEqual(actions(sale("DELIVERED")), ["registerReturn"]);
assert.deepEqual(actions(partial), ["registerReturn"]);
const fullyReturnedButDelivered = sale("DELIVERED", { returns: [ret([{ saleLineId: id(101), receivedQuantity: 2, resellableQuantity: 2, damagedQuantity: 0 }])] });
assert.deepEqual(actions(fullyReturnedButDelivered), [], "nothing pending: no return form");
for (const status of ["RETURNED", "CANCELLED"]) assert.deepEqual(actions(sale(status)), [], `${status} is read-only`);
assert.equal(allowedActions(sale("DELIVERED")).cancel, false, "a delivered sale is never cancelled from the panel");

// Draft validation.
const draftLine = extra => ({ inventoryItemId: id(1), itemName: "A", sku: "A", unitPrice: "100", stock: 5, quantity: "1", unitDiscount: "0", ...extra });
assert.deepEqual(validateDraft([draftLine()]), []);
assert.match(validateDraft([]).join(), /al menos un artículo/);
assert.match(validateDraft([draftLine({ unitPrice: null })]).join(), /ficha comercial/);
assert.match(validateDraft([draftLine({ unitDiscount: "101" })]).join(), /supera su precio/);
assert.match(validateDraft([draftLine({ quantity: "0" })]).join(), /Cantidad no válida/);
assert.match(validateDraft([draftLine(), draftLine()]).join(), /repetido/);

// Return builder: never more than pending, split resellable/damaged, reason required.
let built = buildReturn(partial, { [id(101)]: { resellable: "1", damaged: "1" } }, "  Cliente devolvió  ");
assert.deepEqual(built, { errors: [], lines: [{ saleLineId: id(101), receivedQuantity: 2, resellableQuantity: 1, damagedQuantity: 1 }], reason: "Cliente devolvió" });
built = buildReturn(partial, { [id(101)]: { resellable: "3", damaged: "0" } }, "Motivo");
assert.match(built.errors.join(), /como máximo 2 pendientes/);
assert.match(buildReturn(partial, {}, "Motivo").errors.join(), /al menos una unidad/);
assert.match(buildReturn(partial, { [id(102)]: { resellable: "1", damaged: "0" } }, "no").errors.join(), /motivo de 3 a 300/);
assert.match(buildReturn(partial, { [id(102)]: { resellable: "-1", damaged: "0" } }, "Motivo").errors.join(), /no válidas/);

// DTO validation: money must be strings; missing returns (old receipts) means none.
assert.deepEqual(parseSale({ ...sale("CONFIRMED"), returns: undefined }).returns, []);
for (const bad of [null, { ...sale("DRAFT"), total: 200000 }, { ...sale("DRAFT"), status: "PAID" }, { ...sale("DRAFT"), lines: [{ ...line(1), unitPrice: 100 }] }, { ...sale("DRAFT"), currency: "USD" }])
  assert.throws(() => parseSale(bad), /no es válida/);
assert.equal(parseSaleList({ result: [sale("DRAFT")] }).length, 1);
assert.throws(() => parseSaleList({ result: null }));

// Errors in Spanish with a clear next action.
const fail = (status, code) => describeFailure(Object.assign(new Error("x"), { status, code }));
assert.equal(describeFailure(new Error("No se pudo conectar")).action, "retry");
assert.equal(fail(409, "STOCK_INSUFFICIENT").action, "reload");
assert.equal(fail(409, "PRICE_CHANGED").action, "refreshPrices");
for (const code of ["VERSION_CONFLICT", "INVALID_TRANSITION", "RETURN_EXCEEDS_SOLD"]) assert.equal(fail(409, code).action, "reload", code);
assert.equal(fail(401, undefined).action, "login");
assert.equal(fail(500, "SALE_OPERATION_FAILED").action, "retry");
for (const code of ["STOCK_INSUFFICIENT", "PRICE_CHANGED", "VERSION_CONFLICT", "INVALID_TRANSITION", "RETURN_EXCEEDS_SOLD"]) assert.doesNotMatch(fail(409, code).title + fail(409, code).detail, /[A-Z]{4,}_/, code);
assert.deepEqual(insufficientItems([line(1, 3), line(2, 1)], [{ id: id(201), stock: 2 }, { id: id(202), stock: 9 }]), [{ name: "Artículo 1", sku: "SKU-1", available: 2, requested: 3 }]);

// Same intention, same fingerprint (same operationId); any content change is a new intention.
assert.equal(intentFingerprint("confirm", id(1), { expectedVersion: 3 }), intentFingerprint("confirm", id(1), { expectedVersion: 3 }));
assert.notEqual(intentFingerprint("confirm", id(1), { expectedVersion: 3 }), intentFingerprint("confirm", id(1), { expectedVersion: 4 }));
assert.notEqual(intentFingerprint("cancel", id(1), { reason: "a" }), intentFingerprint("cancel", id(1), { reason: "b" }));

console.log("PASS sales UI: COP formatting with BigInt, statuses incl. partial returns, action permissions, draft/return validation, DTO checks and Spanish errors");
