import assert from "node:assert/strict";
import { bogotaToday, describeExpenseFailure, EXPENSE_STATUS_LABELS, formatCop, formatExpenseDate, minExpenseDate, monthRange, parseCategories, parseExpenseDetail,
  parseExpensePage, parseSummary, PAYMENT_LABELS, PAYMENT_METHODS, possibleDuplicate, previousMonthRange, validateExpenseForm, validRange, yearRange } from "../lib/expenses-ui.mjs";

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const expense = (extra = {}) => ({ id: id(1), status: "CONFIRMED", source: "MANUAL", expenseDate: "2026-11-20", amount: "150000", currency: "COP", taxMode: "NOT_MANAGED",
  categoryId: id(2), categoryName: "Arriendo", categoryArchived: false, categoryNameSnapshot: "Arriendo", paymentMethod: "CASH", paymentMethodNote: null, description: "Arriendo local",
  supplierName: null, replacesExpenseId: null, replacedByExpenseId: null, recordedAt: "2026-11-20T15:00:00.000Z", confirmedAt: "2026-11-20T15:00:00.000Z", voidedAt: null, voidReason: null, version: 1, ...extra });
const form = (extra = {}) => ({ expenseDate: "2026-11-20", amount: "150.000", categoryId: id(2), paymentMethod: "CASH", paymentMethodNote: "", paymentReference: "", description: " Arriendo local ", supplierName: "", ...extra });
const today = "2026-11-24";

// Bogotá calendar: 03:00 UTC on the 25th is still the 24th in Bogotá (UTC−5).
assert.equal(bogotaToday(new Date("2026-11-25T03:00:00Z")), "2026-11-24");
assert.equal(bogotaToday(new Date("2026-11-25T05:00:00Z")), "2026-11-25");
assert.equal(minExpenseDate("2026-11-24"), "2021-11-24");
assert.equal(minExpenseDate("2028-02-29"), "2023-02-28");
assert.deepEqual(monthRange(today), { from: "2026-11-01", to: today });
assert.deepEqual(previousMonthRange(today), { from: "2026-10-01", to: "2026-10-31" });
assert.deepEqual(previousMonthRange("2026-01-15"), { from: "2025-12-01", to: "2025-12-31" });
assert.deepEqual(previousMonthRange("2028-03-10"), { from: "2028-02-01", to: "2028-02-29" });
assert.deepEqual(yearRange(today), { from: "2026-01-01", to: today });
assert.equal(validRange("2026-01-01", "2026-12-31"), true);
assert.equal(validRange("2028-01-01", "2028-12-31"), true, "366 days in a leap year is a difference of 365");
assert.equal(validRange("2026-01-01", "2027-01-02"), false);
assert.equal(validRange("2026-11-24", "2026-11-01"), false);
assert.equal(validRange("2026-02-30", "2026-03-01"), false);
assert.match(formatExpenseDate("2026-11-01"), /^0?1[^0-9]+(11|nov)[^0-9]*2026/i, "a calendar date never shifts a day by time zone");

// Form: amount accepts "150.000", trims texts, note only with OTHER, reference/supplier optional.
const ok = validateExpenseForm(form(), today);
assert.deepEqual(ok.errors, []);
assert.deepEqual(ok.payload, { expenseDate: "2026-11-20", amount: "150000", categoryId: id(2), paymentMethod: "CASH", description: "Arriendo local" });
assert.equal(validateExpenseForm(form({ amount: "1 000 000 000 000" }), today).errors.length, 0);
for (const amount of ["", "0", "-5", "1,5", "1.5", "1.50", "15.00", "1.000.00", "150 00", "1000000000001", "abc", "1e3"]) assert.ok(validateExpenseForm(form({ amount }), today).errors.some(e => e.includes("monto")), amount);
assert.ok(validateExpenseForm(form({ expenseDate: "2026-11-25" }), today).errors.some(e => e.includes("futura")));
assert.ok(validateExpenseForm(form({ expenseDate: "2021-11-23" }), today).errors.some(e => e.includes("cinco años")));
assert.equal(validateExpenseForm(form({ expenseDate: "2021-11-24" }), today).errors.length, 0);
assert.ok(validateExpenseForm(form({ categoryId: "" }), today).errors.some(e => e.includes("categoría")));
assert.ok(validateExpenseForm(form({ paymentMethod: "" }), today).errors.some(e => e.includes("medio de pago")));
assert.ok(validateExpenseForm(form({ paymentMethod: "OTHER", paymentMethodNote: "ab" }), today).errors.some(e => e.includes("Otro")));
const other = validateExpenseForm(form({ paymentMethod: "OTHER", paymentMethodNote: " Bancolombia ", paymentReference: " 123 ", supplierName: " Inmobiliaria " }), today);
assert.deepEqual(other.errors, []);
assert.equal(other.payload.paymentMethodNote, "Bancolombia"); assert.equal(other.payload.paymentReference, "123"); assert.equal(other.payload.supplierName, "Inmobiliaria");
assert.equal("paymentMethodNote" in validateExpenseForm(form({ paymentMethodNote: "olvidada" }), today).payload, false, "a note is never sent without OTHER");
assert.ok(validateExpenseForm(form({ description: "   " }), today).errors.some(e => e.includes("descripción")));
assert.ok(validateExpenseForm(form({ description: "x".repeat(301) }), today).errors.some(e => e.includes("descripción")));
assert.ok(validateExpenseForm(form({ paymentReference: "x".repeat(101) }), today).errors.some(e => e.includes("referencia")));
assert.ok(!/total|version|ownerId|status/.test(Object.keys(ok.payload).join()), "the client sends no totals, ownership or state");

