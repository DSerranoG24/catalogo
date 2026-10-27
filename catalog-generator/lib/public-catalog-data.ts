import { normalizeCatalogLayout } from "./catalog-layout";
import type { PublicCatalog, PublicProduct, PublicCatalogBanner, Category } from "./api";

export const publicRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === "string";
const optionalText = (v: unknown) => v === null || text(v);
const number = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
function category(v: unknown): v is Category {
  return publicRecord(v) && text(v.id) && text(v.name) && text(v.slug) && optionalText(v.imageUrl) && number(v.position);
}
function product(v: unknown): v is PublicProduct {
  return publicRecord(v) && [v.id, v.name, v.slug].every(text)
    && [v.description, v.brand, v.model, v.categoryId, v.saleEndsAt].every(optionalText)
    && number(v.price) && (v.regularPrice === null || number(v.regularPrice))
    && (v.discountPercent === null || number(v.discountPercent))
    && (v.category === null || (publicRecord(v.category) && text(v.category.id) && text(v.category.name)))
    && Array.isArray(v.images) && v.images.every(i => publicRecord(i) && text(i.id) && text(i.url) && optionalText(i.alt));
}
function baseCatalog(v: unknown): v is Omit<PublicCatalog, "banners" | "featuredProducts"> {
  return publicRecord(v) && [v.publicId, v.name, v.slug].every(text)
    && [v.description, v.logoUrl, v.whatsappPhone, v.whatsappMessage, v.phone, v.address,
      v.businessHours, v.instagramUrl, v.facebookUrl, v.tiktokUrl, v.email, v.mapUrl].every(optionalText)
    && ["TECH", "FASHION", "BEAUTY", "GLAMOUR", "EDITORIAL", "GRID", "BOUTIQUE"].includes(String(v.template))
    && (v.themePreset === undefined || optionalText(v.themePreset))
    && Array.isArray(v.categories) && v.categories.every(category)
    && Array.isArray(v.products) && v.products.every(product);
}
function httpUrl(value: unknown): value is string {
  if (!text(value)) return false;
  try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password; } catch { return false; }
}
function banner(v: unknown): v is PublicCatalogBanner {
  return publicRecord(v) && text(v.id) && v.id.length > 0 && text(v.title) && v.title.trim().length > 0 && v.title.length <= 150
    && optionalText(v.subtitle) && (v.subtitle === null || (text(v.subtitle) && v.subtitle.length <= 300))
    && httpUrl(v.imageUrl) && ["PRODUCT", "CATEGORY", "EXTERNAL"].includes(String(v.linkType))
    && text(v.linkValue) && v.linkValue.length > 0 && v.linkValue.length <= 2048
    && number(v.position) && Number.isInteger(v.position) && v.position >= 0 && v.position <= 2;
}
export function normalizePublicCatalog(value: unknown): PublicCatalog | null {
  if (!publicRecord(value)) return null;
  const rawFeatured = value.featuredProducts, rawBanners = value.banners;
  if (!baseCatalog(value)) return null;
  const products = new Map(value.products.map(item => [item.id, item]));
  const categoryIds = new Set(value.categories.map(item => item.id));
  const selected = new Map<string, PublicProduct>();
  if (Array.isArray(rawFeatured)) for (const entry of rawFeatured) {
    if (!product(entry)) continue;
    const canonical = products.get(entry.id);
    if (canonical && selected.size < 5) selected.set(entry.id, canonical);
  }
  const banners: PublicCatalogBanner[] = [], seen = new Set<string>(), positions = new Set<number>();
  const candidates = Array.isArray(rawBanners) ? rawBanners.filter(banner).sort((a, b) => a.position - b.position) : [];
  for (const entry of candidates) {
    if (seen.has(entry.id) || positions.has(entry.position)) continue;
    if (entry.linkType === "PRODUCT" ? !products.has(entry.linkValue) : entry.linkType === "CATEGORY" ? !categoryIds.has(entry.linkValue) : !httpUrl(entry.linkValue)) continue;
    seen.add(entry.id); positions.add(entry.position);
    banners.push({ id: entry.id, title: entry.title, subtitle: entry.subtitle, imageUrl: entry.imageUrl, linkType: entry.linkType, linkValue: entry.linkValue, position: entry.position });
    if (banners.length === 3) break;
  }
  return { ...value, layoutPreset: normalizeCatalogLayout(value.layoutPreset), banners, featuredProducts: selected.size >= 3 ? [...selected.values()] : [] };
}
