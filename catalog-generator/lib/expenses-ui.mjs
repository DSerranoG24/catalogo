// Pure helpers for the Gastos panel (docs/expenses-contract.md v1.2). Money is a decimal string or BigInt, never a Number.
import { formatCop, parseMoneyInput } from "./sales-ui.mjs";
export { formatCop };

export const PAYMENT_METHODS = ["CASH", "NEQUI", "DAVIPLATA", "BANK_TRANSFER", "CARD", "OTHER"];
export const PAYMENT_LABELS = { CASH: "Efectivo", NEQUI: "Nequi", DAVIPLATA: "Daviplata", BANK_TRANSFER: "Transferencia", CARD: "Tarjeta", OTHER: "Otro" };
export const EXPENSE_STATUS_LABELS = { CONFIRMED: "Confirmado", VOIDED: "Anulado", PENDING_CONFIRMATION: "Por confirmar", SKIPPED: "Omitido" };
// Same palette as Ventas; text/background pairs keep at least 4.5:1 contrast.
export const EXPENSE_STATUS_TONES = {
  CONFIRMED: "border-[#b8dcc6] bg-[#ecf7f0] text-[#1f5b37]",
  VOIDED: "border-[#efc2bd] bg-[#fdf0ee] text-[#8a2b20]",
  PENDING_CONFIRMATION: "border-[#ecd3a3] bg-[#fdf5e6] text-[#7a4f0b]",
  SKIPPED: "border-[#cfd6cf] bg-[#f3f5f2] text-[#3f4a43]",
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
/** Validates GET /expenses/overview (amounts are decimal strings; percents come from the server). */
export function parseExpenseOverview(value, month) {
  const r = value?.result;
  const ok = value?.success === true && object(r) && r.month === month && isoDate(r.from) && isoDate(r.to) && typeof r.generatedAt === "string" && !Number.isNaN(Date.parse(r.generatedAt))
    && money(r.total) && Number.isSafeInteger(r.count) && Number.isSafeInteger(r.voidedCount) && object(r.previousMonth) && money(r.previousMonth.total)
    && Array.isArray(r.days) && r.days.length >= 1 && r.days.length <= 31 && r.days.every(d => object(d) && isoDate(d.date) && d.date.startsWith(month) && money(d.total))
    && Array.isArray(r.byCategory) && r.byCategory.every(c => object(c) && uuid(c.categoryId) && typeof c.name === "string" && typeof c.archived === "boolean" && money(c.total) && typeof c.percent === "string" && /^\d{1,3}$/.test(c.percent));
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
