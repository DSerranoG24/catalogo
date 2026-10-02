import assert from "node:assert/strict";
import test from "node:test";
import { getCurrentProductPricing, validateProductPromotion } from "./product-pricing";

const startsAt = new Date("2026-10-01T12:00:00.000Z");
const endsAt = new Date("2026-10-08T12:00:00.000Z");
const promotion = { price: 100_000, salePrice: 80_000, saleStartsAt: startsAt, saleEndsAt: endsAt };

test("uses the normal price before and at the promotion end", () => {
  assert.equal(getCurrentProductPricing(promotion, new Date("2026-10-01T11:59:59.999Z")).price, 100_000);
  assert.equal(getCurrentProductPricing(promotion, endsAt).price, 100_000);
});

test("activates the configured sale price and derives its discount", () => {
  assert.deepEqual(getCurrentProductPricing(promotion, startsAt), {
    price: 80_000,
    regularPrice: 100_000,
    discountPercent: 20,
    saleEndsAt: endsAt.toISOString(),
  });
});

test("rejects prices, dates, or ranges that cannot describe a real discount", () => {
  assert.throws(() => validateProductPromotion({ ...promotion, salePrice: 100_000 }), { message: "INVALID_PRODUCT_PROMOTION" });
  assert.throws(() => validateProductPromotion({ ...promotion, saleStartsAt: null }), { message: "INVALID_PRODUCT_PROMOTION" });
  assert.throws(() => validateProductPromotion({ ...promotion, saleStartsAt: endsAt }), { message: "INVALID_PRODUCT_PROMOTION" });
  assert.throws(() => validateProductPromotion({ ...promotion, salePrice: null }), { message: "INVALID_PRODUCT_PROMOTION" });
  assert.doesNotThrow(() => validateProductPromotion({ price: 100_000, salePrice: null, saleStartsAt: null, saleEndsAt: null }));
});