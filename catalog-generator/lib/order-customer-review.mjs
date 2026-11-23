const uuid = value => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const object = value => typeof value === "object" && value !== null && !Array.isArray(value);
const optionalText = value => value === null || typeof value === "string";
const match = value => object(value) && uuid(value.id) && typeof value.fullName === "string" && typeof value.phone === "string" && optionalText(value.email);
export function parseOrderCustomerMatches(value) {
  if (!Array.isArray(value) || value.length > 25 || !value.every(match)) throw new Error("No se pudo validar la lista de coincidencias.");
  return value;
}
export function parseOrderCustomerPreview(value) {
  if (!object(value) || !object(value.fields) || !["fullName", "phone"].every(field => typeof value.fields[field] === "string")
    || !["email", "address", "notes"].every(field => optionalText(value.fields[field]))
    || !Array.isArray(value.invalidFields) || !value.invalidFields.every(field => typeof field === "string")
    || !(value.customerId === null || uuid(value.customerId)) || typeof value.hasMore !== "boolean"
    || !(value.sale === null || (object(value.sale) && uuid(value.sale.id) && (value.sale.customerId === null || uuid(value.sale.customerId))))
    || !(value.existingCustomer === null || (match(value.existingCustomer) && optionalText(value.existingCustomer.archivedAt)))) throw new Error("No se pudo validar la revisión del pedido.");
  parseOrderCustomerMatches(value.matches);
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
