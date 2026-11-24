import assert from "node:assert/strict";
import fs from "node:fs";
import Module, { createRequire } from "node:module";
import ts from "typescript";
import { parseInventoryItemReply } from "../lib/inventory-item.mjs";

const itemId = "11111111-1111-4111-8111-111111111111";
const item = { id: itemId, name: "Producto", sku: "SKU", stock: 8, minimumStock: 0, dataVersion: 1, stockVersion: 1,
  commercialTerms: { currency: "COP", unitSalePrice: "9007199254740993", referenceUnitCost: null, version: 1 } };
assert.deepEqual(parseInventoryItemReply({ result: item }, itemId), item);
assert.equal(parseInventoryItemReply({ result: { ...item, commercialTerms: null } }, itemId).commercialTerms, null);
for (const bad of [null, {}, { result: { items: [] } },
  ...[{ id: "other" }, { stock: -1 }, { stock: 1.5 }, { minimumStock: -1 }, { dataVersion: 0 }, { sku: " " }].map(patch => ({ result: { ...item, ...patch } })),
  ...[{ unitSalePrice: 20 }, { unitSalePrice: "-1" }, { unitSalePrice: "9223372036854775808" }, { referenceUnitCost: "-1" }, { currency: "USD" }]
    .map(patch => ({ result: { ...item, commercialTerms: { ...item.commercialTerms, ...patch } } }))]) assert.throws(() => parseInventoryItemReply(bad, itemId));
console.log("PASS inventory detail validates requested identity, versions, stock, exact money and malformed replies");

const require = createRequire(import.meta.url);
const previous = Module._extensions[".ts"];
Module._extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);
try {
  const { InventoryRetryKeys } = require("../lib/inventory-retry.ts");
  const keys = new InventoryRetryKeys();
  const first = keys.keyFor("movement:item-a:entry:5");
  assert.equal(keys.keyFor("movement:item-a:entry:5"), first);
  const other = keys.keyFor("movement:item-b:entry:5");
  assert.notEqual(other, first);
  keys.keyFor("create:product-a");
  keys.keyFor("movement:item-a:entry:6");
  assert.equal(keys.keyFor("movement:item-a:entry:5"), first, "switching product, form or draft must preserve unresolved operations");
  keys.complete("movement:item-b:entry:5");
  assert.equal(keys.keyFor("movement:item-a:entry:5"), first, "another successful operation cannot discard this retry");
  keys.complete("movement:item-a:entry:5");
  assert.notEqual(keys.keyFor("movement:item-a:entry:5"), first, "a confirmed new operation needs a new identifier");
  console.log("PASS inventory retry keys survive switching products, forms and drafts; confirmed operations get a new key");
} finally {
  if (previous) Module._extensions[".ts"] = previous;
  else delete Module._extensions[".ts"];
}
