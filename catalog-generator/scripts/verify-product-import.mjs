import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import Module, { createRequire } from "node:module";
import { once } from "node:events";
import { Worker as NodeWorker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { zipSync, unzipSync, strToU8, strFromU8, Zip, ZipDeflate } from "fflate";
import { readSheet } from "read-excel-file/browser";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Test-only transpilation: use the already installed TypeScript compiler, not a new runner.
const previous = Module._extensions[".ts"];
Module._extensions[".ts"] = (module, filename) => {
  const output = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  });
  module._compile(output.outputText, filename);
};
const { createProductImportTemplate } = require("../lib/product-import/template.ts");
const { verifyAndUnzip } = require("../lib/product-import/zip.ts");
const { readVerifiedWorkbook } = require("../lib/product-import/read-core.ts");
const { inspectXml } = require("../lib/product-import/xml-guard.ts");
const { startImportRead } = require("../lib/product-import/reader-controller.ts");
const { backendBodyLimit } = require("../lib/backend-proxy-limits.ts");
const { IMPORT_COLUMNS, XLSX_LIMITS } = require("../lib/product-import/contracts.ts");
const results = [];
async function check(name, work) { await work(); results.push(name); console.log("PASS " + name); }
const hasCode = code => error => error?.code === code;
const base = createProductImportTemplate();
const baseFiles = unzipSync(base);
function workbook(rows = "", transform = files => files) {
  const files = { ...baseFiles };
  const headerOnly = strFromU8(files["xl/worksheets/sheet1.xml"]).replace(/<row r="([0-9]+)">[^]*?<\/row>/g, (value, row) => Number(row) === 1 ? value : "");
  files["xl/worksheets/sheet1.xml"] = strToU8(headerOnly.replace("</sheetData>", rows + "</sheetData>"));
  return zipSync(transform(files), { level: 6 });
}
const text = (reference, value) => `<c r="${reference}" t="inlineStr"><is><t>${value}</t></is></c>`;
const numeric = (reference, value) => `<c r="${reference}"><v>${value}</v></c>`;
function forgedSizes(bytes, size, selected = () => true) {
  const result = bytes.slice(), view = new DataView(result.buffer);
  let cursor = view.getUint32(result.length - 6, true);
  const count = view.getUint16(result.length - 12, true);
  for (let i = 0; i < count; i++) {
    if (selected(i)) {
      view.setUint32(cursor + 24, size, true);
      view.setUint32(view.getUint32(cursor + 42, true) + 22, size, true);
    }
    cursor += 46 + view.getUint16(cursor + 28, true) + view.getUint16(cursor + 30, true) + view.getUint16(cursor + 32, true);
  }
  return result;
}

