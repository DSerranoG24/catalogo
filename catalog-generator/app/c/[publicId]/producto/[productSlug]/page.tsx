import PublicProductDetailPage from "@/components/public/PublicProductDetailPage";

export default async function SharedProductPage({
  params,
}: {
  params: Promise<{ publicId: string; productSlug: string }>;
}) {
  const { publicId, productSlug } = await params;
  return <PublicProductDetailPage publicId={publicId} productSlug={productSlug} />;
}