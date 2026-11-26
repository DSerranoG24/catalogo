import assert from "node:assert/strict";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { privatePanelFixture } from "./private-panel-browser-fixture.mjs";
import { addDays, bogotaToday, monthEnd, monthLabel, monthName, previousMonthRange, shiftMonth } from "../lib/expenses-ui.mjs";

// Real Chromium, real Next proxy, simulated API with the rules of docs/expenses-contract.md v1.2 (F1a)
// and docs/expenses-f1b-contract.md (fixed expenses and scheduled payments: never added until paid).
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const now = () => new Date().toISOString();
const today = bogotaToday(), previous = previousMonthRange(today);
const SEEDS = [["rent", "Arriendo"], ["utilities", "Servicios públicos"], ["internet-phone", "Internet y telefonía"], ["transport-delivery", "Transporte y domicilios"],
  ["advertising", "Publicidad y redes"], ["maintenance", "Mantenimiento y reparaciones"], ["stationery", "Papelería e insumos"],
  ["fees", "Comisiones bancarias y de plataformas"], ["taxes-procedures", "Impuestos y trámites"], ["payroll-fees", "Nómina y honorarios"], ["other", "Otros gastos"]];
const METHODS = ["CASH", "NEQUI", "DAVIPLATA", "BANK_TRANSFER", "CARD", "OTHER"];
const PAGE = 3; // Smaller than the real 25 so pagination is exercised; the client reads nextCursor only.
const categories = [], expenses = [], events = [], operations = new Map(), requestIds = new Set(), mutations = [], unknown = [], checks = [];
let dropNextAfterCommit = false, detail404 = false, slow = null, syncFails = 0;
const templates = [], payments = [], log = [];
const normalized = name => name.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
const category = id => categories.find(c => c.id === id);
const expense = id => expenses.find(e => e.id === id);
const catView = c => ({ id: c.id, name: c.name, seedKey: c.seedKey, position: c.position, archivedAt: c.archivedAt, version: c.version });
const view = (e, withReference = false) => {
  const c = category(e.categoryId), { paymentReference, ...rest } = e;
  const scheduledPaymentId = e.scheduledPaymentId ?? null, linked = payments.find(x => x.id === scheduledPaymentId);
  return { ...rest, scheduledPaymentId, fixed: Boolean(linked?.templateId), categoryName: c.name, categoryArchived: Boolean(c.archivedAt),
    replacedByExpenseId: expenses.find(x => x.replacesExpenseId === e.id)?.id ?? null, ...(withReference ? { paymentReference } : {}) };
};

// ---- F1b simulation: occurrence dates (last day of the month for the 31st), generation up to max(month end, today + 7). ----
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
function nth(t, k) {
  if (t.frequency === "WEEKLY") return addDays(t.anchorDate, 7 * t.interval * k);
  const [y, m, d] = t.anchorDate.split("-").map(Number), months = (y * 12 + m - 1) + (t.frequency === "YEARLY" ? 12 : 1) * t.interval * k;
  const month = `${Math.floor(months / 12)}-${String(months % 12 + 1).padStart(2, "0")}`, last = Number(monthEnd(month).slice(8));
  return `${month}-${String(Math.min(d, last)).padStart(2, "0")}`;
}
function generate(t) {
  if (t.status !== "ACTIVE") return 0;
  const horizon = [monthEnd(today.slice(0, 7)), addDays(today, 7)].sort().at(-1);
  let dates = [];
  for (let k = 0; dates.length < 400; k++) { const date = nth(t, k); if (date > horizon || (t.endDate && date > t.endDate)) break; if (!t.generatedThrough || date > t.generatedThrough) dates.push(date); }
  if (!t.generatedThrough) { const past = dates.filter(d => d < today); dates = [...past.slice(-1), ...dates.filter(d => d >= today)]; }
  let created = 0;
  for (const date of dates.slice(0, 24)) {
    if (payments.some(x => x.templateId === t.id && x.occurrenceDate === date && x.status !== "CANCELLED")) continue; // partial unique index
    payments.push({ id: randomUUID(), status: "PENDING", templateId: t.id, occurrenceDate: date, dueDate: date, plannedAmount: t.estimatedAmount, description: t.description, categoryId: t.categoryId,
      paymentMethod: t.paymentMethod, paymentMethodNote: t.paymentMethodNote, supplierName: t.supplierName, customized: false, paidExpenseId: null, paidAt: null, cancelledAt: null, cancelReason: null, version: 1 });
    created++;
  }
  t.generatedThrough = horizon; return created;
}
const scheduledView = x => {
  const paid = x.paidExpenseId ? expense(x.paidExpenseId) : null, c = category(x.categoryId);
  return { ...x, kind: x.templateId ? "fixed" : "single", daysUntilDue: daysBetween(today, x.dueDate), overdue: x.status === "PENDING" && x.dueDate < today, categoryName: c.name, categoryArchived: Boolean(c.archivedAt),
    paidAmount: paid?.amount ?? null, paidDate: paid?.expenseDate ?? null };
};
const templateView = t => {
  let next = null; for (let k = 0; k < 2000 && t.status !== "ENDED"; k++) { const d = nth(t, k); if (t.endDate && d > t.endDate) break; if (d >= today) { next = d; break; } }
  const { generatedThrough, ...rest } = t; void generatedThrough;
  return { ...rest, categoryName: category(t.categoryId).name, categoryArchived: Boolean(category(t.categoryId).archivedAt), nextDate: next, endedAt: t.endedAt ?? null };
};
const cancelFuture = (t, reason) => { let n = 0; for (const x of payments) if (x.templateId === t.id && x.status === "PENDING" && x.dueDate >= today && !x.customized) { Object.assign(x, { status: "CANCELLED", cancelledAt: now(), cancelReason: reason }); x.version++; n++; } return n; };
function validSchedule(input, fields) {
  strict(input, fields);
  for (const key of ["plannedAmount", "estimatedAmount"]) if (input[key] !== undefined && input[key] !== null && !/^[1-9][0-9]{0,12}$/.test(input[key])) throw invalid();
  if (input.paymentMethod !== undefined && (!METHODS.includes(input.paymentMethod) || (input.paymentMethod === "OTHER") !== (typeof input.paymentMethodNote === "string"))) throw invalid();
  if (input.categoryId !== undefined) { const c = category(input.categoryId); if (!c) throw new Fail(404, "EXPENSE_CATEGORY_NOT_FOUND"); if (c.archivedAt) throw new Fail(409, "EXPENSE_CATEGORY_ARCHIVED"); }
  if (input.description !== undefined && (typeof input.description !== "string" || !input.description.trim())) throw invalid();
}
function scheduledMutation(method, p, body) {
  let m;
  if (method === "POST" && p === "/api/expenses/scheduled/sync") {
    if (Object.keys(body).length) throw invalid();
    if (syncFails > 0) { syncFails--; throw new Fail(503, "EXPENSE_RETRY_SAME_OPERATION"); }
    let generated = 0; for (const t of templates) generated += generate(t);
    return { status: 200, body: { generated, pendingCount: payments.filter(x => x.status === "PENDING").length } };
  }
  if (method === "POST" && p === "/api/expenses/scheduled") return receipt(body, "createScheduled", "new", () => {
    const input = { ...body }; delete input.operationId; delete input.requestId;
    validSchedule(input, ["dueDate", "plannedAmount", "description", "categoryId", "paymentMethod", "paymentMethodNote", "supplierName"]);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate ?? "") || input.dueDate > addDays(today, 366)) throw invalid();
    const x = { id: randomUUID(), status: "PENDING", templateId: null, occurrenceDate: null, dueDate: input.dueDate, plannedAmount: input.plannedAmount ?? null, description: input.description.trim(),
      categoryId: input.categoryId, paymentMethod: input.paymentMethod, paymentMethodNote: input.paymentMethodNote ?? null, supplierName: input.supplierName ?? null, customized: false,
      paidExpenseId: null, paidAt: null, cancelledAt: null, cancelReason: null, version: 1 };
    payments.push(x); return { payment: scheduledView(x) };
  });
  if (method === "POST" && p === "/api/expenses/recurring") return receipt(body, "createRecurring", "new", () => {
    const input = { ...body }; delete input.operationId; delete input.requestId;
    validSchedule(input, ["description", "categoryId", "paymentMethod", "paymentMethodNote", "supplierName", "estimatedAmount", "frequency", "interval", "anchorDate", "endDate"]);
    if (!["WEEKLY", "MONTHLY", "YEARLY"].includes(input.frequency) || !Number.isInteger(input.interval) || input.interval < 1 || input.interval > 12) throw invalid();
    const t = { id: randomUUID(), status: "ACTIVE", description: input.description.trim(), categoryId: input.categoryId, paymentMethod: input.paymentMethod, paymentMethodNote: input.paymentMethodNote ?? null,
      supplierName: input.supplierName ?? null, estimatedAmount: input.estimatedAmount ?? null, frequency: input.frequency, interval: input.interval, anchorDate: input.anchorDate, endDate: input.endDate ?? null, generatedThrough: null, version: 1 };
    templates.push(t); const generated = generate(t); return { template: templateView(t), generated };
  });
  if ((m = p.match(/^\/api\/expenses\/scheduled\/([^/]+)(?:\/(pay|cancel))?$/))) {
    const x = payments.find(y => y.id === m[1]); if (!x) throw new Fail(404, "SCHEDULED_EXPENSE_NOT_FOUND");
    const kind = m[2] ?? "updateScheduled";
    return receipt(body, kind, x.id, () => {
      if (x.status !== "PENDING") throw new Fail(409, "INVALID_SCHEDULED_TRANSITION"); versioned(x, body.expectedVersion);
      if (kind === "pay") {
        strict(body, ["expectedVersion", "amount", "expenseDate", "paymentMethod", "paymentMethodNote", "paymentReference"]);
        const input = { expenseDate: body.expenseDate, amount: body.amount, categoryId: x.categoryId, paymentMethod: body.paymentMethod, description: x.description,
          ...(body.paymentMethodNote ? { paymentMethodNote: body.paymentMethodNote } : {}), ...(body.paymentReference ? { paymentReference: body.paymentReference } : {}) };
        validInput(input);
        const e = newExpense(input); e.scheduledPaymentId = x.id; event(e.id, "CREATED", null, view(e, true));
        Object.assign(x, { status: "PAID", paidExpenseId: e.id, paidAt: now() }); x.version++;
        return { payment: scheduledView(x), expense: view(e, true) };
      }
      if (kind === "cancel") { strict(body, ["expectedVersion", "reason"]); Object.assign(x, { status: "CANCELLED", cancelledAt: now(), cancelReason: body.reason ?? null }); x.version++; return { payment: scheduledView(x) }; }
      const input = { ...body }; delete input.operationId; delete input.requestId; delete input.expectedVersion;
      validSchedule(input, ["dueDate", "plannedAmount", "description", "categoryId", "paymentMethod", "paymentMethodNote", "supplierName"]);
      if (input.dueDate !== undefined && (!/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate) || input.dueDate > addDays(today, 366))) throw invalid();
      Object.assign(x, input, x.templateId ? { customized: true } : {}); x.version++; return { payment: scheduledView(x) };
    });
  }
  if ((m = p.match(/^\/api\/expenses\/recurring\/([^/]+)(?:\/(pause|resume|end))?$/))) {
    const t = templates.find(y => y.id === m[1]); if (!t) throw new Fail(404, "RECURRING_EXPENSE_NOT_FOUND");
    const kind = m[2] ?? "updateRecurring";
    return receipt(body, kind, t.id, () => {
      versioned(t, body.expectedVersion);
      if (kind === "updateRecurring") {
        const input = { ...body }; delete input.operationId; delete input.requestId; delete input.expectedVersion;
        validSchedule(input, ["description", "categoryId", "paymentMethod", "paymentMethodNote", "supplierName", "estimatedAmount", "frequency", "interval", "anchorDate", "endDate"]);
        if (t.status === "ENDED") throw new Fail(409, "INVALID_RECURRING_TRANSITION");
        const rule = ["frequency", "interval", "anchorDate", "endDate"].some(k => input[k] !== undefined && input[k] !== t[k]);
        Object.assign(t, input); t.version++;
        let cancelled = 0, updatedPayments = 0, generated = 0;
        if (rule) { cancelled = cancelFuture(t, "Gasto fijo modificado"); t.generatedThrough = today; generated = generate(t); }
        else for (const x of payments) if (x.templateId === t.id && x.status === "PENDING" && x.dueDate >= today && !x.customized) {
          if (input.estimatedAmount !== undefined) x.plannedAmount = input.estimatedAmount; if (input.description) x.description = input.description; if (input.categoryId) x.categoryId = input.categoryId; x.version++; updatedPayments++;
        }
        return { template: templateView(t), updatedPayments, cancelled, generated };
      }
      strict(body, ["expectedVersion"]);
      const allowed = kind === "pause" ? t.status === "ACTIVE" : kind === "resume" ? t.status === "PAUSED" : t.status !== "ENDED";
      if (!allowed) throw new Fail(409, "INVALID_RECURRING_TRANSITION");
      let cancelled = 0, generated = 0;
      if (kind === "resume") { t.status = "ACTIVE"; t.generatedThrough = addDays(today, -1); generated = generate(t); }
      else { t.status = kind === "pause" ? "PAUSED" : "ENDED"; if (kind === "end") t.endedAt = now(); cancelled = cancelFuture(t, kind === "pause" ? "Gasto fijo en pausa" : "Gasto fijo terminado"); }
      t.version++; return { template: templateView(t), cancelled, generated };
    });
  }
  return undefined;
}
const picked = e => ({ categoryId: e.categoryId, categoryName: category(e.categoryId).name, description: e.description, paymentMethodNote: e.paymentMethodNote });
class Fail extends Error { constructor(status, code, details) { super(code); this.status = status; this.code = code; this.details = details; } }
const invalid = () => new Fail(400, "INVALID_EXPENSE_INPUT");

