export type FeaturedStatus = {
  selectedCount: number; validCount: number; visible: boolean; warning: string | null;
  products: { id: string; name: string; active: boolean }[];
};
export type CatalogBanner = {
  id: string; title: string; subtitle: string | null; linkType: "PRODUCT" | "CATEGORY" | "EXTERNAL";
  linkValue: string; position: number; active: boolean; imageUrl: string;
};
export const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const uuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export function safeExternalUrl(value: string) {
  try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password; } catch { return false; }
}
export function readFeaturedStatus(value: unknown): FeaturedStatus {
  if (!isRecord(value) || !Array.isArray(value.products) || value.products.length > 5) throw new Error("La respuesta de destacados no es válida.");
  const products = value.products.map(product => {
    if (!isRecord(product) || !uuid(product.id) || typeof product.name !== "string" || typeof product.active !== "boolean") throw new Error("La respuesta de destacados no es válida.");
    return { id: product.id, name: product.name, active: product.active };
  });
  const validCount = products.filter(product => product.active).length;
  if (new Set(products.map(product => product.id)).size !== products.length || value.selectedCount !== products.length || value.validCount !== validCount || value.visible !== (validCount >= 3) || (value.warning !== null && typeof value.warning !== "string")) throw new Error("El contador de destacados no es válido.");
  return { products, selectedCount: products.length, validCount, visible: validCount >= 3, warning: value.warning };
}
export function readBanners(value: unknown): CatalogBanner[] {
  if (!isRecord(value) || !Array.isArray(value.banners) || value.banners.length > 3) throw new Error("La respuesta de anuncios no es válida.");
  const banners = value.banners.map((banner): CatalogBanner => {
    if (!isRecord(banner) || !uuid(banner.id) || typeof banner.title !== "string" || (banner.subtitle !== null && typeof banner.subtitle !== "string") || typeof banner.linkValue !== "string" || typeof banner.position !== "number" || !Number.isInteger(banner.position) || banner.position < 0 || banner.position > 2 || typeof banner.active !== "boolean" || typeof banner.imageUrl !== "string" || !safeExternalUrl(banner.imageUrl)) throw new Error("Un anuncio recibido no es válido.");
    if (banner.linkType !== "PRODUCT" && banner.linkType !== "CATEGORY" && banner.linkType !== "EXTERNAL") throw new Error("Tipo de enlace no válido.");
    return { id: banner.id, title: banner.title, subtitle: banner.subtitle, linkType: banner.linkType, linkValue: banner.linkValue, position: banner.position, active: banner.active, imageUrl: banner.imageUrl };
  });
  if (new Set(banners.map(banner => banner.id)).size !== banners.length || new Set(banners.map(banner => banner.position)).size !== banners.length) throw new Error("La ordenación recibida no es válida.");
  return banners.sort((a, b) => a.position - b.position);
}
export function readSuggestions(value: unknown): { id: string; name: string }[] {
  if (!isRecord(value) || !Array.isArray(value.products) || value.products.length > 5) throw new Error("La búsqueda recibida no es válida.");
  return value.products.map(product => {
    if (!isRecord(product) || !uuid(product.id) || typeof product.name !== "string") throw new Error("El producto recibido no es válido.");
    return { id: product.id, name: product.name };
  });
}
