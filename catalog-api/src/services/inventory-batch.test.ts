import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { buildInventoryPlan, inventoryHash } from "./inventory-batch-plan";
import { batchCreateSchema, inventoryValuesSchema, type InventoryItemView } from "../schemas/inventory-batch.schema";
import { inventoryCsv, inventoryXlsx } from "./inventory-export.service";
const item: InventoryItemView = { id: randomUUID(), name: "Producto", sku: "00123", minimumStock: 2, stock: 8, dataVersion: 1, stockVersion: 1, commercialTerms: { currency: "COP", unitSalePrice: "12000", referenceUnitCost: "4000", version: 1 } };
const row = (values: unknown, excluded = false) => ({ rowId: randomUUID(), rowNumber: 2, revision: 1, reservedItemId: randomUUID(), excluded, values });
test("batch validates limits, exact money, blank targets and client authority", () => {
  assert.equal(batchCreateSchema.safeParse({ id: randomUUID(), source: "GRID", totalRows: 501 }).success, false);
  for (const values of [{ targetStock: -1 }, { unitSalePrice: "1.5" }, { unitSalePrice: "9223372036854775808" }, { sku: 123 }, { delta: 4 }, { userId: randomUUID() }]) assert.equal(inventoryValuesSchema.safeParse(values).success, false);
  assert.equal(inventoryValuesSchema.parse({ targetStock: "" }).targetStock, undefined);
  assert.equal(inventoryValuesSchema.parse({ unitSalePrice: "9223372036854775807" }).unitSalePrice, "9223372036854775807");
});
test("batch separates metadata, prices and absolute targets; preserves blank stock", () => {
  const same = buildInventoryPlan([row({ id: item.id, sku: item.sku, targetStock: "" })], [item], null)[0]; assert.equal(same.action, "UNCHANGED"); assert.equal(same.delta, 0);
  for (const [targetStock, delta] of [[12, 4], [7, -1], [0, -8]]) { const plan = buildInventoryPlan([row({ id: item.id, targetStock, reason: "Conteo físico" })], [item], null)[0]; assert.equal(plan.delta, delta); assert.equal(plan.after?.stock, targetStock); assert.equal(plan.action, "MODIFIED"); }
  const price = buildInventoryPlan([row({ sku: item.sku, unitSalePrice: "15000", costAction: "BORRAR" })], [item], null)[0]; assert.equal(price.delta, 0); assert.equal(price.after?.commercialTerms?.referenceUnitCost, null);
});
test("batch identity never matches names and flags both duplicate occurrences", () => {
  assert.equal(buildInventoryPlan([row({ name: item.name })], [item], null)[0].action, "ERROR");
  assert.equal(buildInventoryPlan([row({ id: randomUUID(), sku: item.sku })], [item], null)[0].action, "ERROR");
  const result = buildInventoryPlan([row({ id: item.id }), row({ sku: item.sku })], [item], null); assert.ok(result.every(value => value.action === "ERROR"));
  assert.equal(buildInventoryPlan([row({ sku: item.sku }), row({ sku: item.sku }, true)], [item], null)[0].action, "UNCHANGED");
});
test("batch checks reasons, optimistic versions, cost actions and hash stability", () => {
  for (const values of [{ id: item.id, targetStock: 12 }, { id: item.id, stockVersion: 2 }, { id: item.id, costAction: "BORRAR", referenceUnitCost: "1" }, { sku: "NEW", name: "New", referenceUnitCost: "1" }]) assert.equal(buildInventoryPlan([row(values)], [item], null)[0].action, "ERROR");
  assert.equal(inventoryHash({ a: 1, b: 2 }), inventoryHash({ b: 2, a: 1 }));
  assert.notEqual(inventoryHash({ a: 1 }), inventoryHash({ a: 2 }));
});
test("export encodes textual formulas reversibly and XLSX is a binary archive", () => {
  const csv = inventoryCsv([["INV1_ESC", "", "00123", "=SUM(A1)", "12000", "", "", "0", "8", "", "", "1", "1", ""]]);
  assert.ok(csv.includes("'00123")); assert.ok(csv.includes("'=SUM(A1)"));
  const xlsx = inventoryXlsx([]); assert.equal(xlsx.readUInt32LE(0), 0x04034b50);
});
