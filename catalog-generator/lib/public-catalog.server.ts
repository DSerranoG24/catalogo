import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import type { PublicCatalog, PublicProduct, Category } from "./api";

export class CatalogUnavailableError extends Error {
  constructor() { super("El catálogo no está disponible temporalmente. Intenta de nuevo."); }
}
const record = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const text = (v: unknown): v is string => typeof v === "string";
const optionalText = (v: unknown) => v === null || text(v);
const number = (v: unknown) => typeof v === "number" && Number.isFinite(v);
function category(v: unknown): v is Category {
  return record(v) && text(v.id) && text(v.name) && text(v.slug) && optionalText(v.imageUrl) && number(v.position);
}
function product(v: unknown): v is PublicProduct {
  return record(v) && [v.id, v.name, v.slug].every(text)
    && [v.description, v.brand, v.model, v.categoryId, v.saleEndsAt].every(optionalText)
    && number(v.price) && (v.regularPrice === null || number(v.regularPrice))
    && (v.discountPercent === null || number(v.discountPercent))
    && (v.category === null || (record(v.category) && text(v.category.id) && text(v.category.name)))
    && Array.isArray(v.images) && v.images.every(i => record(i) && text(i.id) && text(i.url) && optionalText(i.alt));
}
function catalog(v: unknown): v is PublicCatalog {
  return record(v) && [v.publicId, v.name, v.slug].every(text)
    && [v.description, v.logoUrl, v.whatsappPhone, v.whatsappMessage, v.phone, v.address,
      v.businessHours, v.instagramUrl, v.facebookUrl, v.tiktokUrl, v.email, v.mapUrl].every(optionalText)
    && ["TECH", "FASHION", "BEAUTY", "GLAMOUR", "EDITORIAL", "GRID", "BOUTIQUE"].includes(String(v.template))
    && (v.themePreset === undefined || optionalText(v.themePreset))
    && Array.isArray(v.categories) && v.categories.every(category)
    && Array.isArray(v.products) && v.products.every(product);
}

// Request-scoped only: metadata and page share one read; archive/logo changes need no cache purge.
export const readPublicCatalog = cache(async (publicId: string): Promise<PublicCatalog | null> => {
  if (!publicId || publicId.length > 200) return null;
  const base = process.env.NEXT_PUBLIC_CATALOG_API_URL ?? "http://localhost:3000/api";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`${base.replace(/\/$/, "")}/public/catalogs/${encodeURIComponent(publicId)}`, {
      cache: "no-store", signal: controller.signal, redirect: "error", credentials: "omit",
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new CatalogUnavailableError();
    const body: unknown = await response.json();
    if (!record(body) || !catalog(body.catalog) || body.catalog.publicId !== publicId) throw new CatalogUnavailableError();
    return body.catalog;
  } catch { throw new CatalogUnavailableError(); }
  finally { clearTimeout(timer); }
});

export async function requirePublicCatalog(publicId: string) {
  const result = await readPublicCatalog(publicId);
  if (!result) notFound();
  return result;
}
export function requirePublicProduct(catalog: PublicCatalog, slug: string) {
  const result = catalog.products.find(p => p.slug === slug);
  if (!result) notFound();
  return result;
}
