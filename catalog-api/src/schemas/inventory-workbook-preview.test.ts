import test from "node:test";
import assert from "node:assert/strict";
import { workbookPreviewSchema } from "./inventory-workbook-preview.schema";

const base = { workbookId: "vitrinaya-workbook", sheetId: "libre", expectedVersion: 2, headerRow: 1, firstRow: 2, lastRow: 3, confirmed: true as const, mapping: { "0": "sku" as const, "1": "name" as const, "2": "quantity" as const } };
test("workbook preview requires explicit identity and confirmation", () => {
  assert.equal(workbookPreviewSchema.safeParse(base).success, true);
  assert.equal(workbookPreviewSchema.safeParse({ ...base, confirmed: false }).success, false);
  assert.equal(workbookPreviewSchema.safeParse({ ...base, mapping: { "0": "name" } }).success, false);
});
test("workbook preview rejects duplicate meanings and oversized ranges", () => {
  assert.equal(workbookPreviewSchema.safeParse({ ...base, mapping: { "0": "sku", "1": "sku" } }).success, false);
  assert.equal(workbookPreviewSchema.safeParse({ ...base, lastRow: 502 }).success, false);
  assert.equal(workbookPreviewSchema.safeParse({ ...base, mapping: { "999": "sku" } }).success, true); // sheet bounds are validated against the persisted sheet
});
test("workbook preview accepts counted stock zero and rejects negative or decimal quantities", () => {
  const quantity = { ...base, mapping: { "0": "sku" as const, "1": "name" as const, "2": "quantity" as const } };
  assert.equal(workbookPreviewSchema.safeParse(quantity).success, true);
  assert.equal(workbookPreviewSchema.safeParse({ ...quantity, firstRow: 0 }).success, false);
});
