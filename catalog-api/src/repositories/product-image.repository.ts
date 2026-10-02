import { prisma } from "../config/prisma";

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
  userId: string
) {
  return prisma.productImage.deleteMany({
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