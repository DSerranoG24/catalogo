import { ReviewStatus } from "@prisma/client";
import { prisma } from "../config/prisma";

export async function findPublicProductReviews(publicId: string, productSlug: string) {
  const product = await prisma.product.findFirst({
    where: { slug: productSlug, active: true, catalog: { publicId, active: true } },
    select: { id: true },
  });
  if (!product) return null;

  const [summary, reviews] = await Promise.all([
    prisma.productReview.aggregate({
      where: { productId: product.id, status: ReviewStatus.APPROVED },
      _avg: { rating: true },
      _count: { id: true },
    }),
    prisma.productReview.findMany({
      where: { productId: product.id, status: ReviewStatus.APPROVED },
      select: { id: true, displayName: true, rating: true, comment: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
  ]);

  return { averageRating: summary._avg.rating, reviewCount: summary._count.id, reviews };
}

export async function createPendingProductReview(data: {
  productId: string;
  displayName?: string;
  rating: number;
  comment: string;
}) {
  return prisma.productReview.create({
    data: {
      ...data,
      displayName: data.displayName || null,
      status: ReviewStatus.PENDING,
    },
    select: { id: true, status: true, createdAt: true },
  });
}

export async function findProductForPublicReview(publicId: string, productSlug: string) {
  return prisma.product.findFirst({
    where: { slug: productSlug, active: true, catalog: { publicId, active: true } },
    select: { id: true },
  });
}

export async function findReviewsForCatalog(catalogId: string, userId: string, status?: ReviewStatus) {
  return prisma.productReview.findMany({
    where: { product: { catalogId, catalog: { userId } }, ...(status ? { status } : {}) },
    select: {
      id: true,
      displayName: true,
      rating: true,
      comment: true,
      status: true,
      createdAt: true,
      product: { select: { id: true, name: true } },
    },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 200,
  });
}

export async function moderateProductReview(reviewId: string, userId: string, status: ReviewStatus) {
  return prisma.productReview.updateMany({
    where: { id: reviewId, product: { catalog: { userId } } },
    data: { status },
  });
}

export async function deleteProductReview(reviewId: string, userId: string) {
  return prisma.productReview.deleteMany({
    where: { id: reviewId, product: { catalog: { userId } } },
  });
}