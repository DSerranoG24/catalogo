// Pure helpers for the Gastos panel (docs/expenses-contract.md v1.2). Money is a decimal string or BigInt, never a Number.
import { formatCop, parseMoneyInput } from "./sales-ui.mjs";
export { formatCop };

export const PAYMENT_METHODS = ["CASH", "NEQUI", "DAVIPLATA", "BANK_TRANSFER", "CARD", "OTHER"];
export const PAYMENT_LABELS = { CASH: "Efectivo", NEQUI: "Nequi", DAVIPLATA: "Daviplata", BANK_TRANSFER: "Transferencia", CARD: "Tarjeta", OTHER: "Otro" };
export const EXPENSE_STATUS_LABELS = { CONFIRMED: "Confirmado", VOIDED: "Anulado", PENDING_CONFIRMATION: "Por confirmar", SKIPPED: "Omitido" };
// Same palette as Ventas; text/background pairs keep at least 4.5:1 contrast.
export const EXPENSE_STATUS_TONES = {
  CONFIRMED: "border-[#C7D7FE] bg-[#E6EEFF] text-[#1D4ED8]",
  VOIDED: "border-[#efc2bd] bg-[#fdf0ee] text-[#8a2b20]",
  PENDING_CONFIRMATION: "border-[#ecd3a3] bg-[#fdf5e6] text-[#7a4f0b]",
  SKIPPED: "border-[#CBD5E6] bg-[#F1F4FA] text-[#334155]",
};
export const MAX_EXPENSE_AMOUNT = 1000000000000n;

const pad = n => String(n).padStart(2, "0");
const uuid = v => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const object = v => v !== null && typeof v === "object" && !Array.isArray(v);
const money = v => typeof v === "string" && /^(0|[1-9][0-9]*)$/.test(v);
const isoDate = v => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
const text = v => v === null || v === undefined || typeof v === "string";

