import test from "node:test"; import assert from "node:assert/strict"; import { randomUUID } from "node:crypto"; import { createInventoryPublicationSchema, inventoryPublicationStatusSchema, updateInventoryPublicationSchema } from "./inventory-publication.schema";
test("publication validates owner-scoped identifiers and COP override", () => { const v = { operationId: randomUUID(), inventoryItemId: randomUUID(), catalogId: randomUUID(), priceOverride: 12000 }; assert.equal(createInventoryPublicationSchema.safeParse(v).success, true); assert.equal(createInventoryPublicationSchema.safeParse({ ...v, priceOverride: 1.5 }).success, false); assert.equal(createInventoryPublicationSchema.safeParse({ ...v, productId: randomUUID() }).success, false); });
test("publication override distinguishes omitted, null and a strict COP integer", () => {
  const base = { operationId: randomUUID(), expectedVersion: 1, status: "PUBLISHED" };
  assert.equal(updateInventoryPublicationSchema.safeParse(base).success, true);
  assert.equal(updateInventoryPublicationSchema.safeParse({ ...base, priceOverride: null }).success, true);
  assert.equal(updateInventoryPublicationSchema.safeParse({ ...base, priceOverride: 15000 }).success, true);
  for (const priceOverride of ["15000", "1.000", "1e3", -1, 1.5, 2_147_483_648]) assert.equal(updateInventoryPublicationSchema.safeParse({ ...base, priceOverride }).success, false);
});
test("publication status is closed", () => { assert.equal(inventoryPublicationStatusSchema.safeParse("PUBLISHED").success, true); assert.equal(inventoryPublicationStatusSchema.safeParse("ACTIVE").success, false); });
