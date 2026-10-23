import assert from "node:assert/strict";
import test from "node:test";
import { ReviewStatus } from "@prisma/client";
import {
  buildPendingProductReviewData,
  buildProductReviewModerationUpdate,
} from "../repositories/product-review.repository";
import { createProductReviewSchema, moderateProductReviewSchema } from "./product-review.schema";

test("accepts a bounded customer review", () => {
  const result = createProductReviewSchema.safeParse({
    displayName: "Lina",
    rating: 5,
    comment: "Excelente calidad y llego en buen estado.",
  });
  assert.equal(result.success, true);
});

test("rejects ratings and comments outside the review schema limits", () => {
  assert.equal(createProductReviewSchema.safeParse({ rating: 0, comment: "Me gusta mucho." }).success, false);
  assert.equal(createProductReviewSchema.safeParse({ rating: 6, comment: "Me gusta mucho." }).success, false);
  assert.equal(createProductReviewSchema.safeParse({ rating: 4, comment: "corto" }).success, false);
  assert.equal(createProductReviewSchema.safeParse({ rating: 4, comment: "x".repeat(1201) }).success, false);
});

test("only accepts approved or rejected moderation statuses", () => {
  assert.equal(moderateProductReviewSchema.safeParse({ status: ReviewStatus.APPROVED }).success, true);
  assert.equal(moderateProductReviewSchema.safeParse({ status: ReviewStatus.REJECTED }).success, true);
  assert.equal(moderateProductReviewSchema.safeParse({ status: ReviewStatus.PENDING }).success, false);
});

test("builds new public reviews in the pending state", () => {
  const data = buildPendingProductReviewData({
    productId: "product-id",
    rating: 5,
    comment: "Excelente calidad y llego en buen estado.",
  });

  assert.deepEqual(data, {
    productId: "product-id",
    displayName: null,
    rating: 5,
    comment: "Excelente calidad y llego en buen estado.",
    status: ReviewStatus.PENDING,
  });
});

test("scopes approved and rejected review updates to the authenticated catalog owner", () => {
  const approvedUpdate = buildProductReviewModerationUpdate("review-id", "owner-id", ReviewStatus.APPROVED);
  const rejectedUpdate = buildProductReviewModerationUpdate("review-id", "another-owner-id", ReviewStatus.REJECTED);

  assert.deepEqual(approvedUpdate, {
    where: { id: "review-id", product: { catalog: { userId: "owner-id" } } },
    data: { status: ReviewStatus.APPROVED },
  });
  assert.deepEqual(rejectedUpdate, {
    where: { id: "review-id", product: { catalog: { userId: "another-owner-id" } } },
    data: { status: ReviewStatus.REJECTED },
  });
});
