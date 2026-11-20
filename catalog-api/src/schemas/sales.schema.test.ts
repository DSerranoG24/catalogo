import test from "node:test";
import assert from "node:assert/strict";
import { confirmSaleSchema, returnSaleSchema, saleLineInputSchema } from "./sales.schema";
import { randomUUID } from "node:crypto";
test("sales schemas require positive quantities and integer COP money", () => {
  const valid = { inventoryItemId: randomUUID(), quantity: 2, unitDiscount: "100" };
  assert.equal(saleLineInputSchema.safeParse(valid).success, true);
  for (const quantity of [0, -1, 1.5]) assert.equal(saleLineInputSchema.safeParse({ ...valid, quantity }).success, false);
  assert.equal(saleLineInputSchema.safeParse({ ...valid, unitDiscount: "1.5" }).success, false);
});
test("sales transitions require operation and expected version", () => {
  assert.equal(confirmSaleSchema.safeParse({ operationId: randomUUID(), requestId: randomUUID(), expectedVersion: 1 }).success, true);
  assert.equal(confirmSaleSchema.safeParse({ operationId: randomUUID(), expectedVersion: 1 }).success, false);
});
test("returns require complete resellable/damaged disposition", () => {
  const base = { operationId: randomUUID(), requestId: randomUUID(), expectedVersion: 1, reason: "Cliente devuelve", lines: [{ saleLineId: randomUUID(), receivedQuantity: 3, resellableQuantity: 2, damagedQuantity: 1 }] };
  assert.equal(returnSaleSchema.safeParse(base).success, true);
  assert.equal(returnSaleSchema.safeParse({ ...base, lines: [{ ...base.lines[0], damagedQuantity: 0 }] }).success, false);
});