// Duplicate warning: same date and amount among confirmed items only.
assert.equal(possibleDuplicate([expense()], ok.payload), true);
assert.equal(possibleDuplicate([expense({ status: "VOIDED" })], ok.payload), false);
assert.equal(possibleDuplicate([expense({ amount: "150001" })], ok.payload), false);

// Money is exact beyond Number.MAX_SAFE_INTEGER.
assert.equal(formatCop("1000000000000").replace(/\s/g, " "), "$ 1.000.000.000.000");
assert.equal(formatCop("9007199254740993").replace(/\s/g, " "), "$ 9.007.199.254.740.993");

// Labels cover every method and status.
assert.deepEqual(Object.keys(PAYMENT_LABELS), PAYMENT_METHODS);
assert.equal(PAYMENT_LABELS.BANK_TRANSFER, "Transferencia");
assert.deepEqual(Object.keys(EXPENSE_STATUS_LABELS).sort(), ["CONFIRMED", "PENDING_CONFIRMATION", "SKIPPED", "VOIDED"]);

// Parsers reject malformed replies; the list never carries the private payment reference.
const category = { id: id(2), name: "Arriendo", seedKey: "rent", position: 0, archivedAt: null, version: 1 };
assert.deepEqual(parseCategories({ success: true, result: { categories: [category] } }), [category]);
for (const bad of [null, { success: false }, { success: true, result: { categories: [{ ...category, id: "x" }] } }, { success: true, result: { categories: [{ ...category, version: "1" }] } }])
  assert.throws(() => parseCategories(bad), /no es válida/);
assert.equal(parseExpensePage({ success: true, result: { items: [expense()], nextCursor: null, pageSize: 25 } }).items.length, 1);
assert.throws(() => parseExpensePage({ success: true, result: { items: [expense({ paymentReference: "123" })], nextCursor: null } }), /no es válida/);
assert.throws(() => parseExpensePage({ success: true, result: { items: [expense({ amount: 150000 })], nextCursor: null } }), /no es válida/, "money must be a string");
assert.throws(() => parseExpensePage({ success: true, result: { items: [expense({ expenseDate: "2026-11-20T00:00:00Z" })], nextCursor: null } }), /no es válida/);
const summary = { confirmedTotal: "150000", confirmedCount: 1, voidedCount: 0, pendingCount: 0, pendingSuggestedTotal: "0", byCategory: [{ categoryId: id(2), name: "Arriendo", archived: false, total: "150000", count: 1 }], byPaymentMethod: [{ paymentMethod: "CASH", total: "150000", count: 1 }] };
assert.equal(parseSummary({ success: true, result: summary }).confirmedTotal, "150000");
assert.throws(() => parseSummary({ success: true, result: { ...summary, confirmedTotal: 150000 } }), /no es válida/);
assert.throws(() => parseSummary({ success: true, result: { ...summary, byPaymentMethod: [{ paymentMethod: "BITCOIN", total: "1" }] } }), /no es válida/);
assert.equal(parseExpenseDetail({ success: true, result: { expense: expense({ paymentReference: "123" }), events: [] } }).expense.paymentReference, "123");
assert.throws(() => parseExpenseDetail({ success: true, result: { expense: expense(), events: null } }), /no es válida/);

// Failures: network/5xx retry the same operation; 409s reload; 401 logs in; validation shows no action.
assert.equal(describeExpenseFailure(new TypeError("fetch failed")).action, "retry");
assert.equal(describeExpenseFailure({ status: 503, code: "EXPENSE_RETRY_SAME_OPERATION" }).action, "retry");
assert.equal(describeExpenseFailure({ status: 401, code: "AUTH_REQUIRED" }).action, "login");
for (const code of ["VERSION_CONFLICT", "INVALID_EXPENSE_TRANSITION", "IDEMPOTENCY_CONFLICT", "EXPENSE_NOT_FOUND"]) assert.equal(describeExpenseFailure({ status: 409, code }).action, "reload", code);
assert.equal(describeExpenseFailure({ status: 409, code: "EXPENSE_CATEGORY_ARCHIVED" }).action, null);
assert.match(describeExpenseFailure({ status: 409, code: "EXPENSE_CATEGORY_NAME_CONFLICT" }).detail, /reactivarla/);
assert.equal(describeExpenseFailure({ status: 400, code: "WHATEVER" }).action, null);

console.log("verify-expenses-ui: ok");
