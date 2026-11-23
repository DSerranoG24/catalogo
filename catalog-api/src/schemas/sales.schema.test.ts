import test from "node:test";
import assert from "node:assert/strict";
import { confirmSaleSchema, convertOrderToSaleSchema, returnSaleSchema, saleLineInputSchema, saleMovementRoleSchema } from "./sales.schema";
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
test("movement roles are closed and operation/request identifiers stay distinct", () => {
  assert.equal(saleMovementRoleSchema.safeParse("SALE_CONFIRMATION").success, true);
  assert.equal(saleMovementRoleSchema.safeParse("MANUAL").success, false);
  const operationId = randomUUID(); const requestId = randomUUID(); assert.notEqual(operationId, requestId);
});
test("order conversion requires distinct operation/request identifiers and strict mode", () => {
  const valid = { operationId: randomUUID(), requestId: randomUUID(), mode: "CONFIRMED", acceptPriceDifference: true };
  assert.equal(convertOrderToSaleSchema.safeParse(valid).success, true);
  assert.equal(convertOrderToSaleSchema.parse({ operationId: valid.operationId, requestId: valid.requestId }).mode, "DRAFT");
  for (const mode of ["PENDING", "COMPLETED", "CONFIRM"]) assert.equal(convertOrderToSaleSchema.safeParse({ ...valid, mode }).success, false);
  assert.equal(convertOrderToSaleSchema.safeParse({ ...valid, extra: true }).success, false);
  assert.equal(convertOrderToSaleSchema.safeParse({ ...valid, operationId: valid.requestId }).success, false);
  assert.equal(convertOrderToSaleSchema.safeParse({ ...valid, requestId: "not-a-uuid" }).success, false);
  assert.equal(convertOrderToSaleSchema.safeParse({ ...valid, customerId: randomUUID() }).success, true);
  assert.equal(convertOrderToSaleSchema.safeParse({ ...valid, customerId: null }).success, true);
  assert.equal(convertOrderToSaleSchema.safeParse({ ...valid, customerId: "invalid" }).success, false);
  for (const key of ["customerNameSnapshot", "customerPhoneSnapshot", "customerEmailSnapshot", "customerName", "customerPhone", "customerEmail", "userId"]) {
    assert.equal(convertOrderToSaleSchema.safeParse({ ...valid, [key]: "untrusted" }).success, false);
  }
});
