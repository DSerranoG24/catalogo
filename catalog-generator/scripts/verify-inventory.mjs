import assert from "node:assert/strict";
import fs from "node:fs";
import Module, { createRequire } from "node:module";
import ts from "typescript";

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
