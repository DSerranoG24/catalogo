import PublicCatalogPage from "@/components/public/PublicCatalogPage";

export default async function SharedCatalogPage({
  params,
}: {
  params: Promise<{ publicId: string }>;
}) {
  const { publicId } = await params;
  return <PublicCatalogPage publicId={publicId} />;
}