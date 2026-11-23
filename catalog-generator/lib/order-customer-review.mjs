const uuid = value => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const object = value => typeof value === "object" && value !== null && !Array.isArray(value);
const optionalText = value => value === null || typeof value === "string";
const match = value => object(value) && uuid(value.id) && typeof value.fullName === "string" && value.fullName.trim().length > 0 && typeof value.phone === "string" && /^[0-9]{7,15}$/.test(value.phone) && optionalText(value.email);
export const sameReviewPhone = (a, b) => a.replace(/[^0-9]/g, "") === b.replace(/[^0-9]/g, "");
export function canReviewOrderCustomer(order) {
  return object(order) && ["PENDING", "CONFIRMED", "COMPLETED"].includes(order.status) && !order.anonymizedAt
    && typeof order.customerName === "string" && order.customerName.trim().length > 0
    && typeof order.customerPhone === "string" && order.customerPhone.replace(/[^0-9]/g, "").length >= 7;
}
export function parseOrderCustomerMatches(value) {
  if (!Array.isArray(value) || value.length > 25 || !value.every(match) || new Set(value.map(row => row.id)).size !== value.length) throw new Error("No se pudo validar la lista de coincidencias.");
  return value;
}
export function parseOrderCustomerMatchPage(value, phone, page) {
  if (!object(value) || value.page !== page || typeof value.hasMore !== "boolean") throw new Error("No se pudo validar la página de coincidencias.");
  const matches = parseOrderCustomerMatches(value.matches);
  if (matches.some(row => !sameReviewPhone(row.phone, phone)) || (!matches.length && value.hasMore)) throw new Error("No se pudo validar la página de coincidencias.");
  return { matches, hasMore: value.hasMore, page };
}
export function parseOrderCustomerPreview(value) {
  if (!object(value) || !object(value.fields) || !["fullName", "phone"].every(field => typeof value.fields[field] === "string")
    || !["email", "address", "notes"].every(field => optionalText(value.fields[field]))
    || !Array.isArray(value.invalidFields) || !value.invalidFields.every(field => typeof field === "string")
    || !(value.customerId === null || uuid(value.customerId)) || typeof value.hasMore !== "boolean"
    || !(value.sale === null || (object(value.sale) && uuid(value.sale.id) && (value.sale.customerId === null || uuid(value.sale.customerId))))
    || !(value.existingCustomer === null || (match(value.existingCustomer) && optionalText(value.existingCustomer.archivedAt)))) throw new Error("No se pudo validar la revisión del pedido.");
  const matches = parseOrderCustomerMatches(value.matches);
  if (matches.some(row => !sameReviewPhone(row.phone, value.fields.phone)) || (!matches.length && value.hasMore)
    || (value.existingCustomer !== null && value.existingCustomer.id !== value.customerId)) throw new Error("No se pudo validar la revisión del pedido.");
  return value;
}
export function orderCustomerCommand(fields, associateSale, selected = null) {
  return selected ? { action: "USE_EXISTING", customerId: selected.id, phone: selected.phone, associateSale }
    : { action: "CREATE", customer: { fullName: fields.fullName, phone: fields.phone, email: fields.email, address: fields.address, notes: fields.notes }, associateSale };
}
export function parseOrderCustomerResult(value, orderId) {
  if (!object(value) || !object(value.customer) || !uuid(value.customer.id) || value.orderId !== orderId
    || !uuid(value.orderId) || !(value.associatedSaleId === null || uuid(value.associatedSaleId)) || typeof value.idempotent !== "boolean") throw new Error("No se pudo validar la confirmación. Reintenta con los mismos datos.");
  return value;
}
