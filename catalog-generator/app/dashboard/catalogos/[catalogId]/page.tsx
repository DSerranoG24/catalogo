import CatalogWorkspace from "@/components/catalogs/CatalogWorkspace";

export default async function CatalogPage({
  params,
}: {
  params: Promise<{ catalogId: string }>;
}) {
  const { catalogId } = await params;
  return <CatalogWorkspace catalogId={catalogId} />;
}