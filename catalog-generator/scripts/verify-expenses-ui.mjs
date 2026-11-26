import assert from "node:assert/strict";
import { CATEGORY_STYLES, EXPENSE_STATUS_TONES, formatAmountInput, dayHeading, groupByDay, matchesSearch, monthLabel, monthName, parseExpenseOverview, PAYMENT_TONES, shiftMonth } from "../lib/expenses-ui.mjs";
import { MAX_FUTURE_MONTHS } from "../lib/expenses-ui.mjs";
import { addDays, FREQUENCIES, frequencyLabel, monthEnd, parseRecurringList, parseScheduledList, parseSyncReply, scheduledState, sortScheduled, validatePayForm, validateScheduleForm } from "../lib/expenses-ui.mjs";
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

// Gastos page helpers: months, day headings, grouping, search, overview validation and pill contrast.
assert.equal(monthLabel("2026-11"), "Noviembre 2026"); assert.equal(monthName("2026-01"), "enero");
assert.equal(shiftMonth("2026-01", -1), "2025-12"); assert.equal(shiftMonth("2026-12", 1), "2027-01"); assert.equal(shiftMonth("2026-05", -13), "2025-04");
assert.equal(dayHeading("2026-11-25", "2026-11-25"), "HOY · MIÉRCOLES 25"); assert.equal(dayHeading("2026-11-24", "2026-11-25"), "AYER · MARTES 24");
assert.equal(dayHeading("2026-11-01", "2026-11-25"), "DOMINGO 1"); assert.equal(dayHeading("2026-02-28", "2026-03-01"), "AYER · SÁBADO 28", "month border");
assert.deepEqual(groupByDay([expense({ id: id(1), expenseDate: "2026-11-25" }), expense({ id: id(2), expenseDate: "2026-11-25" }), expense({ id: id(3), expenseDate: "2026-11-23" })]).map(g => [g.date, g.items.length]),
  [["2026-11-25", 2], ["2026-11-23", 1]]);
const lamp = expense({ description: "Energía eléctrica", categoryName: "Servicios públicos", categoryNameSnapshot: "Servicios", paymentMethodNote: "Bancolombia App", supplierName: "Enel" });
for (const q of ["energia", "ELÉCTRICA", "servicios", "bancolombia", "enel", "  ", ""]) assert.equal(matchesSearch(lamp, q), true, q);
assert.equal(matchesSearch(lamp, "arriendo"), false);
const overview = { success: true, result: { month: "2026-11", from: "2026-11-01", to: "2026-11-25", generatedAt: "2026-11-25T20:56:00.000Z", future: false, total: "380000", count: 3, voidedCount: 0,
  previousMonth: { month: "2026-10", total: "0" }, days: [{ date: "2026-11-01", total: "0" }], byCategory: [{ categoryId: id(2), name: "Arriendo", archived: false, total: "150000", count: 1, percent: "39" }],
  scheduled: { fixed: { due: 5, paid: 3, paidTotal: "720000" }, upcoming: { count: 2, plannedTotal: "310000", withoutAmount: 0 }, overdue: { count: 0, plannedTotal: "0", withoutAmount: 0 }, planned: null, projected: [] },
  variable: { total: "260000", count: 14 } } };
const withScheduled = scheduled => ({ success: true, result: { ...overview.result, scheduled: { ...overview.result.scheduled, ...scheduled } } });
// Future month: zero figures, planned = generated + projected; projected dates are informative.
const projectedRow = { templateId: id(6), dueDate: "2027-01-10", description: "Arriendo", plannedAmount: "600000", categoryId: id(2), categoryName: "Arriendo", paymentMethod: "CASH", frequency: "MONTHLY", interval: 1 };
const futureOverview = { success: true, result: { ...overview.result, month: "2027-01", from: "2027-01-01", to: "2027-01-31", future: true, total: "0", count: 0, days: [{ date: "2027-01-01", total: "0" }], byCategory: [],
  scheduled: { ...overview.result.scheduled, planned: { count: 2, plannedTotal: "710000", withoutAmount: 0, projectedCount: 1 }, projected: [projectedRow] } } };
