import CatalogUnavailable from "@/components/public/CatalogUnavailable";
import { CatalogUnavailableError, requirePublicCatalog, requirePublicProduct } from "@/lib/public-catalog.server";

// Validate before the child loading boundary can send a successful streamed response.
export default async function ProductLayout({ children, params }: {
  children: React.ReactNode;
  params: Promise<{ publicId: string; productSlug: string }>;
}) {
  const { publicId, productSlug } = await params;
  try {
    requirePublicProduct(await requirePublicCatalog(publicId), productSlug);
    return children;
  } catch (error) {
    if (!(error instanceof CatalogUnavailableError)) throw error;
    return <CatalogUnavailable href={`/c/${encodeURIComponent(publicId)}/producto/${encodeURIComponent(productSlug)}`} />;
  }
}
