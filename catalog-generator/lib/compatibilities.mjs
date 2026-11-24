export const compatibilityStates = ["PENDING", "VERIFIED", "REJECTED", "WITHDRAWN"];
export const evidenceTypes = ["SELLER_TEST", "MANUFACTURER_REFERENCE", "SUPPLIER_REFERENCE", "DOCUMENTED_REVIEW"];
const object = v => v !== null && typeof v === "object" && !Array.isArray(v);
const uuid = v => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const version = v => Number.isSafeInteger(v) && v > 0 && v <= 2147483647;
const date = v => typeof v === "string" && Number.isFinite(Date.parse(v));
const optionalDate = v => v === null || date(v);
const text = v => v === null || typeof v === "string";
const brand = v => object(v) && uuid(v.id) && typeof v.name === "string" && version(v.version) && optionalDate(v.retiredAt);
const model = v => brand(v) && uuid(v.brandId) && typeof v.brandName === "string" && optionalDate(v.brandRetiredAt) && text(v.manufacturerCode);
const relation = v => object(v) && uuid(v.id) && version(v.version) && compatibilityStates.includes(v.status)
  && object(v.model) && uuid(v.model.id) && typeof v.model.name === "string" && text(v.model.manufacturerCode) && optionalDate(v.model.retiredAt)
  && object(v.model.brand) && uuid(v.model.brand.id) && typeof v.model.brand.name === "string" && optionalDate(v.model.brand.retiredAt)
  && (v.evidenceType === null || evidenceTypes.includes(v.evidenceType)) && [v.evidenceReference,v.note,v.reviewReason].every(text)
  && date(v.createdAt) && date(v.updatedAt) && optionalDate(v.verifiedAt)
  && (v.status === "VERIFIED" ? date(v.verifiedAt) && v.evidenceType !== null && Boolean(v.evidenceReference || v.note) : v.verifiedAt === null);
function invalid() { throw new Error("No se pudo validar la respuesta de compatibilidades. Recarga antes de continuar."); }
function page(v, expectedPage) {
  return object(v) && v.success === true && v.page === expectedPage && v.pageSize === 25 && typeof v.hasMore === "boolean";
}
export function parseDevicePage(value, kind, expectedPage, brandId) {
  if (!page(value,expectedPage) || !Array.isArray(value.items) || value.items.length > 25
    || !value.items.every(v => kind === "brand" ? brand(v) : model(v) && v.brandId === brandId)
    || new Set(value.items.map(v => v.id)).size !== value.items.length) invalid();
  return value;
}
export function parseDeviceMutation(value, kind) {
  const result = object(value) ? value.result : null;
  if (value?.success !== true || !object(result) || typeof result.idempotent !== "boolean" || !(kind === "brand" ? brand(result.entity) : model(result.entity))) invalid();
  return result.entity;
}
export function parseCompatibilityPage(value, itemId, expectedPage, status) {
  if (!page(value,expectedPage) || !object(value.source) || value.source.kind !== "INVENTORY_ITEM" || value.source.id !== itemId
    || !(value.set === null || object(value.set) && uuid(value.set.id) && version(value.set.version))
    || !Array.isArray(value.compatibilities) || value.compatibilities.length > 25
    || !value.compatibilities.every(v => relation(v) && (status === "all" || v.status === status))
    || new Set(value.compatibilities.map(v => v.id)).size !== value.compatibilities.length
    || (value.set === null && value.compatibilities.length)) invalid();
  return value;
}
export function parseCompatibilityMutation(value, expectedModelId, expectedId) {
  const r = object(value) ? value.result : null;
  if (value?.success !== true || !object(r) || !relation(r.compatibility) || !version(r.setVersion) || typeof r.idempotent !== "boolean"
    || r.compatibility.model.id !== expectedModelId || expectedId && r.compatibility.id !== expectedId) invalid();
  return r;
}
export function parseCompatibilityEvents(value, expectedPage) {
  if (!page(value,expectedPage) || !Array.isArray(value.items) || value.items.length > 25
    || !value.items.every(v => object(v) && uuid(v.id) && uuid(v.actorId) && uuid(v.entityId) && typeof v.entityKind === "string"
      && typeof v.eventType === "string" && (v.before === null || object(v.before)) && object(v.after) && date(v.occurredAt))) invalid();
  return value;
}
