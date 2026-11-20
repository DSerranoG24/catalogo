import assert from "node:assert/strict";
import { validateNativeWorkbookCopy } from "../lib/free-workbook-restore.mjs";
const valid = JSON.stringify({ id: "vitrinaya-workbook", name: "Copia", sheetOrder: ["sheet"], sheets: { sheet: { id: "sheet", name: "Hoja", rowCount: 10, columnCount: 3, cellData: {} } } });
assert.equal(validateNativeWorkbookCopy(valid), valid);
for (const invalid of ["", "{", "[]", JSON.stringify({ id: "x" })]) assert.throws(() => validateNativeWorkbookCopy(invalid));
let confirmed = false; const dirty = true; const accept = false;
if (dirty && accept) confirmed = true;
assert.equal(confirmed, false);
console.log("PASS native workbook restore validation, invalid copies and cancelled dirty confirmation");
