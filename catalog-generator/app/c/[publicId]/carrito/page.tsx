import PublicShoppingCartPage from "@/components/public/PublicShoppingCartPage";

export default async function SharedCatalogCartPage({
  params,
}: {
  params: Promise<{ publicId: string }>;
}) {
  const { publicId } = await params;
  return <PublicShoppingCartPage publicId={publicId} />;
}