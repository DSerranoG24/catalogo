import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import type { PublicCatalog } from "./api";
import { normalizePublicCatalog, publicRecord } from "./public-catalog-data";

export class CatalogUnavailableError extends Error {
  constructor() { super("El catálogo no está disponible temporalmente. Intenta de nuevo."); }
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
    const catalog = publicRecord(body) ? normalizePublicCatalog(body.catalog) : null;
    if (!catalog || catalog.publicId !== publicId) throw new CatalogUnavailableError();
    return catalog;
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
