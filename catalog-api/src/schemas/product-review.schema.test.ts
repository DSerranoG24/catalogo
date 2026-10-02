import assert from "node:assert/strict";
import test from "node:test";
import { createProductReviewSchema, moderateProductReviewSchema } from "./product-review.schema";

test("accepts a bounded customer review", () => {
  const result = createProductReviewSchema.safeParse({ displayName: "Lina", rating: 5, comment: "Muy buena calidad y llegó en buen estado." });
  assert.equal(result.success, true);
});

test("rejects invalid ratings, empty comments, and oversized content", () => {
  assert.equal(createProductReviewSchema.safeParse({ rating: 0, comment: "Me gusta mucho." }).success, false);
  assert.equal(createProductReviewSchema.safeParse({ rating: 6, comment: "Me gusta mucho." }).success, false);
  assert.equal(createProductReviewSchema.safeParse({ rating: 4, comment: "corto" }).success, false);
  assert.equal(createProductReviewSchema.safeParse({ rating: 4, comment: "x".repeat(1201) }).success, false);
});

test("allows sellers to approve or reject, never assign pending from the public UI", () => {
  assert.equal(moderateProductReviewSchema.safeParse({ status: "APPROVED" }).success, true);
  assert.equal(moderateProductReviewSchema.safeParse({ status: "REJECTED" }).success, true);
  assert.equal(moderateProductReviewSchema.safeParse({ status: "PENDING" }).success, false);
});