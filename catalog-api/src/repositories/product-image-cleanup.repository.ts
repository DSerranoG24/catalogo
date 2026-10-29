import { Prisma } from "@prisma/client";
import { assertOwnedStoragePath } from "../services/account-closure-worker";

const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const productPath = new RegExp(`^${uuid}/${uuid}/${uuid}\\.(?:jpeg|jpg|png|webp)$`, "i");

export function assertProductImagePath(path: string, catalogId: string) {
  assertOwnedStoragePath(path, [catalogId]);
  if (!productPath.test(path)) throw new Error("INVALID_PRODUCT_CLEANUP_PATH");
}

export async function enqueueProductImages(tx: Prisma.TransactionClient, catalogId: string, images: { url: string }[]) {
  for (const image of images) assertProductImagePath(image.url, catalogId);
  if (!images.length) return;
  await tx.productImageCleanupTask.createMany({
    data: images.map(image => ({ catalogId, path: image.url, bucket: "product-images" })),
    skipDuplicates: true,
  });
}

export async function enqueueDeletedProductImages(tx: Prisma.TransactionClient, catalogId: string, productIds: string[]) {
  const images = await tx.productImage.findMany({
    where: { productId: { in: productIds }, product: { catalogId } }, select: { url: true },
  });
  await enqueueProductImages(tx, catalogId, images);
}
