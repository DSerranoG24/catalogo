import assert from "node:assert/strict";
import test from "node:test";
import { resolvePublicProductPrice } from "./public-product-price";

test("public price resolver preserves historical products and resolves owned inventory sources", () => {
  assert.equal(resolvePublicProductPrice({ price: 900, inventoryItem: null, publication: null }, "owner"), 900);
  assert.equal(resolvePublicProductPrice({ price: 1, inventoryItem: { userId: "owner", commercialTerms: { userId: "owner", unitSalePrice: 1200n } }, publication: { userId: "owner", priceOverride: 1500 } }, "owner"), 1500);
  assert.equal(resolvePublicProductPrice({ price: 1, inventoryItem: { userId: "owner", commercialTerms: { userId: "owner", unitSalePrice: 1200n } }, publication: { userId: "owner", priceOverride: null } }, "owner"), 1200);
  assert.equal(resolvePublicProductPrice({ price: 1, inventoryItem: { userId: "other", commercialTerms: { userId: "other", unitSalePrice: 1200n } }, publication: null }, "owner"), null);
  assert.equal(resolvePublicProductPrice({ price: 1, inventoryItem: { userId: "owner", commercialTerms: null }, publication: null }, "owner"), null);
});
