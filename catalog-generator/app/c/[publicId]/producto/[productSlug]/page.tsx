import CatalogUnavailable from "@/components/public/CatalogUnavailable";
import type { Metadata } from "next";
import PublicProductDetailPage from "@/components/public/PublicProductDetailPage";
import { CatalogUnavailableError, requirePublicCatalog, requirePublicProduct } from "@/lib/public-catalog.server";
import { publicMetadata } from "@/lib/public-metadata";
type Props = { params: Promise<{ publicId: string; productSlug: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { publicId, productSlug } = await params;
  try {
    const catalog = await requirePublicCatalog(publicId);
    const product = requirePublicProduct(catalog, productSlug);
    return publicMetadata(publicId, `${product.name} | ${catalog.name}`, product.description?.trim() || `Descubre ${product.name} en ${catalog.name}.`, productSlug);
  } catch (error) {
    if (!(error instanceof CatalogUnavailableError)) throw error;
    return { title: "Catálogo temporalmente no disponible", robots: { index: false, follow: false } };
  }
}
export default async function SharedProductPage({ params }: Props) {
  const { publicId, productSlug } = await params;
  let catalog;
  try {
    catalog = await requirePublicCatalog(publicId);
  } catch (error) {
    if (!(error instanceof CatalogUnavailableError)) throw error;
    return <CatalogUnavailable href={`/c/${encodeURIComponent(publicId)}/producto/${encodeURIComponent(productSlug)}`} />;
  }
  const product = requirePublicProduct(catalog, productSlug);
  return <PublicProductDetailPage key={`${publicId}/${productSlug}`} publicId={publicId} initialCatalog={catalog} initialProduct={product} />;
}