function strict(body, allowed) { for (const key of Object.keys(body)) if (!["operationId", "requestId", ...allowed].includes(key)) throw invalid(); }
function validInput(input) {
  strict(input, ["expenseDate", "amount", "categoryId", "paymentMethod", "paymentMethodNote", "paymentReference", "description", "supplierName"]);
  if (typeof input.amount !== "string" || !/^[1-9][0-9]{0,12}$/.test(input.amount) || BigInt(input.amount) > 1000000000000n) throw invalid();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.expenseDate ?? "") || input.expenseDate > today) throw invalid();
  if (!METHODS.includes(input.paymentMethod) || (input.paymentMethod === "OTHER") !== (typeof input.paymentMethodNote === "string" && input.paymentMethodNote.length >= 3)) throw invalid();
  if (typeof input.description !== "string" || !input.description.trim()) throw invalid();
  const c = category(input.categoryId); if (!c) throw new Fail(404, "EXPENSE_CATEGORY_NOT_FOUND"); if (c.archivedAt) throw new Fail(409, "EXPENSE_CATEGORY_ARCHIVED");
}
function newExpense(input) {
  const e = { id: randomUUID(), status: "CONFIRMED", source: "MANUAL", expenseDate: input.expenseDate, amount: input.amount, currency: "COP", taxMode: "NOT_MANAGED",
    categoryId: input.categoryId, categoryNameSnapshot: category(input.categoryId).name, paymentMethod: input.paymentMethod, paymentMethodNote: input.paymentMethodNote ?? null,
    paymentReference: input.paymentReference ?? null, description: input.description, supplierName: input.supplierName ?? null, replacesExpenseId: null,
    recordedAt: now(), confirmedAt: now(), voidedAt: null, voidReason: null, version: 1 };
  expenses.push(e); return e;
}
const event = (entityId, eventType, before, after) => events.push({ id: randomUUID(), entityId, eventType, before, after, occurredAt: now() });

// Receipt by (owner, operationId); the hash excludes requestId; replay happens before state/version checks.
function receipt(body, kind, resourceId, work) {
  if (!uuid.test(body.operationId ?? "") || !uuid.test(body.requestId ?? "")) throw invalid();
  if (requestIds.has(body.requestId)) throw new Fail(409, "IDEMPOTENCY_CONFLICT");
  const command = { ...body }; delete command.requestId; const hash = JSON.stringify({ kind, resourceId, command });
  const prior = operations.get(body.operationId);
  if (prior) { if (prior.hash !== hash) throw new Fail(409, "IDEMPOTENCY_CONFLICT"); requestIds.add(body.requestId); return { status: 200, body: { ...prior.result, idempotent: true } }; }
  const result = work();
  requestIds.add(body.requestId); operations.set(body.operationId, { hash, result });
  return { status: kind === "createExpense" || kind === "createCategory" ? 201 : 200, body: { ...result, idempotent: false } };
}
function versioned(row, expectedVersion) { if (row.version !== expectedVersion) throw new Fail(409, "VERSION_CONFLICT"); }

function mutate(method, url, body) {
  const p = url.pathname; let m;
  const f1b = scheduledMutation(method, p, body); if (f1b !== undefined) return f1b;
  if (method === "POST" && p === "/api/expense-categories/seed") return receipt(body, "seed", "seed", () => {
    strict(body, []);
    for (const [seedKey, name] of SEEDS) if (!categories.some(c => c.seedKey === seedKey)) categories.push({ id: randomUUID(), name, seedKey, position: categories.length, archivedAt: null, version: 1 });
    return { categories: categories.map(catView), created: SEEDS.length };
  });
  if (method === "POST" && p === "/api/expense-categories") return receipt(body, "createCategory", "new", () => {
    strict(body, ["name"]);
    const existing = categories.find(c => normalized(c.name) === normalized(body.name ?? ""));
    if (existing) throw new Fail(409, "EXPENSE_CATEGORY_NAME_CONFLICT", { existingId: existing.id, archived: Boolean(existing.archivedAt) });
    const c = { id: randomUUID(), name: body.name.trim().replace(/\s+/g, " "), seedKey: null, position: categories.length, archivedAt: null, version: 1 };
    categories.push(c); return { category: catView(c) };
  });
  if ((m = p.match(/^\/api\/expense-categories\/([^/]+)(?:\/(archive|reactivate))?$/))) {
    const c = category(m[1]); if (!c) throw new Fail(404, "EXPENSE_CATEGORY_NOT_FOUND");
    const kind = m[2] ?? "updateCategory";
    return receipt(body, kind, c.id, () => {
      versioned(c, body.expectedVersion);
      if (kind === "updateCategory") {
        strict(body, ["expectedVersion", "name", "position"]);
        if (body.name !== undefined) { if (categories.some(x => x !== c && normalized(x.name) === normalized(body.name))) throw new Fail(409, "EXPENSE_CATEGORY_NAME_CONFLICT"); c.name = body.name; }
        if (body.position !== undefined) c.position = body.position;
      } else { strict(body, ["expectedVersion"]); c.archivedAt = kind === "archive" ? now() : null; }
      c.version++; return { category: catView(c) };
    });
  }
  if (method === "POST" && p === "/api/expenses") return receipt(body, "createExpense", "new", () => {
    const input = { ...body }; delete input.operationId; delete input.requestId; validInput(input);
    const e = newExpense(input); event(e.id, "CREATED", null, view(e, true)); return { expense: view(e, true) };
  });
  if ((m = p.match(/^\/api\/expenses\/([^/]+)(\/void)?$/))) {
    const e = expense(m[1]); if (!e) throw new Fail(404, "EXPENSE_NOT_FOUND");
    if (!m[2]) return receipt(body, "reclassify", e.id, () => {
      strict(body, ["expectedVersion", "categoryId", "description", "paymentMethodNote"]);
      if (e.status !== "CONFIRMED") throw new Fail(409, "INVALID_EXPENSE_TRANSITION"); versioned(e, body.expectedVersion);
      if (body.amount !== undefined) throw invalid();
      if (body.paymentMethodNote !== undefined && e.paymentMethod !== "OTHER") throw invalid();
      if (body.categoryId !== undefined) { const c = category(body.categoryId); if (!c) throw new Fail(404, "EXPENSE_CATEGORY_NOT_FOUND"); if (c.archivedAt) throw new Fail(409, "EXPENSE_CATEGORY_ARCHIVED"); }
      const before = picked(e);
      Object.assign(e, { ...(body.categoryId ? { categoryId: body.categoryId, categoryNameSnapshot: category(body.categoryId).name } : {}), ...(body.description ? { description: body.description } : {}),
        ...(body.paymentMethodNote ? { paymentMethodNote: body.paymentMethodNote } : {}) });
      e.version++; event(e.id, "RECLASSIFIED", before, picked(e)); return { expense: view(e, true) };
    });
    return receipt(body, "void", e.id, () => {
      strict(body, ["expectedVersion", "reason", "replacement"]);
      if (e.status !== "CONFIRMED") throw new Fail(409, "INVALID_EXPENSE_TRANSITION"); versioned(e, body.expectedVersion);
      if (typeof body.reason !== "string" || body.reason.trim().length < 3) throw invalid();
      if (body.replacement) validInput(body.replacement);
      Object.assign(e, { status: "VOIDED", voidedAt: now(), voidReason: body.reason }); e.version++;
      event(e.id, "VOIDED", null, { voidReason: body.reason });
      let replacement = null;
      if (body.replacement) { replacement = newExpense(body.replacement); replacement.replacesExpenseId = e.id; event(replacement.id, "CREATED", null, view(replacement, true)); event(e.id, "REPLACED", null, { replacementId: replacement.id }); }
      // F1b decision 1: without a replacement the scheduled payment goes back to PENDING; with one it stays PAID and points to it.
      const linked = payments.find(x => x.paidExpenseId === e.id);
      if (linked) { if (replacement) { replacement.scheduledPaymentId = linked.id; linked.paidExpenseId = replacement.id; } else Object.assign(linked, { status: "PENDING", paidExpenseId: null, paidAt: null }); linked.version++; }
      return { voided: view(e, true), replacement: replacement ? view(replacement, true) : null };
    });
  }
  return null;
}

