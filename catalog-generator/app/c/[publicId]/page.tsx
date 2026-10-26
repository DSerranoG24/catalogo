import CatalogUnavailable from "@/components/public/CatalogUnavailable";
import type { Metadata } from "next";
import PublicCatalogPage from "@/components/public/PublicCatalogPage";
import { CatalogUnavailableError, requirePublicCatalog } from "@/lib/public-catalog.server";
import { publicMetadata } from "@/lib/public-metadata";
type Props = { params: Promise<{ publicId: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { publicId } = await params;
  try {
    const catalog = await requirePublicCatalog(publicId);
    return publicMetadata(publicId, catalog.name, catalog.description?.trim() || `Descubre los productos de ${catalog.name}.`);
  } catch (error) {
    if (!(error instanceof CatalogUnavailableError)) throw error;
    return { title: "Catálogo temporalmente no disponible", robots: { index: false, follow: false } };
  }
}
export default async function SharedCatalogPage({ params }: Props) {
  const { publicId } = await params;
  let catalog;
  try {
    catalog = await requirePublicCatalog(publicId);
  } catch (error) {
    if (!(error instanceof CatalogUnavailableError)) throw error;
    return <CatalogUnavailable href={`/c/${encodeURIComponent(publicId)}`} />;
  }
  const themeStyle = catalog.themePreset
    ? (await import("@/lib/catalog-theme")).resolveCatalogTheme(catalog.template, catalog.themePreset)
    : undefined;
  return <PublicCatalogPage key={publicId} publicId={publicId} initialCatalog={catalog} themeStyle={themeStyle} />;
}
