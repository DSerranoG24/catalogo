export const saleStatuses = ["DRAFT", "CONFIRMED", "DELIVERED", "CANCELLED", "RETURNED"];
const uuid = value => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const nullableText = value => value === null || typeof value === "string";
const date = value => typeof value === "string" && Number.isFinite(Date.parse(value));
const money = value => typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value);
function invalid() { throw new Error("La respuesta de ventas no es válida. Puedes reintentar."); }
function sale(value) {
  return object(value) && uuid(value.id) && saleStatuses.includes(value.status)
    && Number.isSafeInteger(value.version) && value.version > 0
    && typeof value.currency === "string" && /^[A-Z]{3}$/.test(value.currency)
    && money(value.total) && date(value.createdAt)
    && (value.sourceOrderId === null || uuid(value.sourceOrderId))
    && nullableText(value.customerNameSnapshot) && nullableText(value.customerName);
}
export function parseCustomerSearch(value, page) {
  if (!object(value) || value.success !== true || value.page !== page || value.pageSize !== 25
    || typeof value.hasMore !== "boolean" || !Array.isArray(value.customers) || value.customers.length > 25
    || !value.customers.every(c => object(c) && uuid(c.id) && typeof c.fullName === "string"
      && (c.archivedAt === null || date(c.archivedAt)))
    || new Set(value.customers.map(c => c.id)).size !== value.customers.length) invalid();
  return { customers: value.customers.map(({ id, fullName, archivedAt }) => ({ id, fullName, archivedAt })), hasMore: value.hasMore };
}
export function parseCustomerSales(value, customerId, status, cursor) {
  if (!object(value) || value.success !== true || !object(value.customer)
    || value.customer.id !== customerId || typeof value.customer.fullName !== "string"
    || !(value.customer.archivedAt === null || date(value.customer.archivedAt))
    || !Array.isArray(value.sales) || value.sales.length > 25
    || !value.sales.every(s => sale(s) && s.id !== cursor && (status === "all" || s.status === status))
    || new Set(value.sales.map(s => s.id)).size !== value.sales.length
    || !(value.nextCursor === null || (uuid(value.nextCursor) && value.sales.length === 25 && value.nextCursor === value.sales.at(-1)?.id))) invalid();
  return value;
}
export function parseCustomerSaleDetail(value, saleId, customerId) {
  const s = object(value) ? value.result : null;
  if (!sale(s) || s.id !== saleId || s.customerId !== customerId
    || !nullableText(s.customerPhoneSnapshot) || !nullableText(s.customerEmailSnapshot)
    || !nullableText(s.customerPhone) || !Array.isArray(s.lines)
    || !s.lines.every(l => object(l) && uuid(l.id) && typeof l.itemName === "string"
      && typeof l.sku === "string" && Number.isSafeInteger(l.quantity) && l.quantity > 0
      && money(l.unitPrice) && money(l.unitDiscount) && money(l.lineTotal))
    || new Set(s.lines.map(l => l.id)).size !== s.lines.length) invalid();
  return s;
}
export function formatHistoricalMoney(value, currency) {
  return new Intl.NumberFormat("es-CO", { style: "currency", currency, maximumFractionDigits: 0 }).format(BigInt(value));
}
