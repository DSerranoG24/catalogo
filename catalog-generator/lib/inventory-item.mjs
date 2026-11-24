const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const integer = value => Number.isInteger(value) && value >= 0 && value <= 2147483647;
const version = value => Number.isSafeInteger(value) && value > 0;
const money = value => typeof value === "string" && /^(0|[1-9][0-9]{0,18})$/.test(value) && BigInt(value) <= 9223372036854775807n;
export function parseInventoryItemReply(value, id) {
  const item = object(value) ? value.result : null;
  const terms = object(item) ? item.commercialTerms : undefined;
  if (!object(item) || item.id !== id || typeof item.name !== "string" || !item.name.trim() || item.name.length > 160
    || typeof item.sku !== "string" || !item.sku.trim() || item.sku.length > 80
    || !integer(item.stock) || !integer(item.minimumStock) || !version(item.dataVersion) || !version(item.stockVersion)
    || !(terms === null || (object(terms) && terms.currency === "COP" && version(terms.version)
      && money(terms.unitSalePrice) && (terms.referenceUnitCost === null || money(terms.referenceUnitCost))))) {
    throw new Error("No se pudo validar la ficha de inventario. Recarga antes de guardar.");
  }
  return item;
}