assert.equal(parseExpenseOverview(futureOverview, "2027-01").scheduled.projected[0].dueDate, "2027-01-10");
assert.equal(MAX_FUTURE_MONTHS, 12);
for (const broken of [{ ...futureOverview.result.scheduled, planned: null }, { ...futureOverview.result.scheduled, projected: [{ ...projectedRow, dueDate: "2027-02-01" }] },
  { ...futureOverview.result.scheduled, projected: [{ ...projectedRow, plannedAmount: 600000 }] }, { ...futureOverview.result.scheduled, planned: { ...futureOverview.result.scheduled.planned, projectedCount: 3 } }])
  assert.throws(() => parseExpenseOverview({ success: true, result: { ...futureOverview.result, scheduled: broken } }, "2027-01"), /no es válida/);
assert.throws(() => parseExpenseOverview({ success: true, result: { ...overview.result, scheduled: { ...overview.result.scheduled, projected: [projectedRow] } } }, "2026-11"), /no es válida/, "only future months project");
assert.equal(parseExpenseOverview(overview, "2026-11").total, "380000");
for (const broken of [{ ...overview, success: false }, { success: true, result: { ...overview.result, total: 380000 } }, { success: true, result: { ...overview.result, month: "2026-10" } },
  { success: true, result: { ...overview.result, days: [{ date: "2026-10-31", total: "0" }] } }, { success: true, result: { ...overview.result, byCategory: [{ ...overview.result.byCategory[0], percent: 39 }] } },
  { success: true, result: { ...overview.result, scheduled: undefined } }, { success: true, result: { ...overview.result, variable: { total: 260000, count: 14 } } },
  withScheduled({ fixed: { due: 2, paid: 3, paidTotal: "0" } }), withScheduled({ upcoming: null }), { success: true, result: { ...overview.result, future: undefined } }, withScheduled({ overdue: { count: 1, plannedTotal: "0", withoutAmount: 2 } })])
  assert.throws(() => parseExpenseOverview(broken, "2026-11"), /no es válida/);