function filtered(q, status) {
  return expenses.filter(e => e.expenseDate >= q.get("from") && e.expenseDate <= q.get("to") && (!q.get("categoryId") || e.categoryId === q.get("categoryId"))
    && (!q.get("paymentMethod") || e.paymentMethod === q.get("paymentMethod")) && (status === "all" || e.status === status));
}
function read(url) {
  const p = url.pathname, q = url.searchParams;
  if (p === "/api/me") return { user: { emailVerifiedAt: now(), hasLocalPassword: true } };
  if (p === "/api/expense-categories") {
    const status = q.get("status") ?? "active";
    return { success: true, result: { categories: categories.filter(c => status === "all" || (status === "archived") === Boolean(c.archivedAt)).map(catView) } };
  }
  if (p === "/api/expenses") {
    for (const key of q.keys()) if (!["from", "to", "categoryId", "paymentMethod", "status", "cursor", "origin"].includes(key)) throw invalid();
    if ((q.get("to") ?? "") > today) throw invalid(); // expense dates are never future
    if (q.has("origin") && q.get("origin") !== "fixed") throw invalid();
    const rows = filtered(q, q.get("status") ?? "CONFIRMED").filter(e => !q.has("origin") || Boolean(payments.find(x => x.id === e.scheduledPaymentId)?.templateId)).sort((a, b) => b.expenseDate.localeCompare(a.expenseDate) || b.recordedAt.localeCompare(a.recordedAt) || b.id.localeCompare(a.id));
    const start = q.get("cursor") ? Number(Buffer.from(q.get("cursor"), "base64url").toString()) : 0, page = rows.slice(start, start + PAGE);
    return { success: true, result: { items: page.map(e => view(e)), nextCursor: start + PAGE < rows.length ? Buffer.from(String(start + PAGE)).toString("base64url") : null, pageSize: PAGE } };
  }
  if (p === "/api/expenses/summary") {
    if (q.has("status")) throw invalid(); // The summary schema is strict.
    const confirmed = filtered(q, "CONFIRMED"), group = key => [...new Set(confirmed.map(e => e[key]))].map(k => {
      const rows = confirmed.filter(e => e[key] === k); return { [key]: k, total: rows.reduce((s, e) => s + BigInt(e.amount), 0n).toString(), count: rows.length };
    });
    return { success: true, result: { confirmedTotal: confirmed.reduce((s, e) => s + BigInt(e.amount), 0n).toString(), confirmedCount: confirmed.length, voidedCount: filtered(q, "VOIDED").length,
      pendingCount: 0, pendingSuggestedTotal: "0", byCategory: group("categoryId").map(r => ({ ...r, name: category(r.categoryId).name, archived: Boolean(category(r.categoryId).archivedAt) })),
      byPaymentMethod: group("paymentMethod") } };
  }
  if (p === "/api/expenses/overview") {
    // Same semantics as GET /api/expenses/overview: CONFIRMED add, VOIDED apart, percent half up with BigInt.
    for (const key of q.keys()) if (key !== "month") throw invalid();
    const month = q.get("month") ?? "";
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month > shiftMonth(today.slice(0, 7), 12)) throw invalid(); // up to 12 months ahead
    const lastDay = m => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).toISOString().slice(0, 10);
    const from = `${month}-01`, to = month === today.slice(0, 7) ? today : lastDay(month);
    const prevMonth = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 2, 1)).toISOString().slice(0, 7);
    const inRange = (e, a, b) => e.expenseDate >= a && e.expenseDate <= b;
    const sum = rows => rows.reduce((t, e) => t + BigInt(e.amount), 0n);
    const confirmed = expenses.filter(e => e.status === "CONFIRMED" && inRange(e, from, to)), total = sum(confirmed);
    const days = [];
    for (let d = new Date(`${from}T00:00:00Z`); d.toISOString().slice(0, 10) <= to; d.setUTCDate(d.getUTCDate() + 1)) {
      const date = d.toISOString().slice(0, 10); days.push({ date, total: sum(confirmed.filter(e => e.expenseDate === date)).toString() });
    }
    const byCategory = [...new Set(confirmed.map(e => e.categoryId))].map(id => {
      const rows = confirmed.filter(e => e.categoryId === id), t = sum(rows);
      return { categoryId: id, name: category(id).name, archived: Boolean(category(id).archivedAt), total: t.toString(), count: rows.length, percent: total === 0n ? "0" : ((t * 200n + total) / (total * 2n)).toString() };
    }).sort((a, b) => BigInt(b.total) > BigInt(a.total) ? 1 : BigInt(b.total) < BigInt(a.total) ? -1 : a.name.localeCompare(b.name, "es"));
    const future = month > today.slice(0, 7), pending = payments.filter(x => x.status === "PENDING");
    const fixed = payments.filter(x => x.templateId && ["PENDING", "PAID"].includes(x.status) && x.dueDate >= from && x.dueDate <= lastDay(month)), paidFixed = fixed.filter(x => x.status === "PAID");
    const figureOf = rows => ({ count: rows.length, plannedTotal: rows.reduce((t, x) => t + BigInt(x.plannedAmount ?? 0), 0n).toString(), withoutAmount: rows.filter(x => !x.plannedAmount).length });
    const scheduled = { fixed: { due: fixed.length, paid: paidFixed.length, paidTotal: sum(paidFixed.map(x => expense(x.paidExpenseId))).toString() },
      upcoming: figureOf(pending.filter(x => x.dueDate >= today && x.dueDate <= addDays(today, 7))), overdue: figureOf(pending.filter(x => x.dueDate < today)), planned: null, projected: [] };
    if (future) {
      // Projection (never stored): dates of ACTIVE fixed expenses after generatedThrough inside the month, minus existing ones.
      const end = lastDay(month), projected = [];
      for (const t of templates.filter(x => x.status === "ACTIVE")) for (let k = 0; k < 2000; k++) {
        const date = nth(t, k); if (date > end || (t.endDate && date > t.endDate)) break;
        if (date < from || date <= (t.generatedThrough ?? addDays(today, -1))) continue;
        if (payments.some(x => x.templateId === t.id && x.occurrenceDate === date && x.status !== "CANCELLED")) continue;
        projected.push({ templateId: t.id, dueDate: date, description: t.description, plannedAmount: t.estimatedAmount, categoryId: t.categoryId, categoryName: category(t.categoryId).name,
          paymentMethod: t.paymentMethod, frequency: t.frequency, interval: t.interval });
      }
      projected.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
      const generated = pending.filter(x => x.dueDate >= from && x.dueDate <= end), withAmount = figureOf([...generated, ...projected]);
      scheduled.planned = { count: withAmount.count, plannedTotal: withAmount.plannedTotal, withoutAmount: withAmount.withoutAmount, projectedCount: projected.length };
      scheduled.projected = projected;
    }
    const variable = confirmed.filter(e => !e.scheduledPaymentId);
    return { success: true, result: { month, from, to, generatedAt: now(), future, total: total.toString(), count: confirmed.length, scheduled, variable: { total: sum(variable).toString(), count: variable.length },
      voidedCount: expenses.filter(e => e.status === "VOIDED" && inRange(e, from, to)).length,
      previousMonth: { month: prevMonth, total: sum(expenses.filter(e => e.status === "CONFIRMED" && inRange(e, `${prevMonth}-01`, lastDay(prevMonth)))).toString() }, days, byCategory } };
  }
  if (p === "/api/expenses/scheduled") {
    for (const key of q.keys()) if (!["status", "kind", "from", "to"].includes(key)) throw invalid();
    const status = q.get("status") ?? "PENDING", kind = q.get("kind") ?? "all";
    const items = payments.filter(x => (status === "all" || x.status === status) && (kind === "all" || (kind === "fixed") === Boolean(x.templateId))
      && (!q.get("from") || x.dueDate >= q.get("from")) && (!q.get("to") || x.dueDate <= q.get("to"))).sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.id.localeCompare(b.id));
    return { success: true, result: { items: items.map(scheduledView), truncated: false, today } };
  }
  if (p === "/api/expenses/recurring") {
    const status = q.get("status") ?? "current";
    return { success: true, result: { templates: templates.filter(t => status === "all" || (status === "current" ? t.status !== "ENDED" : t.status === status)).map(templateView) } };
  }
  const one = p.match(/^\/api\/expenses\/([^/]+)$/);
  if (one) {
    const e = expense(one[1]);
    if (!e || detail404) { detail404 = false; throw new Fail(404, "EXPENSE_NOT_FOUND"); }
    return { success: true, result: { expense: view(e, true), events: events.filter(x => x.entityId === e.id).map(x => ({ id: x.id, eventType: x.eventType, before: x.before, after: x.after, occurredAt: x.occurredAt })) } };
  }
  return null;
}

async function api(req, res) {
  const url = new URL(req.url, "https://127.0.0.1:4339");
  const reply = (body, status = 200) => { res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "private, no-store" }); res.end(JSON.stringify(body)); };
  let raw = ""; for await (const chunk of req) raw += chunk;
  try {
    if (req.method === "GET") {
      if (slow?.(url)) { slow = null; await new Promise(resolve => setTimeout(resolve, 1500)); }
      log.push(`GET ${url.pathname}`);
      const result = read(url); if (!result) { unknown.push(`GET ${url.pathname}`); return reply({}, 404); }
      return reply(result);
    }
    const body = raw ? JSON.parse(raw) : {};
    mutations.push({ method: req.method, path: url.pathname, body }); log.push(`${req.method} ${url.pathname}`);
    const result = mutate(req.method, url, body);
    if (!result) { unknown.push(`${req.method} ${url.pathname}`); return reply({}, 404); }
    if (dropNextAfterCommit) { dropNextAfterCommit = false; req.socket.destroy(); return; } // committed, reply lost
    return reply({ success: true, result: result.body }, result.status);
  } catch (error) {
    if (error instanceof Fail) return reply({ success: false, error: error.code, message: error.code, ...(error.details ? { details: error.details } : {}) }, error.status);
    throw error;
  }
}