try {
  await check("template roundtrip: two sheets, exact headers and zero importable examples", async () => {
    const products = await readSheet(base.buffer, "Productos");
    const instructions = await readSheet(base.buffer, "Instrucciones");
    assert.deepEqual(products, [IMPORT_COLUMNS.map(([header]) => header)]);
    assert.ok(instructions.length >= 15);
    assert.equal((await readVerifiedWorkbook(base, readSheet)).totalRows, 0);
    assert.match(strFromU8(baseFiles["xl/workbook.xml"]), /activeTab="0"/);
  });
  await check("template: SKU/date Text, integer formats, validation and twelve header notes", () => {
    const xml = strFromU8(baseFiles["xl/worksheets/sheet1.xml"]);
    assert.match(xml, /min="2" max="2"[^>]*style="1"/);
    assert.match(xml, /<c r="B2" s="1"\/>/);
    assert.match(xml, /<c r="B501" s="1"\/>/);
    assert.match(xml, /min="11" max="11"[^>]*style="1"/);
    assert.match(xml, /min="12" max="12"[^>]*style="1"/);
    assert.match(strFromU8(baseFiles["xl/styles.xml"]), /numFmtId="49"/);
    assert.match(xml, /type="whole"[^>]*sqref="G2:G501"/);
    assert.match(xml, /sqref="I2:I501"><formula1>"Sí,No"/);
    assert.equal((strFromU8(baseFiles["xl/comments1.xml"]).match(/<comment ref=/g) || []).length, 12);
    for (const [name, data] of Object.entries(baseFiles)) if (/\.(xml|rels|vml)$/.test(name)) inspectXml(data);
  });
  await check("read only sanitized STORE archive and only Productos; preserve string SKU and normalize NFC", async () => {
    const input = workbook(`<row r="2">${text("A2", "  Café  ")}${text("B2", "00123")}${numeric("G2", 25000)}${text("I2", "Sí")}${text("K2", "2026-11-01T09:00:00-05:00")}</row>`);
    const result = await readVerifiedWorkbook(input, async (safe, sheet) => {
      assert.equal(sheet, "Productos"); assert.notDeepEqual(new Uint8Array(safe), input);
      const view = new DataView(safe);
      assert.equal(view.getUint16(8, true), 0);
      return readSheet(safe, sheet);
    });
    assert.equal(result.rows[0].sku, "00123"); assert.equal(result.rows[0].name, "Café");
    assert.equal(result.rows[0].saleEnabled, true); assert.equal(result.rows[0].price, 25000);
    assert.equal(result.errors.length, 0);
  });
  await check("numeric SKU is a row error, never coerced or dropped; other valid rows survive", async () => {
    const input = workbook(`<row r="2">${text("A2", "Malo")}${numeric("B2", 123)}${numeric("G2", 10)}</row><row r="3">${text("A3", "Bueno")}${text("B3", "00123")}${numeric("G3", 10)}</row>`);
    const result = await readVerifiedWorkbook(input, readSheet);
    assert.equal(result.totalRows, 2); assert.equal(result.rows.length, 1); assert.equal(result.rows[0].rowNumber, 3);
    assert.deepEqual(result.errors, [{ rowNumber: 2, field: "sku", code: "TEXT_REQUIRED" }]);
  });
  await check("dates must be text, blank values stay omitted, zero and No remain explicit", async () => {
    const result = await readVerifiedWorkbook(workbook(`<row r="2">${text("A2", "Vela")}${numeric("H2", 0)}${text("I2", "No")}</row>`), readSheet);
    assert.equal(result.rows[0].stock, 0); assert.equal(result.rows[0].saleEnabled, false);
    assert.equal(Object.hasOwn(result.rows[0], "sku"), false);
    const invalid = await readVerifiedWorkbook(workbook(`<row r="2">${text("A2", "Vela")}${numeric("K2", 46000)}</row>`), readSheet);
    assert.equal(invalid.errors[0].field, "saleStartsAt");
  });
  await check("coordinate/row/cell limits reject sparse matrix bombs before invoking reader", async () => {
    for (const rows of ['<row r="502"><c r="A502"/></row>', '<row r="2"><c r="M2"/></row>', '<row r="2"><c r="A2"/><c r="A2"/></row>']) {
      await assert.rejects(readVerifiedWorkbook(workbook(rows), () => { throw new Error("READER_MUST_NOT_RUN"); }), hasCode("SHEET_INVALID"));
    }
  });
  await check("DTD, malformed XML, macros and external relationships reject before reader", async () => {
    assert.throws(() => inspectXml(strToU8('<!DOCTYPE a [<!ENTITY x "x">]><a/>')), hasCode("XML_INVALID"));
    assert.throws(() => inspectXml(strToU8('<a><b></a>')), hasCode("XML_INVALID"));
    assert.throws(() => inspectXml(strToU8('<a>&unknown;</a>')), hasCode("XML_INVALID"));
    await assert.rejects(readVerifiedWorkbook(workbook("", files => ({ ...files, "xl/vbaProject.bin": new Uint8Array() })), readSheet), hasCode("XLSX_REQUIRED"));
  });
  await check("entry limit activates on real emitted bytes despite forged tiny declared sizes", () => {
    const bomb = zipSync({ "bomb.bin": new Uint8Array(XLSX_LIMITS.entry + 1) });
    assert.ok(bomb.length < XLSX_LIMITS.compressed);
    assert.throws(() => verifyAndUnzip(bomb), hasCode("ZIP_ENTRY_LIMIT"));
    assert.throws(() => verifyAndUnzip(forgedSizes(bomb, 1)), hasCode("ZIP_ENTRY_LIMIT"));
  });
  await check("total limit activates on real emitted bytes across entries with forged sizes", () => {
    const data = new Uint8Array(XLSX_LIMITS.entry);
    const bomb = zipSync({ "a.bin": data, "b.bin": data, "c.bin": data });
    assert.throws(() => verifyAndUnzip(forgedSizes(bomb, 1, index => index === 2)), hasCode("ZIP_TOTAL_LIMIT"));
    assert.throws(() => verifyAndUnzip(bomb), hasCode("ZIP_TOTAL_LIMIT"));
  });
  await check("64 entries, ZIP64, encryption, path traversal, CRC and structure defenses", () => {
    assert.throws(() => verifyAndUnzip(zipSync(Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`${i}.xml`, new Uint8Array()])))), hasCode("ZIP_ENTRIES_LIMIT"));
    const zip64 = base.slice(); new DataView(zip64.buffer).setUint16(zip64.length - 12, 65535, true);
    assert.throws(() => verifyAndUnzip(zip64), hasCode("ZIP64_UNSUPPORTED"));
    const encrypted = base.slice(), ev = new DataView(encrypted.buffer), cd = ev.getUint32(encrypted.length - 6, true);
    ev.setUint16(cd + 8, 1, true); assert.throws(() => verifyAndUnzip(encrypted), hasCode("ZIP_ENCRYPTED"));
    assert.throws(() => verifyAndUnzip(zipSync({ "../evil.xml": strToU8("x") })), hasCode("ZIP_INVALID"));
    const badCrc = base.slice(), cv = new DataView(badCrc.buffer), cp = cv.getUint32(badCrc.length - 6, true);
    cv.setUint32(cp + 16, 0, true); cv.setUint32(14, 0, true);
    assert.throws(() => verifyAndUnzip(badCrc), hasCode("ZIP_INVALID"));
    assert.throws(() => verifyAndUnzip(base.subarray(0, base.length - 1)), hasCode("ZIP_INVALID"));
  });
  await check("valid streaming ZIP data descriptors work", () => {
    const chunks = [], zip = new Zip((error, data) => { if (error) throw error; chunks.push(data); });
    const entry = new ZipDeflate("test.xml"); zip.add(entry); entry.push(strToU8("<a/>"), true); zip.end();
    const bytes = new Uint8Array(chunks.reduce((sum, part) => sum + part.length, 0));
    let offset = 0; for (const part of chunks) { bytes.set(part, offset); offset += part.length; }
    assert.equal(strFromU8(verifyAndUnzip(bytes).files["test.xml"]), "<a/>");
  });
  await check("5 MiB and extension checks happen before file reading or worker creation", async () => {
    const noWorker = () => { throw new Error("WORKER_MUST_NOT_START"); };
    await assert.rejects(startImportRead({ name: "big.xlsx", size: XLSX_LIMITS.compressed + 1 }, undefined, noWorker), hasCode("FILE_TOO_LARGE"));
    for (const name of ["file.xls", "file.xlsm", "file.csv"]) await assert.rejects(startImportRead({ name, size: 100 }, undefined, noWorker), hasCode("XLSX_REQUIRED"));
  });
  async function busyWorker(signal, timeout) {
    const worker = new NodeWorker(`const {parentPort}=require('node:worker_threads');parentPort.on('message',()=>{parentPort.postMessage('started');while(true){}})`, { eval: true });
    const started = once(worker, "message"), stopped = once(worker, "exit");
    const port = { onmessage: null, onerror: null, onmessageerror: null, postMessage: value => worker.postMessage(value), terminate: () => { worker.terminate(); } };
    const begin = performance.now();
    const operation = startImportRead(new File([base], "products.xlsx"), signal?.signal, () => port);
    const rejected = assert.rejects(operation, hasCode(timeout ? "TIMEOUT" : "CANCELLED"));
    await started;
    if (signal) signal.abort();
    await rejected; await stopped;
    if (timeout) assert.ok(performance.now() - begin >= 9900);
  }
  await check("manual cancellation actually terminates an executing worker", () => busyWorker(new AbortController(), false));
  await check("10-second watchdog actually terminates a CPU-bound worker", () => busyWorker(undefined, true));
  await check("proxy exception matches only exact POST+UUID+JSON; images retain their limit", () => {
    const route = ["products", "catalog", "11111111-1111-4111-8111-111111111111", "import", "preview"];
    for (const action of ["preview", "confirm"]) assert.equal(backendBodyLimit("POST", [...route.slice(0, 4), action], "application/json; charset=utf-8"), 2 * 1024 * 1024);
    for (const [method, parts, type] of [["PUT", route, "application/json"], ["POST", [...route, "extra"], "application/json"], ["POST", ["products", "catalog", "invalid", "import", "preview"], "application/json"], ["POST", route, "text/plain"]]) assert.equal(backendBodyLimit(method, parts, type), 65536);
    assert.equal(backendBodyLimit("POST", ["product-images"], "multipart/form-data; boundary=x"), 5 * 1024 * 1024 + 65536);
  });
  await check("actual proxy: Origin before stream read; declared and streaming limits; ordinary JSON unchanged", async () => {
    process.env.CATALOG_API_URL = "http://127.0.0.1:1/api";
    const { NextRequest } = require("next/server");
    const route = require("../app/api/backend/[...path]/route.ts");
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => { calls++; return new Response('{"success":true}', { headers: { "content-type": "application/json" } }); };
    const parts = ["products", "catalog", "11111111-1111-4111-8111-111111111111", "import", "preview"];
    async function request({ size = 70_000, origin = "http://localhost:3001", contentLength, pathParts = parts } = {}) {
      const headers = { "content-type": "application/json" };
      if (origin) headers.origin = origin;
      if (contentLength) headers["content-length"] = String(contentLength);
      const req = new NextRequest("http://localhost:3001/api/backend/" + pathParts.join("/"), { method: "POST", headers, body: "x".repeat(size) });
      let reads = 0;
      const getReader = req.body.getReader.bind(req.body);
      req.body.getReader = (...args) => { reads++; return getReader(...args); };
      const response = await route.POST(req, { params: Promise.resolve({ path: pathParts }) });
      return { response, reads };
    }
    try {
      for (const origin of [null, "http://other.invalid"]) { const result = await request({ origin }); assert.equal(result.response.status, 403); assert.equal(result.reads, 0); }
      assert.equal(calls, 0);
      const declared = await request({ contentLength: 2 * 1024 * 1024 + 1 }); assert.equal(declared.response.status, 413); assert.equal(declared.reads, 0);
      assert.equal((await request({ size: 2 * 1024 * 1024 + 1 })).response.status, 413);
      assert.equal((await request({ pathParts: ["products"] })).response.status, 413);
      assert.equal((await request()).response.status, 200); assert.equal(calls, 1);
    } finally { globalThis.fetch = originalFetch; }
  });
  const artifact = process.argv.includes("--write-template") ? path.join(root, "public/templates/productos.xlsx") : path.join(os.tmpdir(), "catalogo-productos-template.xlsx");
  fs.mkdirSync(path.dirname(artifact), { recursive: true }); fs.writeFileSync(artifact, base);
  console.log(JSON.stringify({ passed: results.length, failed: 0, template: artifact, templateBytes: base.length, quotas: XLSX_LIMITS }, null, 2));
} finally { if (previous) Module._extensions[".ts"] = previous; else delete Module._extensions[".ts"]; }