const L = h => { const c = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]; };
const ratio = classes => { const [bg, fg] = [classes.match(/bg-\[(#[0-9A-Fa-f]{6})\]/)[1], classes.match(/text-\[(#[0-9A-Fa-f]{6})\]/)[1]]; const [a, b] = [L(bg), L(fg)]; return (Math.max(a, b) + .05) / (Math.min(a, b) + .05); };
for (const [method, classes] of Object.entries(PAYMENT_TONES)) assert.ok(ratio(classes) >= 4.5, `${method} pill contrast ${ratio(classes).toFixed(2)}`);
for (const [key, style] of Object.entries(CATEGORY_STYLES)) assert.ok(ratio(style.tone) >= 3, `${key} icon contrast`);

// Amount field: thousands separators while typing, caret kept, paste with or without dots, separators deleted with their digit.
const type = text => [...text].reduce((state, ch) => formatAmountInput(state.value.slice(0, state.caret) + ch + state.value.slice(state.caret), state.caret + 1, state.value), { value: "", caret: 0 });
assert.deepEqual(type("1250000"), { value: "1.250.000", caret: 9 });
assert.deepEqual(type("12345"), { value: "12.345", caret: 6 });
assert.deepEqual(formatAmountInput("1.50.000", 2, "1.250.000", "deleteContentBackward"), { value: "150.000", caret: 1 }, "backspace in the middle keeps the caret");
assert.deepEqual(formatAmountInput("1250.000", 1, "1.250.000", "deleteContentBackward"), { value: "250.000", caret: 0 }, "backspace over a dot deletes the digit before it");
assert.deepEqual(formatAmountInput("1.250000", 5, "1.250.000", "deleteContentForward"), { value: "125.000", caret: 5 }, "delete over a dot deletes the digit after it");
assert.deepEqual(formatAmountInput("1.2950.000", 4, "1.250.000", "insertText"), { value: "12.950.000", caret: 4 }, "typing in the middle keeps the caret after the new digit");
assert.equal(formatAmountInput("12.345", 6).value, "12.345", "paste with dots"); assert.equal(formatAmountInput("12345", 5).value, "12.345", "paste without dots");
assert.equal(formatAmountInput(" 1 250 000 ", 11).value, "1.250.000", "spaces as separators");
assert.equal(formatAmountInput("1000000000000", 13).value, "1.000.000.000.000"); assert.equal(formatAmountInput("9007199254740993", 16).value, "9.007.199.254.740.993");
assert.deepEqual(formatAmountInput("", 0), { value: "", caret: 0 }); assert.equal(formatAmountInput("0", 1).value, "0"); assert.equal(formatAmountInput("0050", 4).value, "50");
assert.equal(formatAmountInput("12a3", 4).value, "123", "only digits");
assert.equal(formatAmountInput("1,5", 3).value, "1,5", "a decimal comma is left for validation to reject");
for (const amount of ["1.250.000", "12.345", "1.000.000.000.000"]) assert.deepEqual(validateExpenseForm(form({ amount }), today).errors, [], amount);
assert.equal(validateExpenseForm(form({ amount: "1.250.000" }), today).payload.amount, "1250000", "the API still receives digits only");
assert.ok(validateExpenseForm(form({ amount: "1.000.000.000.001" }), today).errors.length > 0, "limit kept");
assert.ok(validateExpenseForm(form({ amount: "1,5" }), today).errors.some(e => e.includes("monto")));
for (const [status, classes] of Object.entries(EXPENSE_STATUS_TONES)) assert.ok(ratio(classes) >= 4.5, `${status} badge contrast`);

// F1b: «Programar pago» (single or «Repetir»), «Marcar pagado», list validation and the state pills.
const schedule = (extra = {}) => ({ plannedAmount: "", dueDate: "2026-11-28", categoryId: id(2), paymentMethod: "BANK_TRANSFER", paymentMethodNote: "", description: " Internet ",
  supplierName: "", repeat: false, frequency: "MONTHLY", interval: "1", endDate: "", ...extra });
assert.deepEqual(validateScheduleForm(schedule(), today), { errors: [], path: "/expenses/scheduled",
  payload: { description: "Internet", categoryId: id(2), paymentMethod: "BANK_TRANSFER", dueDate: "2026-11-28" } }, "planned amount is optional");
assert.equal(validateScheduleForm(schedule({ plannedAmount: "110.000" }), today).payload.plannedAmount, "110000");
assert.deepEqual(validateScheduleForm(schedule({ repeat: true, plannedAmount: "110.000", interval: "2", endDate: "2027-12-31" }), today), { errors: [], path: "/expenses/recurring",
  payload: { description: "Internet", categoryId: id(2), paymentMethod: "BANK_TRANSFER", anchorDate: "2026-11-28", frequency: "MONTHLY", interval: 2, estimatedAmount: "110000", endDate: "2027-12-31" } });
assert.equal(validateScheduleForm(schedule({ dueDate: today }), today).errors.length, 0, "due today is allowed");
for (const [extra, word] of [[{ dueDate: "2026-11-23" }, "futura"], [{ dueDate: addDays(today, 367) }, "un año"], [{ plannedAmount: "1,5" }, "monto"], [{ categoryId: "" }, "categoría"],
  [{ description: "  " }, "descripción"], [{ paymentMethod: "OTHER" }, "Otro"], [{ repeat: true, interval: "13" }, "1 a 12"], [{ repeat: true, interval: "0" }, "1 a 12"],
  [{ repeat: true, frequency: "BIWEEKLY" }, "cada cuánto"], [{ repeat: true, endDate: "2026-11-27" }, "fecha final"]])
  assert.ok(validateScheduleForm(schedule(extra), today).errors.some(e => e.includes(word)), JSON.stringify(extra));
assert.equal(validateScheduleForm(schedule({ dueDate: addDays(today, 366) }), today).errors.length, 0);
assert.deepEqual(FREQUENCIES, ["WEEKLY", "MONTHLY", "YEARLY"], "no «quincenal»: a fortnight is two monthly fixed expenses");
assert.equal(frequencyLabel("MONTHLY", 1), "Cada mes"); assert.equal(frequencyLabel("WEEKLY", 2), "Cada 2 semanas"); assert.equal(frequencyLabel("YEARLY", 1), "Cada año");
const pay = (extra = {}) => ({ amount: "115.000", expenseDate: today, paymentMethod: "NEQUI", paymentMethodNote: "", paymentReference: "", ...extra });
assert.deepEqual(validatePayForm(pay(), today), { errors: [], payload: { amount: "115000", expenseDate: today, paymentMethod: "NEQUI" } });
for (const [extra, word] of [[{ amount: "" }, "monto"], [{ amount: "0" }, "monto"], [{ expenseDate: "2026-11-25" }, "futura"], [{ expenseDate: "2021-11-23" }, "cinco años"], [{ paymentMethod: "OTHER" }, "Otro"]])
  assert.ok(validatePayForm(pay(extra), today).errors.some(e => e.includes(word)), JSON.stringify(extra));
assert.equal(addDays("2026-11-28", 7), "2026-12-05"); assert.equal(monthEnd("2028-02"), "2028-02-29");
const payment = (extra = {}) => ({ id: id(5), status: "PENDING", kind: "fixed", templateId: id(6), occurrenceDate: "2026-11-28", dueDate: "2026-11-28", daysUntilDue: 4, overdue: false,
  plannedAmount: "110000", description: "Internet", categoryId: id(2), categoryName: "Internet", categoryArchived: false, paymentMethod: "BANK_TRANSFER", paymentMethodNote: null, supplierName: null,
  customized: false, paidExpenseId: null, paidAt: null, paidAmount: null, paidDate: null, cancelledAt: null, cancelReason: null, version: 1, ...extra });
assert.equal(parseScheduledList({ success: true, result: { items: [payment()], truncated: false, today } }).items.length, 1);
for (const broken of [{ success: true, result: { items: [payment({ plannedAmount: 110000 })], truncated: false, today } }, { success: true, result: { items: [payment({ status: "SKIPPED" })], truncated: false, today } },
  { success: true, result: { items: [], today } }]) assert.throws(() => parseScheduledList(broken), /no es válida/);
const template = { id: id(6), status: "ACTIVE", description: "Internet", categoryId: id(2), categoryName: "Internet", categoryArchived: false, paymentMethod: "CASH", paymentMethodNote: null,
  supplierName: null, estimatedAmount: null, frequency: "MONTHLY", interval: 1, anchorDate: "2026-11-28", endDate: null, nextDate: "2026-11-28", endedAt: null, version: 1 };
assert.equal(parseRecurringList({ success: true, result: { templates: [template] } }).length, 1);
assert.throws(() => parseRecurringList({ success: true, result: { templates: [{ ...template, frequency: "BIWEEKLY" }] } }), /no es válida/);
assert.deepEqual(parseSyncReply({ success: true, result: { generated: 2, pendingCount: 5 } }), { generated: 2, pendingCount: 5 });
assert.throws(() => parseSyncReply({ success: true, result: {} }), /no es válida/);
assert.deepEqual([payment({ status: "PAID" }), payment({ daysUntilDue: 0 }), payment({ daysUntilDue: 3 }), payment({ daysUntilDue: 8 }), payment({ daysUntilDue: -2, overdue: true }), payment({ daysUntilDue: -1, overdue: true }), payment({ daysUntilDue: 1 })]
  .map(p => scheduledState(p).label), ["Pagado", "Vence hoy", "Vence en 3 días", "Por pagar", "Vencido hace 2 días", "Venció ayer", "Vence mañana"]);
assert.deepEqual(sortScheduled([payment({ id: id(7), status: "PAID", dueDate: "2026-11-01" }), payment({ id: id(8), dueDate: "2026-11-30" }), payment({ id: id(9), overdue: true, dueDate: "2026-11-02" }), payment({ id: id(10), dueDate: "2026-11-26" })])
  .map(p => p.id), [id(9), id(10), id(8), id(7)], "overdue, then pending by date, then paid");
for (const key of ["paid", "overdue", "soon", "pending"]) { const p = { paid: payment({ status: "PAID" }), overdue: payment({ overdue: true, daysUntilDue: -1 }), soon: payment(), pending: payment({ daysUntilDue: 20 }) }[key]; assert.ok(ratio(scheduledState(p).tone) >= 4.5, `${key} pill contrast`); }

console.log("verify-expenses-ui: ok");