try {
  await privatePanelFixture(api, async ({ command, evaluate, poll, fill }) => {
    const text = () => evaluate("document.body.innerText");
    const norm = value => value.replace(/\s+/g, " ");
    const waitText = async value => { try { await poll(async () => norm(await text()).includes(value)); } catch { throw new Error(`Texto no encontrado: ${value}\n--- pantalla ---\n${(await text()).slice(0, 2500)}`); } };
    // Visible button with that exact text (the header and the mobile button share «Registrar gasto»).
    const button = label => `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)}&&b.getClientRects().length)`;
    const click = async label => { try { await poll(() => evaluate(`(()=>{const b=${button(label)};return Boolean(b&&!b.disabled)})()`)); } catch { throw new Error(`Botón no disponible: ${label}\n${(await text()).slice(0, 2500)}`); } await evaluate(`${button(label)}.click()`); };
    const doubleClick = async label => { await poll(() => evaluate(`(()=>{const b=${button(label)};return Boolean(b&&!b.disabled)})()`)); await evaluate(`(()=>{const b=${button(label)};b.click();b.click()})()`); };
    const exists = label => evaluate(`Boolean(${button(label)})`);
    const choose = (selector, label) => evaluate(`(()=>{const s=document.querySelector(${JSON.stringify(selector)});const o=[...s.options].find(o=>o.textContent.trim()===${JSON.stringify(label)});if(!o)return false;s.value=o.value;s.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
    const options = selector => evaluate(`[...document.querySelectorAll(${JSON.stringify(selector + " option")})].map(o=>o.textContent.trim())`);
    const setSelect = (selector, value) => evaluate(`(()=>{const s=document.querySelector(${JSON.stringify(selector)});s.value=${JSON.stringify(value)};s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
    const key = async (name, code, vk) => { for (const type of ["keyDown", "keyUp"]) await command("Input.dispatchKeyEvent", { type, key: name, code, windowsVirtualKeyCode: vk }); };
    const list = () => evaluate(`document.querySelector('ul[aria-label="Gastos"]')?.innerText ?? ""`);
    const rows = () => evaluate(`document.querySelectorAll('ul[aria-label="Gastos"] button').length`);
    const total = () => evaluate(`document.querySelector('[data-expense-total]')?.textContent.replace(/\\s/g," ") ?? null`);
    const waitTotal = async value => { try { await poll(async () => (await total()) === value); } catch { throw new Error(`Total esperado ${value}, en pantalla ${await total()}`); } };
    const share = () => evaluate(`document.querySelector('section[aria-labelledby="expense-categories-share"]')?.innerText.replace(/\\s+/g," ") ?? ""`);
    const count = (p, method = "POST") => mutations.filter(m => m.method === method && m.path === p).length;
    const synced = e => poll(() => evaluate(`document.querySelector('[data-expense-id="${e.id}"]')?.dataset.expenseVersion === "${e.version}"`));
    const dialogs = () => evaluate(`document.querySelectorAll('[role="dialog"],[role="alertdialog"]').length`);
    const closeDialogs = async () => { for (let i = 0; i < 4 && await dialogs(); i++) { await key("Escape", "Escape", 27); await poll(async () => true); await new Promise(r => setTimeout(r, 150)); } assert.equal(await dialogs(), 0, "dialogs closed"); };
    // Opens a row; prefers the non-voided row when a voided one has the same description.
    const open = async description => {
      await closeDialogs();
      await poll(async () => (await list()).includes(description));
      await evaluate(`(()=>{const all=[...document.querySelectorAll('ul[aria-label="Gastos"] button')].filter(b=>b.innerText.includes(${JSON.stringify(description)}));(all.find(b=>!b.getAttribute('aria-label').includes('anulado'))??all[0]).click()})()`);
    };
    const openRegister = async () => { await closeDialogs(); await click("Registrar gasto"); await poll(() => evaluate(`Boolean(document.querySelector('#new-expense-amount'))`)); };
    const registerOptions = async () => { await openRegister(); const values = await options("#new-expense-category"); await closeDialogs(); return values; };
    const byDescription = d => expenses.find(e => e.description === d && e.status === "CONFIRMED") ?? expenses.find(e => e.description === d);
    async function register({ amount, category: name, method = "CASH", note, description, reference }, submit = click) {
      await openRegister();
      await fill("#new-expense-amount", amount);
      assert.equal(await choose("#new-expense-category", name), true, `category ${name}`);
      await setSelect("#new-expense-method", method);
      if (note) { await poll(() => evaluate(`Boolean(document.querySelector('#new-expense-note'))`)); await fill("#new-expense-note", note); }
      await fill("#new-expense-description", description);
      if (reference) await fill("#new-expense-reference", reference);
      await submit("Guardar gasto");
    }
    // Old palette (brand emerald family and its greige neutrals): none of it may remain on Gastos or its dialogs.
    const OLD = ["#0F6B57", "#0B5646", "#E8F3EF", "#0B2E27", "#EDF3EC", "#D6DFD7", "#E2E8E0", "#A8C2AF", "#52655A", "#68756E", "#FCFDFB", "#52675B", "#DCE4DC", "#F3F5F2", "#CFD6CF", "#3F4A43",
      "#B8DCC6", "#ECF7F0", "#1F5B37", "#5A886C", "#2F7A52", "#F2FAF4", "#9FC4AE", "#C3E5D4", "#B8DEC8", "#37443D", "#87928B", "#D9E2D9"]
      .map(h => `rgb(${parseInt(h.slice(1, 3), 16)},${parseInt(h.slice(3, 5), 16)},${parseInt(h.slice(5, 7), 16)})`);
    const noOldGreen = async label => {
      const found = await evaluate(`(()=>{const old=${JSON.stringify(OLD)};const out=[];for(const root of document.querySelectorAll('main,[role="dialog"],[role="alertdialog"]'))for(const e of [root,...root.querySelectorAll('*')]){const cs=getComputedStyle(e);for(const p of ['color','backgroundColor','borderTopColor','borderRightColor','borderBottomColor','borderLeftColor','outlineColor']){const v=cs[p].replaceAll(' ','');if(old.includes(v))out.push((e.id||e.tagName)+' '+p+' '+v)}}return out.slice(0,8)})()`);
      assert.deepEqual(found, [], `old green on ${label}`);
    };
    const styleOf = (label, prop) => evaluate(`(()=>{const b=${button(label)};return b?getComputedStyle(b)[${JSON.stringify(prop)}].replaceAll(' ',''):null})()`);
    const viewport = async width => { await command("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 }); await new Promise(r => setTimeout(r, 300)); };
    // Optional review screenshots: EXPENSES_SCREENSHOTS=<folder outside the repo>.
    const shot = async name => {
      const folder = process.env.EXPENSES_SCREENSHOTS; if (!folder) return;
      const { data } = await command("Page.captureScreenshot", { format: "png" });
      fs.writeFileSync(path.join(folder, `${name}.png`), Buffer.from(data, "base64"));
    };

    // Opening Gastos: menu entry current, header of the design, only the idempotent seed and the explicit sync are written
    // (sync before any read: correction A), F1b blocks present, F1c blocks absent.
    await viewport(1440);
    await command("Page.navigate", { url: "http://localhost:4338/dashboard/gastos" });
    await waitText("No hay gastos registrados este mes."); await waitTotal("$ 0"); await waitText("No hay gastos fijos ni pagos programados en este mes.");
    const gastosEnabled = /id: "gastos"[^\n]*enabled: true/.test(fs.readFileSync(new URL("../lib/panel-navigation.ts", import.meta.url), "utf8"));
    const gastosLink = `document.querySelector('aside nav[aria-label="Principal"] a[href="/dashboard/gastos"]')`;
    if (gastosEnabled) assert.equal(await evaluate(`${gastosLink}?.getAttribute('aria-current')`), "page");
    else assert.equal(await evaluate(`Boolean(${gastosLink})`), false, "a disabled module is not offered in the menu");
    const page = norm(await text());
    for (const part of ["Gastos", "Lo que cuesta mantener tu negocio", monthLabel(today.slice(0, 7)), "Gastos del mes", "0 registros · sin anulados", "Fijos pagados", "0 de 0", "Sin gastos fijos este mes",
      "Variables", "Próximos pagos", "Nada vence en los próximos 7 días", "¿En qué se va la plata?", `Gastos de ${monthName(today.slice(0, 7))}`, "Gastos fijos", "Administrar",
      "No hay gastos fijos ni pagos programados en este mes.", "Programar pago", "Tu negocio está seguro con Vitrinaya", "Conectado", "Última actualización"]) assert.ok(page.includes(part), part);
    for (const absent of ["Con soporte", "Exportar", "Marcar pagado", "Vencidos"]) assert.ok(!page.includes(absent), `${absent} must not appear (F1c, or nothing to pay)`);
    assert.deepEqual(await evaluate(`[...document.querySelectorAll('[aria-label="Filtrar gastos"] button')].map(b=>b.textContent.trim())`), ["Todos", "Fijos", "Anulados"]);
    assert.equal(await evaluate(`document.querySelector('#expense-search').placeholder`), "Buscar gasto, categoría o nota");
    assert.equal(await evaluate(`[...document.querySelectorAll('[aria-label="Mes"] button')].find(b=>b.getAttribute('aria-label')==='Mes siguiente').disabled`), false, "future months can be shown");
    assert.deepEqual(mutations.map(m => m.path).sort(), ["/api/expense-categories/seed", "/api/expenses/scheduled/sync"], "opening the page only seeds categories and syncs");
    const seedBody = mutations.find(m => m.path === "/api/expense-categories/seed").body;
    assert.ok(uuid.test(seedBody.operationId) && uuid.test(seedBody.requestId));
    const firstRead = path => log.findIndex(entry => entry === `GET ${path}`);
    assert.ok(log.indexOf("POST /api/expenses/scheduled/sync") >= 0 && ["/api/expenses/overview", "/api/expenses", "/api/expenses/scheduled"].every(p => firstRead(p) > log.indexOf("POST /api/expenses/scheduled/sync")),
      `sync before every read: ${JSON.stringify(log.slice(0, 8))}`);
    assert.equal(categories.length, 11);
    await openRegister();
    assert.ok((await options("#new-expense-category")).includes("Nómina y honorarios"));
    const dialogText = norm(await evaluate(`document.querySelector('[role="dialog"]').innerText`));
    for (const notice of ["Las compras de mercancía se registran como entrada de inventario", "IVA y retenciones no se gestionan", "No escribas números de documento"]) assert.ok(dialogText.includes(notice), notice);
    // Amount: thousands separators while typing, caret kept when editing in the middle, paste with or without dots.
    const amount = () => evaluate(`(()=>{const i=document.querySelector('#new-expense-amount');return {value:i.value,caret:i.selectionStart}})()`);
    await evaluate(`document.querySelector('#new-expense-amount').focus()`);
    for (const ch of "1250000") await command("Input.insertText", { text: ch });
    assert.deepEqual(await amount(), { value: "1.250.000", caret: 9 });
    await evaluate(`document.querySelector('#new-expense-amount').setSelectionRange(3,3)`);
    await command("Input.dispatchKeyEvent", { type: "keyDown", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 });
    await command("Input.dispatchKeyEvent", { type: "keyUp", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 });
    assert.deepEqual(await amount(), { value: "150.000", caret: 1 }, "backspace in the middle keeps the caret there");
    await command("Input.insertText", { text: "9" });
    assert.deepEqual(await amount(), { value: "1.950.000", caret: 3 }, "typing in the middle keeps the caret after the new digit");
    await fill("#new-expense-amount", "12.345"); assert.equal((await amount()).value, "12.345", "paste with dots");
    await fill("#new-expense-amount", "12345"); assert.equal((await amount()).value, "12.345", "paste without dots");
    await fill("#new-expense-amount", "1000000000000"); assert.equal((await amount()).value, "1.000.000.000.000");
    assert.equal(await evaluate(`document.querySelector('label[for="new-expense-amount"]').textContent.includes('Monto en pesos')`), true, "accessible name kept");
    await fill("#new-expense-amount", "");
    // New style: blue primary, blue focus ring, no old green anywhere.
    assert.equal(await styleOf("Guardar gasto", "backgroundColor"), "rgb(4,80,229)");
    await evaluate(`${button("Guardar gasto")}.focus()`);
    await command("Input.dispatchKeyEvent", { type: "keyDown", key: "Shift", code: "ShiftLeft", windowsVirtualKeyCode: 16 });
    await command("Input.dispatchKeyEvent", { type: "keyUp", key: "Shift", code: "ShiftLeft", windowsVirtualKeyCode: 16 });
    // Positive control: the scan must detect an old-green element before its absence means anything.
    await evaluate(`(()=>{const p=document.createElement('p');p.id='old-green-control';p.style.color='#0F6B57';document.querySelector('main').append(p)})()`);
    await assert.rejects(noOldGreen("the control"), /old green on the control/);
    await evaluate(`document.querySelector('#old-green-control').remove()`);
    await noOldGreen("the register dialog");
    await shot("gastos-registrar-1440");
    checks.push("Gastos page: menu entry current, header (icon, title, subtitle, month, Programar pago, Registrar gasto), seed and sync as the only writes with sync before every read, 11 categories, notices in the register form, cards Fijos pagados / Variables / Próximos pagos and the «Gastos fijos» card; no Con soporte/Exportar (F1c)");

    // Client validation blocks the request.
    await fill("#new-expense-amount", "1,5"); await click("Guardar gasto"); await waitText("Escribe un monto entre");
    assert.ok(norm(await text()).includes("Elige una categoría.") && norm(await text()).includes("Escribe una descripción"));
    assert.equal(count("/api/expenses"), 0);
    checks.push("Client validation of amount, category and description with no request");

    // Register (double click → one POST); "150.000" is sent as "150000"; the reference stays out of the list; the detail opens.
    await register({ amount: "150.000", category: "Arriendo", description: "Arriendo local noviembre", reference: "TX-991" }, doubleClick);
    await waitText("Gasto registrado.");
    assert.equal(count("/api/expenses"), 1, "double click registers once");
    const first = mutations.find(m => m.path === "/api/expenses").body;
    assert.equal(first.amount, "150000"); assert.equal(first.expenseDate, today); assert.equal(first.paymentReference, "TX-991");
    const rent = byDescription("Arriendo local noviembre"); await synced(rent);
    await waitText("TX-991"); await waitTotal("$ 150.000");
    assert.ok(!(await list()).includes("TX-991"), "the payment reference is only shown in the detail");
    assert.equal(await evaluate(`document.activeElement?.id`), `expense-${rent.id}`, "the new expense opens with focus on its heading");
    checks.push("Register with double click once, thousands separators, today in Bogotá, reference only in the detail, detail opens with focus on its heading");

    // Possible duplicate (same date and amount): warning first, second click registers. OTHER requires a note.
    await register({ amount: "150000", category: "Transporte y domicilios", method: "OTHER", note: "Bancolombia a la mano", description: "Mensajería clientes" });
    await waitText("Ya hay un gasto confirmado de este monto en esa fecha");
    assert.equal(count("/api/expenses"), 1, "the warning does not send");
    await click("Guardar gasto"); await waitText("Gasto registrado.");
    assert.equal(count("/api/expenses"), 2); await waitTotal("$ 300.000");
    checks.push("Possible duplicate warning that never blocks; OTHER with mandatory note");

    // Reply lost after commit: Reintentar reuses the operationId with a new requestId; one expense; the form keeps its data until success.
    dropNextAfterCommit = true;
    await register({ amount: "80000", category: "Publicidad y redes", method: "NEQUI", description: "Pauta Instagram" });
    await waitText("El servidor no pudo completar la acción");
    assert.equal(expenses.length, 3, "the server committed before the reply was lost");
    assert.equal(await evaluate(`document.querySelector('#new-expense-amount').value`), "80.000", "the form keeps the data while the reply is unknown");
    await click("Reintentar"); await waitText("Gasto registrado.");
    const sends = mutations.filter(m => m.path === "/api/expenses").slice(-2);
    assert.equal(sends[0].body.operationId, sends[1].body.operationId, "retry keeps the operationId");
    assert.notEqual(sends[0].body.requestId, sends[1].body.requestId, "retry sends a new requestId");
    assert.equal(expenses.length, 3, "the retry did not duplicate the expense");
    await waitTotal("$ 380.000");
    checks.push("Lost reply after commit: Reintentar with the same operationId and a new requestId, one expense, form kept until success");

    // Figures, grouping by day, payment pills, categories with server percent, search.
    await closeDialogs();
    await poll(async () => norm(await evaluate(`document.querySelector('[data-expense-count]').parentElement.innerText`)).includes("3 registros · sin anulados"));
    await poll(async () => (await share()).includes("Arriendo $ 150.000 · 39%"));
    for (const part of ["Transporte y domicilios $ 150.000 · 39%", "Publicidad y redes $ 80.000 · 21%"]) assert.ok((await share()).includes(part), part);
    const listed = norm(await list());
    assert.ok(listed.startsWith("HOY · "), "grouped by day, today first");
    for (const part of ["Efectivo", "Otro · Bancolombia a la mano", "Nequi"]) assert.ok(listed.includes(part), part);
    await fill("#expense-search", "bancolombia"); await poll(async () => (await rows()) === 1 && (await list()).includes("Mensajería clientes"));
    await fill("#expense-search", "publicidad"); await poll(async () => (await rows()) === 1 && (await list()).includes("Pauta Instagram"));
    await fill("#expense-search", "energía"); await waitText("Ningún gasto coincide con «energía».");
    await fill("#expense-search", " "); await poll(async () => (await rows()) === 3);
    await shot("gastos-1440");
    checks.push("Figures (total, records, voided), list grouped by day with payment pills, categories with server percent, search by description, category or note (accent-insensitive)");

    // Month navigation and late reply: the slow previous-month overview must not overwrite the current month.
    newExpense({ expenseDate: previous.from, amount: "99000", categoryId: categories.find(c => c.seedKey === "utilities").id, paymentMethod: "BANK_TRANSFER", description: "Luz mes anterior" });
    slow = url => url.pathname === "/api/expenses/overview" && url.searchParams.get("month") === previous.from.slice(0, 7);
    await evaluate(`document.querySelector('[aria-label="Mes anterior"]').click()`); await evaluate(`document.querySelector('[aria-label="Mes siguiente"]').click()`);
    await new Promise(resolve => setTimeout(resolve, 2000));
    assert.equal(slow, null, "the slow reply was requested");
    assert.equal(await total(), "$ 380.000"); assert.ok(!(await list()).includes("Luz mes anterior"), "a late reply for another month is ignored");
    await evaluate(`document.querySelector('[aria-label="Mes anterior"]').click()`);
    await waitTotal("$ 99.000"); await poll(async () => (await list()).includes("Luz mes anterior"));
    await waitText(monthLabel(previous.from.slice(0, 7))); await waitText(`Gastos de ${monthName(previous.from.slice(0, 7))}`);
    await evaluate(`document.querySelector('[aria-label="Mes siguiente"]').click()`); await waitTotal("$ 380.000");
    await waitText(`vs ${monthName(previous.from.slice(0, 7))}`);
    checks.push(`Month selector (‹ ${monthLabel(previous.from.slice(0, 7))} ›), comparison vs the previous month and a late reply ignored`);

    // Reclassify: category, description and the OTHER note; history shows before → after.
    const courier = byDescription("Mensajería clientes");
    await open("Mensajería clientes"); await synced(courier);
    await noOldGreen("the detail dialog");
    assert.equal(await styleOf("Anular gasto", "backgroundColor"), "rgb(180,35,24)", "destructive in the status red");
    assert.equal(await styleOf("Reclasificar", "borderTopColor"), "rgb(169,181,204)", "secondary with a blue-grey border");
    await click("Reclasificar");
    await noOldGreen("the reclassify dialog");
    assert.equal(await styleOf("Guardar reclasificación", "backgroundColor"), "rgb(4,80,229)");
    // Keyboard focus ring on a dialog button is blue.
    await evaluate(`document.querySelector('[role="alertdialog"] textarea').focus()`);
    await key("Tab", "Tab", 9);
    assert.equal(await evaluate(`getComputedStyle(document.activeElement).outlineColor.replaceAll(' ','')`), "rgb(4,80,229)", "blue focus ring");
    assert.equal(await choose('[role="alertdialog"] select', "Publicidad y redes"), true);
    await fill('[role="alertdialog"] textarea', "Mensajería de pedidos");
    await fill('[role="alertdialog"] input', "Bancolombia app");
    await click("Guardar reclasificación"); await waitText("Gasto reclasificado."); await synced(courier);
    const patch = mutations.filter(m => m.method === "PATCH" && m.path === `/api/expenses/${courier.id}`).at(-1).body;
    assert.deepEqual(Object.keys(patch).sort(), ["categoryId", "description", "expectedVersion", "operationId", "paymentMethodNote", "requestId"]);
    await waitText("Nota del medio de pago: «Bancolombia a la mano» → «Bancolombia app»");
    await waitText("Categoría: «Transporte y domicilios» → «Publicidad y redes»");
    await waitText("Descripción: «Mensajería clientes» → «Mensajería de pedidos»");
    assert.ok(norm(await text()).includes("Otro · Bancolombia app"));
    await waitTotal("$ 380.000");
    checks.push("Reclassify category, description and OTHER note in one PATCH; RECLASSIFIED history with before → after");

    // 409 VERSION_CONFLICT on reclassify → reload the expense.
    courier.version++;
    await click("Reclasificar"); await fill('[role="alertdialog"] textarea', "Mensajería urgente");
    await click("Guardar reclasificación"); await waitText("El dato cambió");
    await click("Recargar gasto"); await synced(courier);
    assert.equal(courier.description, "Mensajería de pedidos");
    checks.push("409 VERSION_CONFLICT: Spanish message and reload");

    // Void and replace (amount was wrong): one request, VOIDED + replacement, links both ways, totals updated.
    await open("Arriendo local noviembre"); await synced(rent);
    await click("Anular gasto");
    await fill('[role="alertdialog"] textarea', "Monto equivocado");
    await evaluate(`document.querySelector('[role="alertdialog"] input[type="checkbox"]').click()`);
    await poll(() => evaluate(`Boolean(document.querySelector('#replace-${rent.id}-amount'))`));
    assert.equal(await evaluate(`document.querySelector('#replace-${rent.id}-description').value`), "Arriendo local noviembre", "the replacement starts from the voided data");
    await fill(`#replace-${rent.id}-amount`, "1.500.000");
    await doubleClick("Anular y registrar el correcto"); await waitText("Gasto anulado y reemplazado.");
    assert.equal(count(`/api/expenses/${rent.id}/void`), 1, "double click voids once");
    assert.equal(rent.status, "VOIDED");
    const replacement = expenses.find(e => e.replacesExpenseId === rent.id);
    assert.equal(replacement.amount, "1500000"); assert.equal(replacement.paymentReference, "TX-991");
    await synced(rent); await waitText("Este gasto es de solo lectura."); await waitText("Motivo: Monto equivocado");
    await waitTotal("$ 1.730.000"); await waitText("1 anulado (no suman)");
    await click("Ver el gasto que lo reemplaza"); await synced(replacement);
    await waitText("Ver el gasto anulado que reemplaza");
    checks.push("Void and replace in one request (double click once), replacement prefilled, read-only voided expense, links both ways, totals updated, voided row with pill and reason");

    // Plain void with a mandatory reason.
    const ads = byDescription("Pauta Instagram");
    await open("Pauta Instagram"); await synced(ads);
    await click("Anular gasto");
    assert.equal(await evaluate(`${button("Sí, anular el gasto")}.disabled`), true, "a reason is mandatory");
    await noOldGreen("the void dialog");
    assert.equal(await styleOf("Sí, anular el gasto", "backgroundColor"), "rgb(180,35,24)");
    await fill('[role="alertdialog"] textarea', "Cobro duplicado");
    await doubleClick("Sí, anular el gasto"); await waitText("Gasto anulado. Ya no cuenta en los totales.");
    assert.equal(count(`/api/expenses/${ads.id}/void`), 1); await synced(ads);
    await waitTotal("$ 1.650.000");
    checks.push("Void without replacement: mandatory reason, double click once, leaves the totals");

    // «Anulados» chip and pagination («Más gastos»).
    await closeDialogs();
    await click("Anulados");
    await poll(async () => { const l = await list(); return l.includes("Pauta Instagram") && l.includes("Arriendo local noviembre") && !l.includes("Mensajería"); });
    await waitText(`Gastos anulados de ${monthName(today.slice(0, 7))}`);
    assert.ok(norm(await list()).includes("Anulado · Monto equivocado") && norm(await list()).includes("Anulado · Cobro duplicado"), "voided rows: pill and reason");
    assert.equal(await evaluate(`[...document.querySelectorAll('ul[aria-label="Gastos"] button')].every(b=>getComputedStyle(b.querySelector('span.line-through')).textDecorationLine.includes('line-through'))`), true, "voided rows are struck through");
    await click("Todos");
    await poll(async () => (await rows()) === PAGE);
    await click("Más gastos");
    await poll(async () => (await rows()) === 4);
    assert.equal(await exists("Más gastos"), false);
    checks.push("Chips Todos/Anulados and cursor pagination with «Más gastos»");

    // 409 INVALID_EXPENSE_TRANSITION: voided elsewhere while this screen showed it confirmed.
    await open("Mensajería de pedidos"); await synced(courier);
    Object.assign(courier, { status: "VOIDED", voidedAt: now(), voidReason: "Otra pestaña" }); courier.version++;
    await click("Anular gasto"); await fill('[role="alertdialog"] textarea', "Ya no aplica");
    await click("Sí, anular el gasto"); await waitText("Esa acción ya no está disponible");
    await click("Recargar gasto"); await synced(courier); await waitText("Este gasto es de solo lectura.");
    assert.equal(await exists("Reclasificar"), false); await waitTotal("$ 1.500.000"); // reloading after the conflict also refreshes figures
    checks.push("409 INVALID_EXPENSE_TRANSITION: reload shows the expense read-only and refreshes the figures");

    // 404 on opening an expense, then retry.
    detail404 = true;
    await open("Arriendo local noviembre"); await waitText("Gasto no encontrado");
    await click("Reintentar cargar el gasto"); await synced(replacement);
    checks.push("404 EXPENSE_NOT_FOUND on the detail with retry");

    // Categories (dialog): create, archive (not offered), conflict → reactivate, rename, reorder, archive in use keeps totals.
    await closeDialogs(); await click("Categorías"); await poll(() => evaluate(`Boolean(document.querySelector('#new-category'))`));
    await fill("#new-category", "Domicilios Rappi"); await click("Crear categoría"); await waitText("Categoría creada.");
    await closeDialogs(); await poll(async () => (await registerOptions()).includes("Domicilios Rappi"));
    await click("Categorías"); await poll(() => evaluate(`Boolean(document.querySelector('#new-category'))`));
    await noOldGreen("the categories dialog");
    await click("Archivar Domicilios Rappi");
    await poll(() => evaluate(`Boolean(document.querySelector('[role="alertdialog"]'))`)); await noOldGreen("the archive dialog");
    await click("Sí, archivar"); await waitText("«Domicilios Rappi» archivada.");
    await poll(async () => /Domicilios Rappis*Archivada/.test(await evaluate(`document.querySelector('ul[aria-label="Categorías de gastos"]').innerText`))); // archived categories stay listed
    await closeDialogs(); assert.ok(!(await registerOptions()).includes("Domicilios Rappi"), "an archived category is not offered");
    await click("Categorías"); await poll(() => evaluate(`Boolean(document.querySelector('#new-category'))`));
    await fill("#new-category", "  domicilios   rappi "); await click("Crear categoría");
    await waitText("Ya existe una categoría con ese nombre");
    await click("Reactivar «Domicilios Rappi»"); await waitText("«Domicilios Rappi» reactivada.");
    assert.equal(categories.filter(c => normalized(c.name) === "domicilios rappi").length, 1, "no duplicate category");
    await click("Renombrar Otros gastos");
    await fill('ul[aria-label="Categorías de gastos"] input', "Gastos varios"); await click("Guardar nombre"); await waitText("Categoría renombrada.");
    assert.equal(await evaluate(`(()=>{const b=document.querySelector('button[aria-label="Bajar Arriendo"]');if(!b||b.disabled)return false;b.click();return true})()`), true, "Bajar Arriendo"); await waitText("Orden actualizado.");
    const names = () => evaluate(`[...document.querySelectorAll('ul[aria-label="Categorías de gastos"] > li')].slice(0,2).map(li=>li.querySelector('span').textContent)`);
    await poll(async () => JSON.stringify(await names()) === JSON.stringify(["Servicios públicos", "Arriendo"]));
    await click("Archivar Arriendo"); await click("Sí, archivar"); await waitText("«Arriendo» archivada.");
    await closeDialogs();
    const offered = await registerOptions();
    assert.ok(offered.includes("Domicilios Rappi") && offered.includes("Gastos varios") && !offered.includes("Arriendo"));
    await waitTotal("$ 1.500.000"); await poll(async () => (await share()).includes("Arriendo (archivada) $ 1.500.000 · 100%"));
    checks.push("Categories dialog: create, archive (not offered, still listed), name conflict → reactivate without duplicate, rename, reorder; archiving one in use keeps its total (shown as archived)");

    // ---------------- F1b: scheduled payments and fixed expenses ----------------
    const card = () => evaluate(`document.querySelector('[data-scheduled-card]')?.innerText.replace(/\\s+/g," ") ?? ""`);
    const figureText = name => evaluate(`document.querySelector('[data-figure="${name}"]')?.innerText.replace(/\\s+/g," ") ?? null`);
    const stateOf = description => evaluate(`(()=>{const li=[...document.querySelectorAll('[data-scheduled-id]')].find(l=>l.innerText.includes(${JSON.stringify(description)}));return li?li.dataset.scheduledState:null})()`);
    const rowButton = (description, label) => evaluate(`(()=>{const li=[...document.querySelectorAll('[data-scheduled-id]')].find(l=>l.innerText.includes(${JSON.stringify(description)}));const b=li&&[...li.querySelectorAll('button')].find(b=>(b.getAttribute('aria-label')||'').startsWith(${JSON.stringify(label)}));if(!b)return false;b.click();return true})()`);
    const openSchedule = async () => { await closeDialogs(); await click("Programar pago"); await poll(() => evaluate(`Boolean(document.querySelector('#schedule-amount'))`)); };
    const totalBefore = await total();
    // Date inputs do not take typed text through CDP: set the value with the native setter so React sees the change.
    const setDate = (selector, value) => evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}))})()`);

    // Single payment: planned amount optional, due date today or later, never adds to the totals.
    await openSchedule();
    assert.equal(await evaluate(`document.querySelector('#schedule-due').min`), today, "due date is today or later");
    await noOldGreen("the schedule dialog");
    await click("Guardar pago programado"); await waitText("Elige una categoría.");
    assert.equal(count("/api/expenses/scheduled"), 0, "client validation blocks the request");
    await fill("#schedule-amount", "200000"); assert.equal(await evaluate(`document.querySelector('#schedule-amount').value`), "200.000", "thousands separators while typing");
    await setDate("#schedule-due", addDays(today, 3));
    assert.equal(await choose("#schedule-category", "Publicidad y redes"), true);
    await fill("#schedule-description", "Publicidad en redes");
    await doubleClick("Guardar pago programado"); await waitText("Pago programado. Aparece en «Gastos fijos».");
    assert.equal(count("/api/expenses/scheduled"), 1, "double click schedules once");
    assert.deepEqual(mutations.filter(m => m.path === "/api/expenses/scheduled").at(-1).body.plannedAmount, "200000");
    await poll(async () => (await stateOf("Publicidad en redes")) === "soon"); await poll(async () => (await card()).includes("Vence en 3 días"));
    await poll(async () => ((await figureText("upcoming")) ?? "").includes("$ 200.000") && (await figureText("upcoming")).includes("1 en los próximos 7 días"));
    assert.equal(await total(), totalBefore, "a scheduled payment never adds to the total");
    checks.push("Programar pago (single): optional planned amount with separators, due today or later, validation without request, double click once, «Vence en 3 días», Próximos pagos updated, total unchanged");

    // Fixed expense («Repetir»): monthly from today; the server generates its dates.
    await openSchedule();
    await fill("#schedule-amount", "110.000"); await setDate("#schedule-due", today);
    assert.equal(await choose("#schedule-category", "Internet y telefonía"), true);
    await fill("#schedule-description", "Internet del local");
    await evaluate(`document.querySelector('#schedule-repeat').click()`); await poll(() => evaluate(`Boolean(document.querySelector('#schedule-frequency'))`));
    assert.deepEqual(await options("#schedule-frequency"), ["Semanas", "Meses", "Años"], "no «quincenal»");
    assert.equal((await options("#schedule-interval")).length, 12, "every 1 to 12");
    await waitText("Crea dos gastos fijos mensuales");
    await click("Guardar gasto fijo"); await waitText("Gasto fijo guardado.");
    const recurringBody = mutations.filter(m => m.path === "/api/expenses/recurring").at(-1).body;
    assert.deepEqual([recurringBody.frequency, recurringBody.interval, recurringBody.anchorDate, recurringBody.estimatedAmount], ["MONTHLY", 1, today, "110000"]);
    await poll(async () => (await stateOf("Internet del local")) === "soon"); await poll(async () => (await card()).includes("Vence hoy"));
    await poll(async () => ((await figureText("fixed")) ?? "").includes("0 de 1"));
    assert.equal(await total(), totalBefore);
    checks.push("Programar pago with «Repetir»: Semanas/Meses/Años every 1–12 (no quincenal, fortnight hint), POST /expenses/recurring, generated date shown «Vence hoy», Fijos pagados 0 de 1");

    // Overdue (created elsewhere): red figure and row; it stays overdue until paid, rescheduled or skipped.
    payments.push({ id: randomUUID(), status: "PENDING", templateId: null, occurrenceDate: null, dueDate: addDays(today, -3), plannedAmount: null, description: "Revisión del extintor",
      categoryId: categories.find(c => c.seedKey === "maintenance").id, paymentMethod: "CASH", paymentMethodNote: null, supplierName: null, customized: false, paidExpenseId: null, paidAt: null, cancelledAt: null, cancelReason: null, version: 1 });
    const upcomingNow = await figureText("upcoming");
    await evaluate(`document.querySelector('[aria-label="Mes anterior"]').click()`);
    await poll(async () => (await figureText("fixed")) !== null && (await total()) === "$ 99.000"); // previous month loaded
    await poll(async () => ((await figureText("overdue")) ?? "").includes("Vencidos: 1 pago"));
    assert.equal((await figureText("upcoming")).replace("Desde hoy, sin importar el mes que veas. ", ""), upcomingNow, "Próximos pagos: the next 7 days from today in any month");
    await evaluate(`document.querySelector('[aria-label="Mes siguiente"]').click()`);
    await poll(async () => ((await figureText("overdue")) ?? "").includes("Vencidos: 1 pago"));
    assert.ok((await figureText("overdue")).includes("1 sin monto"));
    await poll(async () => (await stateOf("Revisión del extintor")) === "overdue"); assert.ok((await card()).includes("Vencido hace 3 días"));
    assert.equal(await evaluate(`[...document.querySelectorAll('[data-scheduled-id]')][0].innerText.includes('Revisión del extintor')`), true, "overdue first");
    await click("Ver vencidos"); assert.equal(await evaluate(`document.activeElement?.id`), "scheduled-title", "«Ver vencidos» moves focus to the card");
    await noOldGreen("the Gastos page with F1b blocks");
    checks.push("Vencidos: red banner with count and «sin monto», overdue row first «Vencido hace 3 días», «Ver vencidos» focuses the card; Próximos pagos and Vencidos stay relative to today in a past month");

    // Mark paid with a different amount; reply lost → Reintentar replays the same operation: one expense.
    assert.equal(await rowButton("Internet del local", "Marcar pagado"), true);
    await poll(() => evaluate(`Boolean(document.querySelector('#pay-amount'))`));
    assert.equal(await evaluate(`document.querySelector('#pay-amount').value`), "110.000", "planned amount preloaded");
    assert.equal(await evaluate(`document.querySelector('#pay-date').value`), today, "payment date today by default");
    assert.equal(await evaluate(`document.querySelector('#pay-date').max`), today, "payment date never future");
    await noOldGreen("the pay dialog");
    await fill("#pay-amount", "115000"); assert.equal(await evaluate(`document.querySelector('#pay-amount').value`), "115.000");
    await waitText("El monto previsto era $ 110.000");
    await setSelect("#pay-method", "NEQUI");
    dropNextAfterCommit = true;
    await click("Confirmar pago"); await waitText("El servidor no pudo completar la acción");
    await click("Reintentar"); await waitText("«Internet del local» quedó pagado y se registró como gasto.");
    const pays = mutations.filter(m => /\/pay$/.test(m.path));
    assert.equal(pays.length, 2); assert.equal(pays[0].body.operationId, pays[1].body.operationId, "same operation"); assert.notEqual(pays[0].body.requestId, pays[1].body.requestId);
    assert.deepEqual([pays[0].body.amount, pays[0].body.expenseDate, pays[0].body.paymentMethod], ["115000", today, "NEQUI"]);
    const internetPaid = expenses.filter(e => e.description === "Internet del local");
    assert.equal(internetPaid.length, 1, "paying twice (replay) creates one expense"); assert.ok(internetPaid[0].scheduledPaymentId);
    const plusInternet = `$ ${(BigInt(totalBefore.replace(/\D/g, "")) + 115000n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;
    await waitTotal(plusInternet);
    await poll(async () => ((await figureText("fixed")) ?? "").includes("1 de 1") && (await figureText("fixed")).includes("$ 115.000 pagados"));
    await poll(async () => (await stateOf("Internet del local")) === "paid");
    await poll(async () => (await list()).includes("Internet del local"));
    assert.match(await list(), /Internet del local\s*Fijo/, "«Fijo» badge on the paid expense");
    await click("Fijos"); await poll(async () => (await rows()) === 1 && (await list()).includes("Internet del local"));
    await waitText(`Gastos fijos pagados en ${monthName(today.slice(0, 7))}`); await click("Todos");
    checks.push("Marcar pagado: planned amount preloaded and editable with separators, date today (max today), method; lost reply + Reintentar = same operationId, one expense; total +115.000; Fijos pagados 1 de 1 and $ 115.000; «Fijo» badge and «Fijos» chip");

    // Reschedule the overdue one; skip the single one.
    assert.equal(await rowButton("Revisión del extintor", "Opciones de"), true); await click("Reprogramar");
    await setDate("#reschedule-date", addDays(today, 5)); await fill("#reschedule-amount", "45000");
    await click("Guardar nueva fecha"); await waitText("«Revisión del extintor» quedó para el");
    const patchBody = mutations.filter(m => m.method === "PATCH" && m.path.startsWith("/api/expenses/scheduled/")).at(-1).body;
    assert.deepEqual([patchBody.dueDate, patchBody.plannedAmount], [addDays(today, 5), "45000"]);
    await poll(async () => (await figureText("overdue")) === null && (await stateOf("Revisión del extintor")) === "soon");
    assert.equal(await rowButton("Publicidad en redes", "Opciones de"), true); await click("Omitir este pago");
    await click("Sí, omitir este pago"); await waitText("«Publicidad en redes» se omitió.");
    await poll(async () => !(await card()).includes("Publicidad en redes"));
    assert.equal(payments.find(x => x.description === "Publicidad en redes").status, "CANCELLED");
    await waitTotal(plusInternet);
    checks.push("Reprogramar (date + planned amount in one PATCH, the overdue banner disappears) and Omitir (definitive, leaves the card, no expense)");

    // Void the paid expense without replacement: the payment goes back to pending (decision F1b-1).
    await open("Internet del local"); await waitText("Pago de un gasto fijo.");
    await click("Anular gasto"); await fill('[role="alertdialog"] textarea', "Pagado a otra cuenta"); await click("Sí, anular el gasto");
    await waitText("Gasto anulado. Ya no cuenta en los totales."); await closeDialogs();
    await waitTotal(totalBefore);
    await poll(async () => (await stateOf("Internet del local")) === "soon" && ((await figureText("fixed")) ?? "").includes("0 de 1"));
    checks.push("Voiding the paid expense without replacement puts the payment back to pending; totals and Fijos pagados update");

    // Administrar: edit the estimated amount (future pending dates follow), pause and resume.
    await click("Administrar"); await poll(() => evaluate(`Boolean(document.querySelector('[data-recurring-manager] [data-recurring-id]'))`));
    await waitText("Cada mes · $ 110.000"); await noOldGreen("the manager dialog");
    await click("Editar"); await fill("#recurring-amount", "120.000"); await click("Guardar cambios"); await waitText("se actualizó.");
    const editBody = mutations.filter(m => m.method === "PATCH" && m.path.startsWith("/api/expenses/recurring/")).at(-1).body;
    assert.deepEqual(Object.keys(editBody).sort(), ["estimatedAmount", "expectedVersion", "operationId", "requestId"]); assert.equal(editBody.estimatedAmount, "120000");
    await waitText("Cada mes · $ 120.000");
    await click("Pausar"); await waitText("quedó en pausa"); await waitText("En pausa");
    await click("Reanudar"); await waitText("se reanudó."); await closeDialogs();
    await poll(async () => (await card()).includes("Internet del local") && (await card()).includes("$ 120.000"));
    checks.push("Administrar: edit estimated amount (PATCH with only the changed field; pending dates follow), pause and resume");

    // Future months: zero figures with «Mes futuro», generated pending payments with their actions, projected dates of
    // ACTIVE fixed expenses without actions (computed by the read, never stored), planned total; up to 12 months ahead.
    const nextMonth = shiftMonth(today.slice(0, 7), 1);
    payments.push({ id: randomUUID(), status: "PENDING", templateId: null, occurrenceDate: null, dueDate: `${nextMonth}-15`, plannedAmount: "70000", description: "Seguro del local",
      categoryId: categories.find(c => c.seedKey === "taxes-procedures").id, paymentMethod: "CASH", paymentMethodNote: null, supplierName: null, customized: false, paidExpenseId: null, paidAt: null, cancelledAt: null, cancelReason: null, version: 1 });
    const pausedTemplate = { id: randomUUID(), status: "PAUSED", description: "Fijo en pausa", categoryId: categories.find(c => c.seedKey === "utilities").id, paymentMethod: "CASH", paymentMethodNote: null,
      supplierName: null, estimatedAmount: "5000", frequency: "MONTHLY", interval: 1, anchorDate: today, endDate: null, generatedThrough: addDays(today, 7), version: 1 };
    templates.push(pausedTemplate, { ...pausedTemplate, id: randomUUID(), status: "ENDED", description: "Alarma vieja", estimatedAmount: "45000", endedAt: `${addDays(today, -2)}T15:00:00.000Z` });
    const rowsBefore = payments.length, listReads = log.filter(entry => entry === "GET /api/expenses").length;
    await evaluate(`document.querySelector('[aria-label="Mes siguiente"]').click()`);
    await waitText(monthLabel(nextMonth));
    await poll(async () => (await total()) === "$ 0" && await evaluate(`Boolean(document.querySelector('[data-future-note]'))`));
    for (const name of ["fixed", "variable"]) assert.match(await figureText(name), /\$ 0 Mes futuro/, `${name}: $ 0 and «Mes futuro»`);
    await poll(async () => (await card()).includes("Proyectado") && (await card()).includes("Seguro del local"));
    const internetProjected = await evaluate(`(()=>{const li=document.querySelector('[data-projected]');return li?{text:li.innerText.replace(/\\s+/g,' '),buttons:li.querySelectorAll('button,a').length}:null})()`);
    assert.ok(internetProjected && internetProjected.text.includes("Internet del local") && internetProjected.text.includes("$ 120.000") && internetProjected.text.includes("cada mes"), JSON.stringify(internetProjected));
    assert.equal(internetProjected.buttons, 0, "a projected date has no actions (no pay, skip or edit)");
    assert.equal(await stateOf("Seguro del local"), "pending", "a generated payment of that month keeps its actions");
    assert.equal(await rowButton("Seguro del local", "Marcar pagado"), true); await poll(() => evaluate(`Boolean(document.querySelector('#pay-amount'))`)); await closeDialogs();
    assert.ok(!(await card()).includes("Fijo en pausa") && !(await card()).includes("Alarma vieja"), "paused and ended fixed expenses are not projected");
    // Generated pending of that month (70.000, plus the rescheduled one if today + 5 falls in it) + projected 120.000.
    const generatedNext = payments.filter(x => x.status === "PENDING" && x.dueDate.startsWith(nextMonth));
    const plannedNext = generatedNext.reduce((t, x) => t + BigInt(x.plannedAmount ?? 0), 120000n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    assert.equal(await evaluate(`document.querySelector('[data-planned-total]').innerText.replace(/\\s+/g,' ')`), `Previsto del mes: $ ${plannedNext} · ${generatedNext.length + 1} pagos`,
      "planned = generated pending + projected with amount");
    assert.equal(payments.length, rowsBefore, "showing a future month stores nothing");
    assert.equal(log.filter(entry => entry === "GET /api/expenses").length, listReads, "no expense list is requested for a future month");
    await waitText("Mes futuro: todavía no hay gastos.");
    await shot("gastos-futuro-1440");
    for (let i = 1; i < 12; i++) await evaluate(`document.querySelector('[aria-label="Mes siguiente"]').click()`);
    await waitText(monthLabel(shiftMonth(today.slice(0, 7), 12)));
    assert.equal(await evaluate(`document.querySelector('[aria-label="Mes siguiente"]').disabled`), true, "12 months ahead is the limit");
    for (let i = 0; i < 12; i++) await evaluate(`document.querySelector('[aria-label="Mes anterior"]').click()`);
    await waitText(monthLabel(today.slice(0, 7))); await waitTotal(totalBefore);
    assert.equal(await evaluate(`Boolean(document.querySelector('[data-future-note]'))`), false);
    checks.push("Future months: «Mes siguiente» up to 12 months ahead; $ 0 with «Mes futuro»; generated payment with its actions plus «Proyectado» dates without actions; paused/ended not projected; «Previsto del mes»; no list request and nothing stored; back to the current month");

    // Administrar: ended fixed expenses in a folded, read-only «Terminados (n)».
    await click("Administrar"); await poll(() => evaluate(`Boolean(document.querySelector('[data-recurring-ended]'))`));
    assert.equal(await evaluate(`document.querySelector('[data-recurring-ended]').open`), false, "folded by default");
    assert.match(await evaluate(`document.querySelector('[data-recurring-ended] summary').innerText`), /Terminados \(1\)/);
    await evaluate(`document.querySelector('[data-recurring-ended] summary').click()`);
    const endedText = norm(await evaluate(`document.querySelector('[data-recurring-ended]').innerText`));
    for (const part of ["Alarma vieja", "Cada mes", "$ 45.000", "Servicios públicos", "Terminó el"]) assert.ok(endedText.includes(part), part);
    assert.equal(await evaluate(`document.querySelectorAll('[data-recurring-ended] li button').length`), 0, "read only");
    assert.ok(!norm(await evaluate(`document.querySelector('ul[aria-label="Gastos fijos"]').innerText`)).includes("Alarma vieja"), "ended ones are not in the managed list");
    await noOldGreen("the manager with ended ones"); await closeDialogs();
    checks.push("Administrar: «Terminados (n)» folded, with name, frequency, amount, category and end date, read only");

    // Correction C: a failed sync shows what exists with a discreet notice, never blocks; Reintentar syncs again.
    syncFails = 1;
    await command("Page.navigate", { url: "http://localhost:4338/dashboard/gastos" });
    await waitText("No pudimos actualizar los gastos fijos"); await waitTotal(totalBefore);
    await poll(async () => (await card()).includes("Internet del local"));
    await click("Reintentar"); await poll(async () => !norm(await text()).includes("No pudimos actualizar los gastos fijos"));
    checks.push("Sync failure (correction C): figures, list and card still load with a discreet notice; Reintentar syncs and refreshes");
    await viewport(1440); await shot("gastos-f1b-1440");

    // Keyboard: Tab from the search reaches the list; visible focus.
    await evaluate(`document.querySelector('#expense-search').focus()`);
    await key("Tab", "Tab", 9);
    assert.equal(await evaluate(`document.activeElement?.closest('ul[aria-label="Gastos"]') !== null`), true, "Tab moves from the search to the first expense");
    assert.notEqual(await evaluate(`getComputedStyle(document.activeElement).outlineStyle`), "none", "visible focus");
    await noOldGreen("the Gastos page");
    checks.push("Keyboard: Tab order from filters to the list with visible focus; dialogs close with Escape");
    checks.push("New style: no old green (computed styles) on the page or in the register, detail, reclassify, void, categories and archive dialogs; blue primary and focus ring, status red for void, blue-grey secondary borders");
    checks.push("Amount field: «1.250.000» while typing, caret kept when deleting or typing in the middle, paste with or without dots, 13 digits, empty; API still receives digits only");

    // Responsive: stacked figures and a register button above the bottom bar on mobile; no overflow.
    for (const width of [320, 375, 390, 768, 1024, 1132, 1280, 1440]) {
      await viewport(width);
      // Header: from 1024 px the month selector and «Registrar gasto» share one row (the primary action never drops
      // alone); the secondary actions stay together in their own row.
      const header = await evaluate(`(()=>{const r=e=>e&&e.getClientRects().length?e.getBoundingClientRect():null;const reg=r(${button("Registrar gasto")}&&document.querySelector('[data-header-primary]').contains(${button("Registrar gasto")})?${button("Registrar gasto")}:null);const m=r(document.querySelector('[aria-label="Mes"]'));const t=r(document.querySelector('main h1'));const s=[...document.querySelectorAll('[data-header-secondary] button')].map(r);return {reg:reg&&{top:Math.round(reg.top),bottom:Math.round(reg.bottom)},month:{top:Math.round(m.top),bottom:Math.round(m.bottom)},title:Math.round(t.top),secondary:s.map(b=>Math.round(b.top))}})()`);
      if (width >= 375) assert.equal(new Set(header.secondary).size, 1, `secondary actions in one row at ${width}px`); // at 320 they stack, without overflow
      if (width >= 1024) {
        assert.ok(header.reg && Math.abs((header.reg.top + header.reg.bottom) - (header.month.top + header.month.bottom)) <= 4, `month and «Registrar gasto» in one row at ${width}px: ${JSON.stringify(header)}`);
        assert.ok(header.month.top < header.secondary[0], `secondary row below at ${width}px`);
        if ([1132, 1440].includes(width)) { await evaluate(`window.scrollTo(0,0)`); await shot(`gastos-cabecera-${width}`); }
      }
      if (width === 375) { await evaluate(`window.scrollTo(0,0)`); await shot("gastos-cabecera-375"); }
      const overflow = await evaluate(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
      const wide = overflow > 0 ? await evaluate(`[...document.querySelectorAll('main *')].filter(e=>e.getBoundingClientRect().right>document.documentElement.clientWidth+1).slice(-4).map(e=>e.tagName+'.'+String(e.className).slice(0,60)+' '+Math.round(e.getBoundingClientRect().right))`) : [];
      assert.ok(overflow <= 0, `horizontal overflow of ${overflow}px at ${width}px: ${JSON.stringify(wide)}`);
      assert.equal(await evaluate(`[...document.querySelectorAll('main button')].filter(b=>b.textContent.trim()==='Registrar gasto'&&b.getClientRects().length).length`), 1, `one visible «Registrar gasto» at ${width}px`);
      if (width < 1024) {
        const fab = await evaluate(`(()=>{const b=${button("Registrar gasto")};const nav=[...document.querySelectorAll('nav[aria-label="Principal"]')].find(n=>n.getClientRects().length);if(!b||!nav)return null;return {bottom:b.getBoundingClientRect().bottom,navTop:nav.getBoundingClientRect().top,height:b.getBoundingClientRect().height}})()`);
        assert.ok(fab && fab.bottom <= fab.navTop && fab.height >= 44, `register button above the bottom bar at ${width}px`);
      }
      if (width === 375) {
        assert.ok(await evaluate(`(()=>{const [a,b]=[...document.querySelectorAll('section[aria-labelledby="expense-figures"] article')].map(e=>e.getBoundingClientRect());return b.top>=a.bottom})()`), "figures stacked on mobile");
        await evaluate(`window.scrollTo(0,0)`); await shot("gastos-375");
      }
    }
    await viewport(375); await open("Arriendo local noviembre"); await synced(replacement);
    assert.ok(await evaluate(`document.documentElement.scrollWidth - document.documentElement.clientWidth`) <= 0, "detail without overflow at 375px");
    await closeDialogs();
    await command("Emulation.clearDeviceMetricsOverride");
    checks.push("Responsive: no horizontal overflow at 320–1440 px; figures stacked and register button above the bottom bar on mobile");

    // Every mutation: operationId and requestId UUIDs, a new requestId per transmission, no totals or ownership sent.
    const commands = mutations.filter(m => m.path !== "/api/expenses/scheduled/sync");
    assert.ok(mutations.filter(m => m.path === "/api/expenses/scheduled/sync").every(m => Object.keys(m.body).length === 0), "sync sends no body");
    assert.ok(commands.every(m => uuid.test(m.body.operationId) && uuid.test(m.body.requestId)));
    const sent = commands.map(m => m.body.requestId);
    assert.equal(new Set(sent).size, sent.length, "a new requestId for every transmission");
    assert.ok(mutations.every(m => !/total|ownerId|status|categoryName/.test(Object.keys(m.body).join())), "the client never sends totals, ownership or state");
    assert.deepEqual(unknown, []);
    console.log(JSON.stringify({ checks, mutations: mutations.length, expenses: expenses.length, categories: categories.length, productionAccess: false, simulatedApi: true }, null, 2));
  }, { browser: "chrome", sandbox: false });
} catch (error) { console.error(error); process.exitCode = 1; }
