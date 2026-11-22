import assert from "node:assert/strict";
import {
  acceptPublicCartPrices,
  canSubmitPublicCart,
  hydratePublicCartPrices,
  parsePublicCart,
  reconcilePublicCart,
  serializePublicCart,
  setPublicCartQuantity,
} from "../lib/public-cart.mjs";

const product = (id, price) => ({ id, price, name: `Producto ${id}`, slug: `producto-${id}` });
const historicalId = "00000000-0000-4000-8000-000000000001";
const linkedId = "00000000-0000-4000-8000-000000000002";
const foreignId = "00000000-0000-4000-8000-000000000003";

const initial = setPublicCartQuantity(parsePublicCart(null), product(historicalId, 100), 2);
assert.deepEqual(reconcilePublicCart(initial, [product(historicalId, 100)]), {
  rows: [{ productId: historicalId, item: { quantity: 2, unitPrice: 100 }, product: product(historicalId, 100), unavailable: false, priceChanged: false, subtotal: 200 }],
  total: 200,
  hasPriceChanges: false,
  hasUnavailable: false,
});

for (const nextPrice of [80, 120]) {
  const changed = reconcilePublicCart(initial, [product(historicalId, nextPrice)]);
  assert.equal(changed.hasPriceChanges, true);
  assert.equal(canSubmitPublicCart(changed), false);
  assert.equal(changed.total, nextPrice * 2);
  const accepted = acceptPublicCartPrices(initial, [product(historicalId, nextPrice)]);
  const acceptedResult = reconcilePublicCart(accepted, [product(historicalId, nextPrice)]);
  assert.equal(acceptedResult.hasPriceChanges, false);
  assert.equal(canSubmitPublicCart(acceptedResult), true);
  assert.equal(accepted.items[historicalId].unitPrice, nextPrice);
}

const unavailable = reconcilePublicCart(initial, []);
assert.equal(unavailable.hasUnavailable, true);
assert.equal(canSubmitPublicCart(unavailable), false);
assert.equal(unavailable.rows[0].item.quantity, 2);
assert.equal(unavailable.total, 0);

const foreignCatalog = reconcilePublicCart(initial, [product(foreignId, 100)]);
assert.equal(foreignCatalog.hasUnavailable, true);
assert.equal(foreignCatalog.rows[0].product, null);

const legacy = hydratePublicCartPrices(parsePublicCart(JSON.stringify({ [linkedId]: 1 })), [product(linkedId, 500)]);
assert.equal(legacy.items[linkedId].unitPrice, 500);
assert.equal(reconcilePublicCart(legacy, [product(linkedId, 500)]).hasPriceChanges, false);
assert.deepEqual(parsePublicCart(serializePublicCart(legacy)), legacy);

console.log("PASS public cart price refresh, totals, explicit acceptance, unavailable products and catalog isolation");
