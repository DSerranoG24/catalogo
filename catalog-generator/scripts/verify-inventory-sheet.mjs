import assert from "node:assert/strict";
import fs from "node:fs";
import Module, { createRequire } from "node:module";
import ts from "typescript";
import { readSheet } from "read-excel-file/browser";
import { unzipSync, zipSync, strToU8, strFromU8 } from "fflate";
const require = createRequire(import.meta.url), previous = Module._extensions[".ts"];
Module._extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
try {
  const { parseDelimited, mapRows, suggestedMapping, readInventoryWorkbook } = require("../lib/inventory-sheet/formats.ts");
  const { inventoryCsv, inventoryXlsx } = require("../../catalog-api/src/services/inventory-export.service.ts");
  const values = [["INV1", "", "00123", "=SUM(A1)", "9223372036854775807", "", "", "0", "8", "", "", "1", "1", ""]];
  const csv = parseDelimited(inventoryCsv(values), ","), parsed = mapRows(csv, suggestedMapping(csv));
  assert.equal(parsed[0].sku, "00123"); assert.equal(parsed[0].name, "=SUM(A1)"); assert.equal(parsed[0].unitSalePrice, "9223372036854775807"); assert.equal(parsed[0].targetStock, ""); assert.equal("currentStock" in parsed[0], false);
  console.log("PASS CSV exact money, formula escaping, SKU zeros and blank target round trip");
  assert.deepEqual(parseDelimited('SKU;Nombre\r\nABC;"Uno;dos\nTres"', ";"), [["SKU", "Nombre"], ["ABC", "Uno;dos\nTres"]]);
  assert.throws(() => parseDelimited('SKU\n"unfinished', ",")); assert.throws(() => parseDelimited("SKU\n" + "ABC\n".repeat(501), ",")); assert.throws(() => mapRows([["a", "b"], ["x", "y"]], ["sku", "sku"]));
  console.log("PASS CSV quotas, quoting, semicolon, multiline and mapping validation");
  const xlsx = inventoryXlsx(values), result = await readInventoryWorkbook(xlsx, (bytes, sheet) => readSheet(bytes, sheet));
  const mapped = mapRows(result.matrix, suggestedMapping(result.matrix)); assert.equal(mapped[0].sku, "00123"); assert.equal(mapped[0].unitSalePrice, "9223372036854775807"); assert.equal(mapped[0].targetStock, "");
  console.log("PASS XLSX generated archive passes bounded reader and preserves text types");
  const files = unzipSync(xlsx); files["xl/worksheets/sheet1.xml"] = strToU8(strFromU8(files["xl/worksheets/sheet1.xml"]).replace('<c r="C2"', '<c r="C2"').replace('</sheetData>', '<row r="3"><c r="C3"><f>1+1</f><v>2</v></c></row></sheetData>'));
  await assert.rejects(readInventoryWorkbook(zipSync(files), (bytes, sheet) => readSheet(bytes, sheet)), /fórmulas/);
  console.log("PASS XLSX formulas rejected before third party matrix parsing");
  const { backendBodyLimit } = require("../lib/backend-proxy-limits.ts"), id = "11111111-1111-4111-8111-111111111111";
  assert.equal(backendBodyLimit("PATCH", ["inventory", "batches", id, "rows"], "application/json"), 256 * 1024);
  assert.equal(backendBodyLimit("PATCH", ["inventory", "batches", "invalid", "rows"], "application/json"), 64 * 1024);
  console.log("PASS larger chunk body exception restricted to exact method/path/type/UUID");
} finally { if (previous) Module._extensions[".ts"] = previous; else delete Module._extensions[".ts"]; }