/** Today in Bogotá as YYYY-MM-DD. */
export function bogotaToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
/** Oldest allowed expense date: five years back (29 Feb maps to 28 Feb). */
export function minExpenseDate(today) {
  const [y, m, d] = today.split("-").map(Number);
  return `${y - 5}-${pad(m)}-${pad(m === 2 && d === 29 ? 28 : d)}`;
}
export function monthRange(today) { return { from: `${today.slice(0, 7)}-01`, to: today }; }
export function previousMonthRange(today) {
  const [y, m] = today.split("-").map(Number);
  const year = m === 1 ? y - 1 : y, month = m === 1 ? 12 : m - 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { from: `${year}-${pad(month)}-01`, to: `${year}-${pad(month)}-${pad(last)}` };
}
export function yearRange(today) { return { from: `${today.slice(0, 4)}-01-01`, to: today }; }
export function validRange(from, to) { return isoDate(from) && isoDate(to) && from <= to && (Date.parse(to) - Date.parse(from)) / 86400000 <= 365; }
export function formatExpenseDate(value) {
  return new Intl.DateTimeFormat("es-CO", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}

/** Validates the register / replace form. Returns Spanish errors and the API payload. */
export function validateExpenseForm(form, today) {
  const errors = [];
  // Dots or spaces are accepted only as thousands separators (groups of three): "150.000" yes, "1.5" no.
  const raw = String(form.amount ?? "").trim();
  const amount = parseMoneyInput(/^\d{1,3}([.\s]\d{3})+$/.test(raw) ? raw.replace(/[.\s]/g, "") : raw);
  if (amount === null || BigInt(amount) <= 0n || BigInt(amount) > MAX_EXPENSE_AMOUNT) errors.push("Escribe un monto entre $ 1 y $ 1.000.000.000.000, en pesos enteros.");
  if (!isoDate(form.expenseDate)) errors.push("Elige la fecha del gasto.");
  else if (form.expenseDate > today) errors.push("La fecha del gasto no puede ser futura.");
  else if (form.expenseDate < minExpenseDate(today)) errors.push("La fecha del gasto no puede tener más de cinco años.");
  if (!uuid(form.categoryId)) errors.push("Elige una categoría.");
  if (!PAYMENT_METHODS.includes(form.paymentMethod)) errors.push("Elige un medio de pago.");
  const note = String(form.paymentMethodNote ?? "").trim(), reference = String(form.paymentReference ?? "").trim();
  const description = String(form.description ?? "").trim(), supplier = String(form.supplierName ?? "").trim();
  if (form.paymentMethod === "OTHER" && (note.length < 3 || note.length > 80)) errors.push("Con «Otro», describe el medio de pago (3 a 80 caracteres).");
  if (reference.length > 100) errors.push("La referencia admite como máximo 100 caracteres.");
  if (!description || description.length > 300) errors.push("Escribe una descripción de 1 a 300 caracteres.");
  if (supplier.length > 160) errors.push("El proveedor admite como máximo 160 caracteres.");
  const payload = { expenseDate: form.expenseDate, amount: amount ?? "", categoryId: form.categoryId, paymentMethod: form.paymentMethod, description,
    ...(form.paymentMethod === "OTHER" ? { paymentMethodNote: note } : {}), ...(reference ? { paymentReference: reference } : {}), ...(supplier ? { supplierName: supplier } : {}) };
  return { errors, payload };
}
/** Same day and amount as an already loaded expense: warn, never block. */
export function possibleDuplicate(items, payload) {
  return items.some(item => item.status === "CONFIRMED" && item.expenseDate === payload.expenseDate && item.amount === payload.amount);
}

function validCategory(c) { return object(c) && uuid(c.id) && typeof c.name === "string" && Number.isSafeInteger(c.version) && Number.isSafeInteger(c.position) && (c.archivedAt === null || typeof c.archivedAt === "string"); }
function validExpense(e) {
  return object(e) && uuid(e.id) && Object.keys(EXPENSE_STATUS_LABELS).includes(e.status) && isoDate(e.expenseDate) && (e.amount === null || money(e.amount))
    && uuid(e.categoryId) && text(e.categoryName) && PAYMENT_METHODS.includes(e.paymentMethod) && text(e.paymentMethodNote) && typeof e.description === "string"
    && text(e.supplierName) && Number.isSafeInteger(e.version) && typeof e.recordedAt === "string";
}
function invalid() { throw new Error("La respuesta de gastos no es válida. Recarga antes de continuar."); }
export function parseCategories(value) {
  const list = value?.result?.categories;
  if (value?.success !== true || !Array.isArray(list) || !list.every(validCategory)) invalid();
  return list;
}
export function parseExpensePage(value) {
  const r = value?.result;
  if (value?.success !== true || !object(r) || !Array.isArray(r.items) || !r.items.every(validExpense) || r.items.some(i => "paymentReference" in i) || !(r.nextCursor === null || typeof r.nextCursor === "string")) invalid();
  return r;
}
export function parseSummary(value) {
  const r = value?.result;
  if (value?.success !== true || !object(r) || !money(r.confirmedTotal) || !Number.isSafeInteger(r.confirmedCount) || !Number.isSafeInteger(r.voidedCount)
    || !Array.isArray(r.byCategory) || !r.byCategory.every(c => uuid(c.categoryId) && money(c.total)) || !Array.isArray(r.byPaymentMethod) || !r.byPaymentMethod.every(m => PAYMENT_METHODS.includes(m.paymentMethod) && money(m.total))) invalid();
  return r;
}
export function parseExpenseDetail(value) {
  const r = value?.result;
  if (value?.success !== true || !object(r) || !validExpense(r.expense) || !text(r.expense.paymentReference) || !Array.isArray(r.events)) invalid();
  return r;
}

const ERRORS = {
  VERSION_CONFLICT: { title: "El dato cambió", detail: "Otra pestaña o persona lo modificó. Recarga y revisa antes de seguir.", action: "reload" },
  INVALID_EXPENSE_TRANSITION: { title: "Esa acción ya no está disponible", detail: "El gasto cambió de estado. Recarga para verlo.", action: "reload" },
  IDEMPOTENCY_CONFLICT: { title: "Operación ya registrada con otros datos", detail: "Recarga antes de repetir la acción.", action: "reload" },
  EXPENSE_CATEGORY_ARCHIVED: { title: "La categoría está archivada", detail: "Elige una categoría activa o reactívala en «Categorías».", action: null },
  EXPENSE_CATEGORY_NAME_CONFLICT: { title: "Ya existe una categoría con ese nombre", detail: "Si está archivada, puedes reactivarla en lugar de crear otra.", action: null },
  EXPENSE_CATEGORY_QUOTA: { title: "Máximo de 100 categorías", detail: "Archiva o reutiliza una categoría existente.", action: null },
  EXPENSE_NOT_FOUND: { title: "Gasto no encontrado", detail: "Puede que ya no exista en tu cuenta. Vuelve al listado.", action: "reload" },
  EXPENSE_CATEGORY_NOT_FOUND: { title: "Categoría no encontrada", detail: "Recarga las categorías y elige otra.", action: "reload" },
  INVALID_EXPENSE_INPUT: { title: "Revisa los datos", detail: "Monto entre $ 1 y $ 1.000.000.000.000, fecha de hoy o de los últimos cinco años, y nota solo con «Otro».", action: null },
};
/** Maps an API or network failure to a Spanish message and a clear next action. */
export function describeExpenseFailure(error) {
  const status = typeof error?.status === "number" ? error.status : null;
  if (status === null) return { title: "Sin conexión con el servidor", detail: "No sabemos si la acción se registró. Reintenta: se enviará la misma operación y no se duplicará.", action: "retry" };
  if (status === 401) return { title: "Tu sesión expiró", detail: "Inicia sesión de nuevo para continuar.", action: "login" };
  if (ERRORS[error.code]) return { ...ERRORS[error.code] };
  if (status >= 500) return { title: "El servidor no pudo completar la acción", detail: "Reintenta: se enviará la misma operación y no se duplicará.", action: "retry" };
  return { title: "No se pudo completar la acción", detail: "Revisa los datos e intenta de nuevo.", action: null };
}

// ---- Gastos page (redesign): month navigation, overview, grouping and search. ----
const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const WEEKDAYS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const capitalize = text => text.charAt(0).toLocaleUpperCase("es-CO") + text.slice(1);
/** "2026-11" → "Noviembre 2026". */
export const monthLabel = month => `${capitalize(MONTHS[Number(month.slice(5, 7)) - 1])} ${month.slice(0, 4)}`;
/** "2026-11" → "noviembre". */
export const monthName = month => MONTHS[Number(month.slice(5, 7)) - 1];
/** Adds months to "YYYY-MM". */
export function shiftMonth(month, delta) {
  const [y, m] = month.split("-").map(Number), index = y * 12 + (m - 1) + delta;
  return `${Math.floor(index / 12)}-${pad(index % 12 + 1)}`;
}
/** Day heading for the grouped list: "HOY · MIÉRCOLES 25", "AYER · MARTES 24", "LUNES 23". */
export function dayHeading(date, today) {
  const day = new Date(`${date}T12:00:00Z`), base = `${WEEKDAYS[day.getUTCDay()]} ${day.getUTCDate()}`;
  const yesterday = new Date(`${today}T12:00:00Z`); yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const prefix = date === today ? "hoy · " : date === yesterday.toISOString().slice(0, 10) ? "ayer · " : "";
  return `${prefix}${base}`.toLocaleUpperCase("es-CO");
}
/** Groups an already ordered list (date desc) by expenseDate. */
export function groupByDay(items) {
  const groups = [];
  for (const item of items) {
    const last = groups.at(-1);
    if (last && last.date === item.expenseDate) last.items.push(item); else groups.push({ date: item.expenseDate, items: [item] });
  }
  return groups;
}
const fold = text => String(text ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("es-CO").replace(/\s+/g, " ").trim();
/** Search over description, category, payment note and supplier; accents and case are ignored. */
export function matchesSearch(item, query) {
  const needle = fold(query);
  if (!needle) return true;
  return [item.description, item.categoryName, item.categoryNameSnapshot, item.paymentMethodNote, item.supplierName].some(value => fold(value).includes(needle));
}
const count = v => Number.isSafeInteger(v) && v >= 0;
const pendingFigure = v => object(v) && count(v.count) && money(v.plannedTotal) && count(v.withoutAmount) && v.withoutAmount <= v.count;
/** F1b figures: upcoming and overdue only exist for the current month (null otherwise). */
function validScheduledFigures(s) {
  return object(s) && object(s.fixed) && count(s.fixed.due) && count(s.fixed.paid) && s.fixed.paid <= s.fixed.due && money(s.fixed.paidTotal)
    && (s.upcoming === null || pendingFigure(s.upcoming)) && (s.overdue === null || pendingFigure(s.overdue)) && (s.upcoming === null) === (s.overdue === null);
}
/** Validates GET /expenses/overview (amounts are decimal strings; percents come from the server). */
export function parseExpenseOverview(value, month) {
  const r = value?.result;
  const ok = value?.success === true && object(r) && r.month === month && isoDate(r.from) && isoDate(r.to) && typeof r.generatedAt === "string" && !Number.isNaN(Date.parse(r.generatedAt))
    && money(r.total) && Number.isSafeInteger(r.count) && Number.isSafeInteger(r.voidedCount) && object(r.previousMonth) && money(r.previousMonth.total)
    && Array.isArray(r.days) && r.days.length >= 1 && r.days.length <= 31 && r.days.every(d => object(d) && isoDate(d.date) && d.date.startsWith(month) && money(d.total))
    && Array.isArray(r.byCategory) && r.byCategory.every(c => object(c) && uuid(c.categoryId) && typeof c.name === "string" && typeof c.archived === "boolean" && money(c.total) && typeof c.percent === "string" && /^\d{1,3}$/.test(c.percent))
    && validScheduledFigures(r.scheduled) && object(r.variable) && money(r.variable.total) && Number.isSafeInteger(r.variable.count);
  if (!ok) invalid();
  return r;
}
/** Tile icon and tint per suggested category (seedKey); custom categories use the neutral style. */
export const CATEGORY_STYLES = {
  rent: { icon: "home", tone: "bg-[#F1ECFF] text-[#6D28D9]" },
  utilities: { icon: "zap", tone: "bg-[#FEF3C7] text-[#B45309]" },
  "internet-phone": { icon: "wifi", tone: "bg-[#E0F2FE] text-[#0369A1]" },
  "transport-delivery": { icon: "truck", tone: "bg-[#E0F2FE] text-[#0369A1]" },
  advertising: { icon: "megaphone", tone: "bg-[#FCE7F3] text-[#BE185D]" },
  maintenance: { icon: "wrench", tone: "bg-[#F1F5F9] text-[#334155]" },
  stationery: { icon: "shopping-bag", tone: "bg-[#FFE4E6] text-[#BE123C]" },
  fees: { icon: "landmark", tone: "bg-[#ECFDF5] text-[#047857]" },
  "taxes-procedures": { icon: "receipt", tone: "bg-[#FFF7ED] text-[#C2410C]" },
  "payroll-fees": { icon: "users", tone: "bg-[#EEF2FF] text-[#4338CA]" },
  other: { icon: "tag", tone: "bg-[#F3F4F6] text-[#374151]" },
};
export const DEFAULT_CATEGORY_STYLE = { icon: "tag", tone: "bg-[#F3F0FF] text-[#5B21B6]" };
/** Payment pill colors (text ≥ 4.5:1 on its background). */
export const PAYMENT_TONES = {
  CASH: "bg-[#E7F6EC] text-[#166534]", NEQUI: "bg-[#F3E8FF] text-[#6B21A8]", DAVIPLATA: "bg-[#FEE2E2] text-[#991B1B]",
  BANK_TRANSFER: "bg-[#E6EEFF] text-[#1D4ED8]", CARD: "bg-[#F1F5F9] text-[#334155]", OTHER: "bg-[#F3F4F6] text-[#374151]",
};

// ---- Amount field: Colombian thousands separator while typing (the payload stays digits only). ----
const digitsOf = text => text.replace(/\D/g, "");
const groupThousands = digits => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
/**
 * Formats the amount input as it is typed: "1250000" → "1.250.000". Only digits are kept; a comma (decimal
 * separator) or other text leaves the value untouched so validation rejects it instead of guessing.
 * The caret stays after the same digit it followed. Deleting a separator deletes the digit next to it.
 * @param {string} raw value after the edit  @param {number} caret caret after the edit
 * @param {string} previous value before the edit  @param {string} [inputType] InputEvent.inputType
 */
export function formatAmountInput(raw, caret, previous = "", inputType = "") {
  if (/[^\d.\s]/.test(raw.replace(/[^\d.\s,]/g, "")) || raw.includes(",")) return { value: raw, caret };
  let digits = digitsOf(raw), before = digitsOf(raw.slice(0, caret)).length;
  // A separator was removed (same digits, shorter text): remove the neighbouring digit instead.
  if (previous && raw.length < previous.length && digits === digitsOf(previous)) {
    if (inputType === "deleteContentBackward" && before > 0) { digits = digits.slice(0, before - 1) + digits.slice(before); before -= 1; }
    else if (inputType === "deleteContentForward" && before < digits.length) digits = digits.slice(0, before) + digits.slice(before + 1);
  }
  const trimmed = digits.replace(/^0+(?=\d)/, "");
  before = Math.max(0, before - (digits.length - trimmed.length));
  const value = groupThousands(trimmed);
  let position = 0, seen = 0;
  while (position < value.length && seen < before) { if (/\d/.test(value[position])) seen++; position++; }
  return { value, caret: position };
}

// ---- Gastos F1b: fixed expenses and scheduled payments (docs/expenses-f1b-contract.md). Never added to any total. ----
export const FREQUENCIES = ["WEEKLY", "MONTHLY", "YEARLY"];
const FREQUENCY_UNITS = { WEEKLY: ["semana", "semanas"], MONTHLY: ["mes", "meses"], YEARLY: ["año", "años"] };
/** "Cada mes", "Cada 2 semanas". */
export function frequencyLabel(frequency, interval) {
  const [one, many] = FREQUENCY_UNITS[frequency] ?? ["vez", "veces"];
  return interval === 1 ? `Cada ${one}` : `Cada ${interval} ${many}`;
}
export const MAX_SCHEDULE_DAYS_AHEAD = 366;
/** Adds days to a calendar date "YYYY-MM-DD". */
export function addDays(date, days) {
  const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10);
}
/** Last day of "YYYY-MM". */
export const monthEnd = month => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
/** Pesos typed with or without thousands separators → digits, or null. */
export function amountDigits(value) {
  const raw = String(value ?? "").trim();
  const amount = parseMoneyInput(/^\d{1,3}([.\s]\d{3})+$/.test(raw) ? raw.replace(/[.\s]/g, "") : raw);
  return amount === null || BigInt(amount) <= 0n || BigInt(amount) > MAX_EXPENSE_AMOUNT ? null : amount;
}
function methodErrors(form, errors) {
  if (!PAYMENT_METHODS.includes(form.paymentMethod)) errors.push("Elige un medio de pago.");
  const note = String(form.paymentMethodNote ?? "").trim();
  if (form.paymentMethod === "OTHER" && (note.length < 3 || note.length > 80)) errors.push("Con «Otro», describe el medio de pago (3 a 80 caracteres).");
  return form.paymentMethod === "OTHER" ? { paymentMethodNote: note } : {};
}

/**
 * «Programar pago»: one payment, or a fixed expense when «Repetir» is on. The planned amount is optional; the due date
 * is today or later (up to 366 days). Returns the endpoint and the payload; the server validates again.
 */
export function validateScheduleForm(form, today) {
  const errors = [];
  const rawAmount = String(form.plannedAmount ?? "").trim(), amount = rawAmount ? amountDigits(rawAmount) : null;
  if (rawAmount && amount === null) errors.push("El monto previsto es opcional; si lo escribes, debe estar entre $ 1 y $ 1.000.000.000.000, en pesos enteros.");
  if (!isoDate(form.dueDate)) errors.push("Elige la fecha de vencimiento.");
  else if (form.dueDate < today) errors.push("El vencimiento debe ser hoy o una fecha futura.");
  else if (form.dueDate > addDays(today, MAX_SCHEDULE_DAYS_AHEAD)) errors.push("El vencimiento puede estar como máximo a un año.");
  if (!uuid(form.categoryId)) errors.push("Elige una categoría.");
  const description = String(form.description ?? "").trim(), supplier = String(form.supplierName ?? "").trim();
  if (!description || description.length > 300) errors.push("Escribe una descripción de 1 a 300 caracteres.");
  if (supplier.length > 160) errors.push("El proveedor admite como máximo 160 caracteres.");
  const note = methodErrors(form, errors);
  const common = { description, categoryId: form.categoryId, paymentMethod: form.paymentMethod, ...note, ...(supplier ? { supplierName: supplier } : {}) };
  if (!form.repeat) return { errors, path: "/expenses/scheduled", payload: { ...common, dueDate: form.dueDate, ...(amount ? { plannedAmount: amount } : {}) } };
  const interval = Number(form.interval);
  if (!FREQUENCIES.includes(form.frequency)) errors.push("Elige cada cuánto se repite.");
  if (!Number.isInteger(interval) || interval < 1 || interval > 12) errors.push("Se puede repetir cada 1 a 12 semanas, meses o años.");
  if (form.endDate && (!isoDate(form.endDate) || form.endDate < form.dueDate)) errors.push("La fecha final debe ser igual o posterior al primer vencimiento.");
  return { errors, path: "/expenses/recurring", payload: { ...common, anchorDate: form.dueDate, frequency: form.frequency, interval,
    ...(amount ? { estimatedAmount: amount } : {}), ...(form.endDate ? { endDate: form.endDate } : {}) } };
}
/** «Marcar pagado»: the real amount (may differ from the planned one), a payment date that is not future, and the method. */
export function validatePayForm(form, today) {
  const errors = [];
  const amount = amountDigits(form.amount);
  if (amount === null) errors.push("Escribe el monto pagado, entre $ 1 y $ 1.000.000.000.000, en pesos enteros.");
  if (!isoDate(form.expenseDate)) errors.push("Elige la fecha de pago.");
  else if (form.expenseDate > today) errors.push("La fecha de pago no puede ser futura.");
  else if (form.expenseDate < minExpenseDate(today)) errors.push("La fecha de pago no puede tener más de cinco años.");
  const note = methodErrors(form, errors);
  const reference = String(form.paymentReference ?? "").trim();
  if (reference.length > 100) errors.push("La referencia admite como máximo 100 caracteres.");
  return { errors, payload: { amount: amount ?? "", expenseDate: form.expenseDate, paymentMethod: form.paymentMethod, ...note, ...(reference ? { paymentReference: reference } : {}) } };
}

const SCHEDULED_STATUSES = ["PENDING", "PAID", "CANCELLED"];
const RECURRING_STATUSES = ["ACTIVE", "PAUSED", "ENDED"];
function validScheduled(s) {
  return object(s) && uuid(s.id) && SCHEDULED_STATUSES.includes(s.status) && (s.kind === "fixed" || s.kind === "single") && (s.templateId === null || uuid(s.templateId))
    && isoDate(s.dueDate) && Number.isSafeInteger(s.daysUntilDue) && typeof s.overdue === "boolean" && (s.plannedAmount === null || money(s.plannedAmount))
    && typeof s.description === "string" && uuid(s.categoryId) && text(s.categoryName) && PAYMENT_METHODS.includes(s.paymentMethod) && text(s.paymentMethodNote)
    && text(s.supplierName) && (s.paidExpenseId === null || uuid(s.paidExpenseId)) && (s.paidAmount === null || money(s.paidAmount)) && (s.paidDate === null || isoDate(s.paidDate))
    && Number.isSafeInteger(s.version);
}
function validRecurring(t) {
  return object(t) && uuid(t.id) && RECURRING_STATUSES.includes(t.status) && typeof t.description === "string" && uuid(t.categoryId) && text(t.categoryName)
    && PAYMENT_METHODS.includes(t.paymentMethod) && text(t.paymentMethodNote) && (t.estimatedAmount === null || money(t.estimatedAmount)) && FREQUENCIES.includes(t.frequency)
    && Number.isSafeInteger(t.interval) && isoDate(t.anchorDate) && (t.endDate === null || isoDate(t.endDate)) && (t.nextDate === null || isoDate(t.nextDate)) && Number.isSafeInteger(t.version);
}
/** GET /expenses/scheduled. */
export function parseScheduledList(value) {
  const r = value?.result;
  if (value?.success !== true || !object(r) || !Array.isArray(r.items) || !r.items.every(validScheduled) || typeof r.truncated !== "boolean" || !isoDate(r.today)) invalid();
  return r;
}
/** GET /expenses/recurring. */
export function parseRecurringList(value) {
  const r = value?.result;
  if (value?.success !== true || !object(r) || !Array.isArray(r.templates) || !r.templates.every(validRecurring)) invalid();
  return r.templates;
}
/** POST /expenses/scheduled/sync → { generated, pendingCount }. */
export function parseSyncReply(value) {
  const r = value?.result;
  if (value?.success !== true || !object(r) || !Number.isSafeInteger(r.generated) || !Number.isSafeInteger(r.pendingCount)) invalid();
  return r;
}
/** Overdue first, then pending by due date, then paid (most recent due date first). */
export function sortScheduled(items) {
  const rank = s => s.status === "PAID" ? 2 : s.overdue ? 0 : 1;
  return [...items].sort((a, b) => rank(a) - rank(b) || (rank(a) === 2 ? b.dueDate.localeCompare(a.dueDate) : a.dueDate.localeCompare(b.dueDate)) || a.id.localeCompare(b.id));
}
/**
 * State pill of a scheduled payment (design: Pagado green-teal, Vence en n días orange, Vencido red, Por pagar grey).
 * «Vence en n días» covers the 7-day notice (decision F1b-2); farther ones are «Por pagar».
 */
export function scheduledState(s) {
  if (s.status === "PAID") return { key: "paid", label: "Pagado", tone: "bg-[#E3F7EF] text-[#05603A]" };
  if (s.status === "CANCELLED") return { key: "cancelled", label: "Omitido", tone: "bg-[#F1F4FA] text-[#334155]" };
  if (s.overdue) return { key: "overdue", label: s.daysUntilDue === -1 ? "Venció ayer" : `Vencido hace ${-s.daysUntilDue} días`, tone: "bg-[#FDECEA] text-[#B42318]" };
  if (s.daysUntilDue === 0) return { key: "soon", label: "Vence hoy", tone: "bg-[#FFF1E6] text-[#B93815]" };
  if (s.daysUntilDue <= 7) return { key: "soon", label: s.daysUntilDue === 1 ? "Vence mañana" : `Vence en ${s.daysUntilDue} días`, tone: "bg-[#FFF1E6] text-[#B93815]" };
  return { key: "pending", label: "Por pagar", tone: "bg-[#F1F4FA] text-[#334155]" };
}
