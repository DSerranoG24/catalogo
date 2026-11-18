import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { validateWorkbookSnapshot, workbookSaveSchema } from "./inventory-workbook.schema";
const document = () => ({ id: "test", name: "Mis títulos", sheetOrder: ["libre"], sheets: { libre: { id: "libre", name: "Lo que vende mi local", rowCount: 500, columnCount: 26, cellData: { 0: { 0: { v: "Cualquier título" }, 1: { v: "Columna propia" } }, 1: { 1: { f: "=SUM(A1:A5)", v: 4 } } } } } });
test("free workbook accepts custom titles and formulas without interpreting inventory", () => {
  assert.ok(validateWorkbookSnapshot(JSON.stringify(document())));
  assert.ok(workbookSaveSchema.safeParse({ expectedVersion: null, operationId: randomUUID(), snapshot: JSON.stringify(document()) }).success);
});
test("free workbook rejects malformed JSON, hostile keys, dimensions and stale protocol fields", () => {
  for (const value of ["", "{", "[]", JSON.stringify({ ...document(), sheetOrder: ["missing"] }), '{"__proto__":{"polluted":true}}']) assert.equal(validateWorkbookSnapshot(value), false);
  const bad = document(); bad.sheets.libre.rowCount = 10001; assert.equal(validateWorkbookSnapshot(JSON.stringify(bad)), false);
  assert.equal(workbookSaveSchema.safeParse({ expectedVersion: 0, operationId: randomUUID(), snapshot: JSON.stringify(document()) }).success, false);
  assert.equal(workbookSaveSchema.safeParse({ expectedVersion: null, operationId: randomUUID(), userId: randomUUID(), snapshot: JSON.stringify(document()) }).success, false);
  assert.equal(validateWorkbookSnapshot(JSON.stringify(document()).replace('"Cualquier título"', '"' + "x".repeat(2 * 1024 * 1024) + '"')), false);
});
