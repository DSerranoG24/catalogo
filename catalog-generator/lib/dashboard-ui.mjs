// Pure helpers for Inicio (GET /api/dashboard/summary, docs/dashboard-summary.md).
// Money arrives as decimal strings and is handled with BigInt only: never converted to Number.
import { formatCop } from "./sales-ui.mjs";
export { formatCop };

const MONEY = /^-?(0|[1-9][0-9]*)$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES = ["CONFIRMED", "DELIVERED", "CANCELLED", "RETURNED"];
const money = v => typeof v === "string" && MONEY.test(v);
const count = v => Number.isSafeInteger(v) && v >= 0;
const object = v => v !== null && typeof v === "object" && !Array.isArray(v);
const isoDay = v => typeof v === "string" && DAY.test(v) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
const instant = v => typeof v === "string" && !Number.isNaN(Date.parse(v)) && /Z$/.test(v);
const nextDay = day => { const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };

/** Validates the whole contract; anything else is treated as an error by the screen. */
export function parseDashboardSummary(value, days) {
  const fail = () => { throw new Error("La respuesta del resumen no es válida. Reintenta en un momento."); };
  if (!object(value) || value.success !== true || !instant(value.generatedAt)) fail();
  const { today, month, attention, salesSeries, recent, setup, modules } = value;
  if (!object(today) || !isoDay(today.date) || !money(today.salesTotal) || !count(today.salesCount) || !money(today.yesterdaySalesTotal)) fail();
  if (!object(modules) || typeof modules.expenses !== "boolean") fail();
  const expenses = v => modules.expenses ? money(v) : v === null;
  if (!object(month) || !money(month.salesTotal) || !money(month.costOfSales) || !count(month.salesWithoutCostCount) || !expenses(month.expensesTotal) || !money(month.estimatedProfit)) fail();
  const previous = month.previousMonth;
  if (!object(previous) || !money(previous.salesTotal) || !expenses(previous.expensesTotal) || !money(previous.estimatedProfit)) fail();
  if (!object(attention) || !count(attention.lowStockCount) || !count(attention.outOfStockCount) || !count(attention.pendingOrdersCount)) fail();
  if (!Array.isArray(salesSeries) || salesSeries.length !== days || !salesSeries.every(p => object(p) && isoDay(p.date) && money(p.total))) fail();
  if (salesSeries.some((p, i) => i > 0 && p.date !== nextDay(salesSeries[i - 1].date)) || salesSeries.at(-1).date !== today.date) fail();
  if (!Array.isArray(recent) || recent.length > 5 || !recent.every(r => object(r) && r.kind === "SALE" && typeof r.id === "string" && STATUSES.includes(r.status)
    && money(r.total) && instant(r.at) && (r.customerName === null || typeof r.customerName === "string"))) fail();
  if (!object(setup) || !["hasInventoryItems", "hasPublishedCatalog", "hasSales"].every(k => typeof setup[k] === "boolean")) fail();
  return value;
}

const group = digits => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
/** Rounds |value| / unit to `decimals` decimals, half away from zero. Returns [integer part, decimal digits]. */
function scaled(abs, unit, decimals) {
  const factor = 10n ** BigInt(decimals);
  const rounded = (abs * factor * 2n + unit) / (unit * 2n);
  return [rounded / factor, (rounded % factor).toString().padStart(decimals, "0")];
}
/** Card value: full COP below one million, otherwise «$ 3,2 M» (one decimal, «,0» dropped). */
export function formatCopCompact(value) {
  const amount = BigInt(value), negative = amount < 0n, abs = negative ? -amount : amount;
  if (abs < 1000000n) return formatCop(amount);
  const [whole, decimal] = scaled(abs, 1000000n, 1);
  return `${negative ? "-" : ""}$ ${group(whole.toString())}${decimal === "0" ? "" : `,${decimal}`} M`;
}
/** Bar label: «999», «620K», «3,2M». */
export function formatAxis(value) {
  const amount = BigInt(value), negative = amount < 0n, abs = negative ? -amount : amount, sign = negative ? "-" : "";
  if (abs < 1000n) return `${sign}${abs}`;
  if (abs < 1000000n) {
    const [thousands] = scaled(abs, 1000n, 0);
    if (thousands < 1000n) return `${sign}${thousands}K`;
  }
  const [whole, decimal] = scaled(abs, 1000000n, 1);
  return `${sign}${group(whole.toString())}${decimal === "0" ? "" : `,${decimal}`}M`;
}
/** Change against the previous period. null when there is nothing to compare with (previous = 0). */
export function compare(current, previous) {
  const now = BigInt(current), before = BigInt(previous);
  if (before === 0n) return null;
  if (now === before) return { direction: "equal", text: "0%" };
  const diff = now - before, abs = before < 0n ? -before : before;
  const absDiff = diff < 0n ? -diff : diff;
  const percent = (absDiff * 200n + abs) / (abs * 2n);
  return { direction: diff > 0n ? "up" : "down", text: `${diff > 0n ? "+" : "-"}${group(percent.toString())}%` };
}
export const isNegative = value => BigInt(value) < 0n;

const timeFormat = new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const dayFormat = new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", day: "numeric", month: "short" });
const bogotaDay = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit" });
/** «14:32» in Bogotá. */
export const bogotaTime = iso => timeFormat.format(new Date(iso));
/** «Hoy, 14:32» or «24 nov, 09:05» (Bogotá), relative to the summary's day. */
export function movementTime(iso, today) {
  const date = new Date(iso);
  return bogotaDay.format(date) === today ? `Hoy, ${timeFormat.format(date)}` : `${dayFormat.format(date).replace(".", "")}, ${timeFormat.format(date)}`;
}
const weekdayFormat = new Intl.DateTimeFormat("es-CO", { timeZone: "UTC", weekday: "short" });
const longDayFormat = new Intl.DateTimeFormat("es-CO", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" });
const capital = text => text.charAt(0).toLocaleUpperCase("es-CO") + text.slice(1);
/** Calendar day → «Lun» (series days are already Bogotá dates). */
export const weekday = day => capital(weekdayFormat.format(new Date(`${day}T12:00:00Z`)).replace(".", ""));
/** Calendar day → «Lunes, 23 de noviembre». */
export const longDay = day => capital(longDayFormat.format(new Date(`${day}T12:00:00Z`)));
/** Spanish plural helper: plural(1, "venta", "ventas"). */
export const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
