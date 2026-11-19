import assert from "node:assert/strict";
import fs from "node:fs";
import Module, { createRequire } from "node:module";
import ts from "typescript";
const require = createRequire(import.meta.url), previous = Module._extensions[".ts"];
Module._extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
try {
  const { readWorkbookSnapshot, suggestReadingFields, previewWorkbookReading, columnName } = require("../lib/workbook-reading.ts");
  const source = { name: "Libre", sheetOrder: ["s"], sheets: { s: { id: "s", name: "Mi local", rowCount: 1000, columnCount: 5, cellData: {
    0: { 0: { v: "Descripción" }, 1: { v: "Referencia" }, 2: { v: "Cantidad" }, 3: { v: "Precio de venta" }, 4: { v: "Valor" } },
    1: { 0: { v: "Café" }, 1: { v: "00123" }, 2: { v: 8 }, 3: { v: 12000 } },
    2: { 0: { v: "Arroz" }, 1: { v: "SKU-B" }, 2: { f: "=SUM(A1:A3)", v: 3 }, 3: { v: "9223372036854775807" } },
  } } } };
  const original = JSON.stringify(source), book = readWorkbookSnapshot(original), sheet = book.sheets[0], mapping = suggestReadingFields(sheet, 1);
  assert.deepEqual(mapping, ["name", "sku", "ignore", "unitSalePrice", "ignore"]); mapping[2] = "quantity";
  const result = previewWorkbookReading(sheet, 1, 2, 4, mapping); assert.equal(result.rows.length, 2); assert.equal(result.emptyRows, 1); assert.equal(result.errorRows, 0); assert.equal(result.rows[0].values.sku, "00123"); assert.equal(result.rows[1].values.unitSalePrice, "9223372036854775807"); assert.deepEqual(result.rows[1].formulas, ["C3"]); assert.equal(JSON.stringify(source), original);
  console.log("PASS reading custom headers, explicit quantities, exact money, formulas and blank rows without mutation");
  const duplicate = structuredClone(source); duplicate.sheets.s.cellData[2][1].v = "00123";
  assert.equal(previewWorkbookReading(readWorkbookSnapshot(JSON.stringify(duplicate)).sheets[0], 1, 2, 3, mapping).errorRows, 2);
  console.log("PASS reading duplicate SKU flags both original rows");
  const invalid = structuredClone(source); invalid.sheets.s.cellData[1][1].v = 123; invalid.sheets.s.cellData[1][2].v = -1; invalid.sheets.s.cellData[1][3].v = "12.000";
  const errors = previewWorkbookReading(readWorkbookSnapshot(JSON.stringify(invalid)).sheets[0], 1, 2, 3, mapping).rows[0].errors;
  assert.equal(errors.length, 3); assert.ok(errors.some(value => value.includes("ceros"))); assert.ok(errors.some(value => value.includes("B2")));
  console.log("PASS reading rejects numeric SKU, negative quantities and ambiguous monetary text");
  assert.throws(() => previewWorkbookReading(sheet, 1, 2, 502, mapping), /500/);
  assert.throws(() => previewWorkbookReading(sheet, 1, 1, 3, mapping));
  assert.throws(() => previewWorkbookReading(sheet, 1, 2, 3, ["name", "name", "ignore", "ignore", "ignore"]), /mismo significado/);
  console.log("PASS reading rejects oversized ranges and duplicate field mappings");
  const formula = structuredClone(source); formula.sheets.s.cellData[2][2].v = "#DIV/0!";
  assert.ok(previewWorkbookReading(readWorkbookSnapshot(JSON.stringify(formula)).sheets[0], 1, 2, 3, mapping).rows[1].errors.some(value => value.includes("fórmula")));
  const merge = structuredClone(source); merge.sheets.s.mergeData = [{ startRow: 1, endRow: 2, startColumn: 0, endColumn: 0 }];
  assert.equal(previewWorkbookReading(readWorkbookSnapshot(JSON.stringify(merge)).sheets[0], 1, 2, 3, mapping).errorRows, 2);
  assert.equal(columnName(26), "AA"); assert.equal(columnName(199), "GR");
  console.log("PASS reading formula errors and merged cells preserve row/cell provenance");
} finally { if (previous) Module._extensions[".ts"] = previous; else delete Module._extensions[".ts"]; }
