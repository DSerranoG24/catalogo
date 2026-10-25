import assert from "node:assert/strict";
import fs from "node:fs";
import Module, { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url), previous = Module._extensions[".ts"];
Module._extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, filename);
const { ProductImportFlow, importCounts, importBatches } = require("../lib/product-import-flow.ts");
const { ImportRequestError, requestImportBatch, parseBatchReply } = require("../lib/product-import-api.ts");
const { ImportReadError } = require("../lib/product-import/contracts.ts");
const data = count => Array.from({ length: count }, (_, index) => ({ rowNumber: index + 2, name: `Producto ${index}`, sku: `00${index}`, price: 100 }));
const file = { name: "productos.xlsx" };
const gate = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const resultRows = rows => rows.map(row => ({ rowNumber: row.rowNumber, action: "create", code: "NEW_PRODUCT", reason: "Se creará un producto." }));
function fixture(count = 101, options = {}) {
  const rows = options.rows ?? data(count), calls = [];
  let seen = 0, refreshed = 0;
  const server = async (catalog, mode, body) => {
    calls.push({ catalog, mode, body: structuredClone(body) });
    if (options.intercept) { const value = await options.intercept(mode, body, calls); if (value) return value; }
    if (mode === "preview") {
      if (!body.previewToken) seen = 0;
      seen += body.rows.length;
      return { requestId: `request-${calls.length}`, rows: resultRows(body.rows), previewToken: `token-${seen}`, ready: seen === body.totalRows, invalidatedRows: options.conflict && seen === body.totalRows ? [2, 52] : [] };
    }
    return { requestId: `request-${calls.length}`, rows: resultRows(body.rows) };
  };
  const flow = new ProductImportFlow("11111111-1111-4111-8111-111111111111", {
    read: options.read ?? (async () => ({ rows, errors: options.errors ?? [], totalRows: rows.length + (options.errors?.length ? 1 : 0), bytes: { compressed: 100, expanded: 200, entries: 1 } })),
    request: server, refresh: () => { refreshed++; if (options.refreshThrows) throw new Error("refresh failed"); }, now: options.now,
  });
  return { flow, calls, refreshed: () => refreshed };
}
let passed = 0;
async function check(name, work) { await work(); passed++; console.log("PASS " + name); }
try {
  await check("explicit reading/preview/ready states and sequential chained tokens", async () => {
    const { flow, calls } = fixture(), phases = [];
    flow.subscribe(() => phases.push(flow.getSnapshot().phase)); flow.open(); await flow.select(file);
    assert.ok(phases.includes("reading")); assert.ok(phases.includes("previewing")); assert.equal(flow.getSnapshot().phase, "ready");
    assert.deepEqual(calls.map(call => call.body.rows.length), [50, 50, 1]);
    assert.deepEqual(calls.map(call => call.body.previewToken), [undefined, "token-50", "token-100"]);
    assert.equal(importCounts(flow.getSnapshot().report).new, 101);
  });
  await check("multiple local issues count one row, never sent to the API", async () => {
    const errors = [{ rowNumber: 400, field: "sku", code: "TEXT_REQUIRED" }, { rowNumber: 400, field: "price", code: "NUMBER_REQUIRED" }];
    const { flow, calls } = fixture(1, { errors }); await flow.select(file);
    assert.equal(importCounts(flow.getSnapshot().report).errors, 1);
    assert.equal(flow.getSnapshot().report.find(row => row.rowNumber === 400).reasons.length, 2);
    assert.deepEqual(calls[0].body.rows.map(row => row.rowNumber), [2]); assert.equal(calls[0].body.totalRows, 1);
  });
  await check("later-batch conflicts invalidate earlier rows and exclude both from confirmation", async () => {
    const { flow, calls } = fixture(101, { conflict: true }); await flow.select(file); await flow.confirm();
    const confirms = calls.filter(call => call.mode === "confirm");
    assert.equal(importCounts(flow.getSnapshot().report).errors, 2);
    assert.equal(importCounts(flow.getSnapshot().report).created, 99);
    assert.ok(confirms.every(call => call.body.previewToken === "token-101" && call.body.totalRows === 101));
    assert.ok(!confirms.flatMap(call => call.body.rows).some(row => row.rowNumber === 2 || row.rowNumber === 52));
  });
  await check("failed preview preserves last acknowledged token and cannot confirm; manual retry continues", async () => {
    let fail = true;
    const { flow, calls } = fixture(101, { intercept: (mode, body) => { if (mode === "preview" && body.previewToken === "token-50" && fail) { fail = false; throw new ImportRequestError(0, "CONNECTION_LOST", false); } } });
    await flow.select(file); assert.equal(flow.getSnapshot().phase, "error");
    await flow.confirm(); assert.ok(calls.every(call => call.mode === "preview"));
    await flow.retry(); assert.equal(flow.getSnapshot().phase, "ready");
    assert.equal(calls[2].body.previewToken, "token-50");
  });
  await check("closing reading is blocked; cancelling uses the reader AbortSignal", async () => {
    const entered = gate();
    const { flow } = fixture(1, { read: (_, { signal }) => new Promise((_, reject) => { signal.addEventListener("abort", () => reject(new ImportReadError("CANCELLED"))); entered.resolve(); }) });
    flow.open(); const operation = flow.select(file); await entered.promise;
    assert.equal(flow.close(), false); flow.cancel(); await operation;
    assert.equal(flow.getSnapshot().phase, "stopped"); assert.equal(flow.close(), true);
  });
  await check("preview cancellation does not write or enable confirmation", async () => {
    const entered = gate(), leave = gate();
    const { flow, calls } = fixture(1, { intercept: async mode => { if (mode === "preview") { entered.resolve(); await leave.promise; } } });
    const operation = flow.select(file); await entered.promise; flow.cancel(); leave.resolve(); await operation;
    assert.equal(flow.getSnapshot().phase, "stopped"); await flow.confirm(); assert.equal(calls.length, 1);
  });
  await check("stop waits for active write; close blocked, no next batch, report preserved on refresh", async () => {
    const entered = gate(), leave = gate();
    const { flow, calls, refreshed } = fixture(101, { intercept: async mode => { if (mode === "confirm") { entered.resolve(); await leave.promise; } } });
    flow.open(); await flow.select(file); const operation = flow.confirm(); await entered.promise;
    flow.stop(); assert.equal(flow.getSnapshot().phase, "writing"); assert.equal(flow.close(), false);
    leave.resolve(); await operation;
    assert.equal(calls.filter(call => call.mode === "confirm").length, 1);
    assert.equal(flow.getSnapshot().phase, "stopped"); assert.equal(refreshed(), 1);
    assert.equal(importCounts(flow.getSnapshot().report).created, 50); assert.equal(importCounts(flow.getSnapshot().report).notProcessed, 51);
    assert.equal(flow.close(), true); flow.open(); assert.equal(flow.getSnapshot().report.length, 101);
  });
  await check("lost response leaves prior successes, unknown current batch and unprocessed future; no replay", async () => {
    let writes = 0;
    const { flow, calls } = fixture(101, { intercept: mode => { if (mode === "confirm" && ++writes === 2) throw new ImportRequestError(0, "CONNECTION_LOST", true); } });
    await flow.select(file); await flow.confirm();
    const counts = importCounts(flow.getSnapshot().report);
    assert.equal(counts.created, 50); assert.equal(counts.unknown, 50); assert.equal(counts.notProcessed, 1);
    assert.ok(flow.getSnapshot().report.filter(row => row.status === "unknown").every(row => row.requestId === undefined));
    const before = calls.length; await flow.retry(); assert.equal(calls.length, before);
    await flow.startPreview(); assert.equal(calls.at(-2).body.totalRows, 51);
    assert.ok(calls.slice(before).every(call => !call.body.rows.some(row => row.rowNumber < 52)));
    assert.equal(importCounts(flow.getSnapshot().report).created, 50);
  });
  await check("401 stops subsequent writes, retains report and session-expired message", async () => {
    const { flow, calls } = fixture(101, { intercept: mode => { if (mode === "confirm") throw new ImportRequestError(401, "AUTH_REQUIRED", false); } });
    await flow.select(file); await flow.confirm();
    assert.equal(flow.getSnapshot().failure.status, 401); assert.equal(importCounts(flow.getSnapshot().report).unknown, 0);
    assert.equal(calls.filter(call => call.mode === "confirm").length, 1); assert.equal(flow.getSnapshot().report.length, 101);
    const before = calls.length; await flow.startPreview(); await flow.select(file); assert.equal(calls.length, before);
  });
  await check("session expiry during preview cannot be overwritten by its late reply", async () => {
    const entered = gate(), leave = gate(); const { flow } = fixture(1, { intercept: async mode => { if (mode === "preview") { entered.resolve(); await leave.promise; } } });
    const operation = flow.select(file); await entered.promise; flow.sessionExpired(); leave.resolve(); await operation;
    assert.equal(flow.getSnapshot().phase, "error"); assert.equal(flow.getSnapshot().failure.status, 401);
  });
  await check("session expiry during a write waits for that result and preserves the auth warning", async () => {
    const entered = gate(), leave = gate(); const { flow, calls } = fixture(101, { intercept: async mode => { if (mode === "confirm") { entered.resolve(); await leave.promise; } } });
    await flow.select(file); const operation = flow.confirm(); await entered.promise; flow.sessionExpired();
    assert.equal(flow.getSnapshot().phase, "writing"); leave.resolve(); await operation;
    assert.equal(flow.getSnapshot().failure.status, 401); assert.equal(importCounts(flow.getSnapshot().report).created, 50);
    assert.equal(calls.filter(call => call.mode === "confirm").length, 1);
  });
  await check("429 retry is explicit, waits, reuses final token and never repeats acknowledged writes", async () => {
    let now = 1000, writes = 0;
    const { flow, calls } = fixture(101, { now: () => now, intercept: mode => { if (mode === "confirm" && ++writes === 2) throw new ImportRequestError(429, "IMPORT_BUSY", false, "rate-test", 2); } });
    await flow.select(file); await flow.confirm(); const before = calls.length;
    await flow.startPreview(); await flow.select(file); assert.equal(calls.length, before);
    await flow.retry(); assert.equal(calls.length, before); now += 2000; await flow.retry();
    assert.equal(flow.getSnapshot().phase, "completed"); assert.equal(importCounts(flow.getSnapshot().report).created, 101);
    const confirms = calls.filter(call => call.mode === "confirm"); assert.deepEqual(confirms.map(call => call.body.rows[0].rowNumber), [2, 52, 52, 102]);
    assert.ok(confirms.every(call => call.body.previewToken === "token-101"));
  });
  await check("expired preview cannot write; requires a new complete preview", async () => {
    let now = 1000; const { flow, calls } = fixture(1, { now: () => now }); await flow.select(file); now += 30 * 60_000;
    await flow.confirm(); assert.equal(flow.getSnapshot().failure.status, 409); assert.equal(calls.length, 1);
    await flow.startPreview(); assert.equal(flow.getSnapshot().phase, "ready"); await flow.confirm(); assert.equal(importCounts(flow.getSnapshot().report).created, 1);
  });
  await check("double confirmation is ignored while a write is active", async () => {
    const entered = gate(), leave = gate(); const { flow, calls } = fixture(1, { intercept: async mode => { if (mode === "confirm") { entered.resolve(); await leave.promise; } } });
    await flow.select(file); const first = flow.confirm(); await entered.promise; await flow.confirm(); leave.resolve(); await first;
    assert.equal(calls.filter(call => call.mode === "confirm").length, 1);
  });
  await check("per-row API failures and not_processed retain successful siblings and fields/requestId", async () => {
    const { flow } = fixture(3, { intercept: (mode, body) => mode === "confirm" ? { requestId: "mixed-request", rows: [{ ...resultRows(body.rows)[0], action: "update" }, { rowNumber: 3, action: "error", reason: "Revisa nombre y precio", code: "INVALID_FIELDS", fields: ["name", "price"] }, { rowNumber: 4, action: "not_processed", reason: "Sin tiempo", code: "NOT_PROCESSED" }] } : undefined });
    await flow.select(file); await flow.confirm(); const counts = importCounts(flow.getSnapshot().report);
    assert.equal(counts.updated, 1); assert.equal(counts.errors, 1); assert.equal(counts.notProcessed, 1);
    assert.equal(flow.getSnapshot().report[1].requestId, "mixed-request"); assert.equal(flow.getSnapshot().report[1].fields.length, 2);
  });
  await check("refresh failure cannot remove confirmed results", async () => {
    const { flow } = fixture(1, { refreshThrows: true }); await flow.select(file); await flow.confirm();
    assert.equal(flow.getSnapshot().phase, "completed"); assert.equal(importCounts(flow.getSnapshot().report).created, 1); assert.match(flow.getSnapshot().notice, /reporte se conserva/);
  });
  await check("disposing the workspace never launches a next write", async () => {
    const entered = gate(), leave = gate(); const { flow, calls } = fixture(101, { intercept: async mode => { if (mode === "confirm") { entered.resolve(); await leave.promise; } } });
    await flow.select(file); const operation = flow.confirm(); await entered.promise; flow.dispose(); leave.resolve(); await operation;
    assert.equal(calls.filter(call => call.mode === "confirm").length, 1);
  });
  await check("batches respect 50 rows and reserve token bytes; oversized row becomes local error", async () => {
    assert.deepEqual(importBatches(data(101)).map(batch => batch.length), [50, 50, 1]);
    const rows = [{ rowNumber: 2, name: "Válido", description: "á".repeat(400000) }, { rowNumber: 3, name: "Válido2", description: "á".repeat(400000) }];
    const batches = importBatches(rows); assert.equal(batches.length, 2);
    for (const batch of batches) assert.ok(new TextEncoder().encode(JSON.stringify({ totalRows: 500, rows: batch, previewToken: "x".repeat(524288) })).length < 2 * 1024 * 1024);
    const { flow, calls } = fixture(1, { rows: [{ rowNumber: 2, name: "Grande", description: "x".repeat(2 * 1024 * 1024) }] });
    await flow.select(file); assert.equal(calls.length, 0); assert.equal(importCounts(flow.getSnapshot().report).errors, 1);
  });
  await check("malformed/duplicate/incomplete success reports are rejected, never counted as confirmed", () => {
    const expected = data(2), valid = { success: true, requestId: "req-1", rows: resultRows(expected) };
    assert.throws(() => parseBatchReply({ ...valid, rows: [valid.rows[0], valid.rows[0]] }, "confirm", expected), error => error.uncertain);
    assert.throws(() => parseBatchReply({ ...valid, rows: [valid.rows[0]] }, "confirm", expected), error => error.uncertain);
    assert.throws(() => parseBatchReply(valid, "preview", expected), error => !error.uncertain);
  });
  await check("transport sends JSON only through same-origin proxy and preserves safe failure metadata", async () => {
    const original = globalThis.fetch; let body;
    globalThis.fetch = async (url, options) => { assert.match(url, /^\/api\/backend\/products\/catalog\//); assert.equal(options.credentials, "same-origin"); body = JSON.parse(options.body); return new Response(JSON.stringify({ success: false, error: "IMPORT_BUSY", requestId: "support-id" }), { status: 429 }); };
    try {
      await assert.rejects(requestImportBatch("catalog", "confirm", { rows: data(1), totalRows: 1, previewToken: "opaque" }), error => error.status === 429 && !error.uncertain && error.requestId === "support-id" && error.retrySeconds === 2); assert.ok(Array.isArray(body.rows)); assert.equal(Object.hasOwn(body, "file"), false);
      for (const status of [408, 502, 503]) {
        globalThis.fetch = async () => new Response("{}", { status });
        await assert.rejects(requestImportBatch("catalog", "confirm", { rows: data(1), totalRows: 1, previewToken: "opaque" }), error => error.uncertain);
      }
    }
    finally { globalThis.fetch = original; }
  });
  console.log(JSON.stringify({ passed, failed: 0, productionAccess: false, browserAutomation: false }));
} finally { if (previous) Module._extensions[".ts"] = previous; else delete Module._extensions[".ts"]; }
