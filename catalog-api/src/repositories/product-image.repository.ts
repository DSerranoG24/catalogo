import { prisma } from "../config/prisma";
import { lockCatalogWrites } from "./catalog-write-lock";
import { enqueueProductImages } from "./product-image-cleanup.repository";

export async function createProductImage(data: {
  productId: string;
  url: string;
  alt?: string;
  position?: number;
}) {
  return prisma.productImage.create({
    data,
  });
}

export async function findImagesByProduct(productId: string) {
  return prisma.productImage.findMany({
    where: {
      productId,
    },
    orderBy: {
      position: "asc",
    },
  });
}

export async function findProductImageById(
  id: string,
  userId: string
) {
  return prisma.productImage.findFirst({
    where: {
      id,
      product: {
        catalog: {
          userId,
        },
      },
    },
  });
}

export async function deleteProductImage(
  id: string,
  userId: string,
  database = prisma
) {
  return database.$transaction(async tx => {
    const image = await tx.productImage.findFirst({ where: { id, product: { catalog: { userId } } },
      include: { product: { select: { catalogId: true } } } });
    if (!image) return { count: 0 };
    await lockCatalogWrites(tx, image.product.catalogId, userId);
    const current = await tx.productImage.findFirst({ where: { id, product: { catalog: { userId } } } });
    if (!current) return { count: 0 };
    await enqueueProductImages(tx, image.product.catalogId, [current]);
    return tx.productImage.deleteMany({ where: { id, product: { catalog: { userId } } } });
  });
}
