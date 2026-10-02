import { ReviewStatus } from "@prisma/client";
import {
  createPendingProductReview,
  deleteProductReview,
  findProductForPublicReview,
  findPublicProductReviews,
  findReviewsForCatalog,
  moderateProductReview as moderateReviewRepository,
} from "../repositories/product-review.repository";

export async function getPublicProductReviews(publicId: string, productSlug: string) {
  return findPublicProductReviews(publicId, productSlug);
}

export async function submitProductReview(data: {
  publicId: string;
  productSlug: string;
  displayName?: string;
  rating: number;
  comment: string;
}) {
  const product = await findProductForPublicReview(data.publicId, data.productSlug);
  if (!product) throw new Error("PRODUCT_NOT_FOUND");
  return createPendingProductReview({
    productId: product.id,
    displayName: data.displayName,
    rating: data.rating,
    comment: data.comment,
  });
}

export async function getReviewsForCatalog(catalogId: string, userId: string, status?: ReviewStatus) {
  return findReviewsForCatalog(catalogId, userId, status);
}

export async function setProductReviewStatus(reviewId: string, userId: string, status: ReviewStatus) {
  return moderateReviewRepository(reviewId, userId, status);
}

export async function removeProductReview(reviewId: string, userId: string) {
  return deleteProductReview(reviewId, userId);
}