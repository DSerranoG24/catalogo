import assert from "node:assert/strict";
import fs from "node:fs";
import Module, { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url), previous = Module._extensions[".ts"];
Module._extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);
const { uploadPhotoSequence } = require("../lib/product-photo-flow.ts");
const { backendBodyLimit } = require("../lib/backend-proxy-limits.ts");
if (previous) Module._extensions[".ts"] = previous; else delete Module._extensions[".ts"];
const files = Array.from({ length: 3 }, (_, i) => new File(["fixture"], `Foto ${i}.png`, { type: "image/png" }));
let passed = 0;
async function check(name, work) { await work(); passed++; console.log(`PASS ${name}`); }
await check("one failed preparation and one lost response preserve siblings; no retries", async () => {
  const sent = [], progress = [];
  const rows = await uploadPhotoSequence(files, {
    prepare: async file => { if (file.name === "Foto 0.png") throw new Error("Unreadable"); return file; },
    send: async (_file, index) => { sent.push(index); if (index === 1) throw new Error("Lost response"); return { id: "created" }; },
    stopped: () => false, fatal: () => false, progress: rows => progress.push(rows),
  });
  assert.deepEqual(rows.map(row => row.status), ["failed", "unknown", "created"]); assert.deepEqual(sent, [1, 2]); assert.ok(progress.length);
});
await check("stop waits for current upload and prevents subsequent preparation", async () => {
  let stop = false; const prepared = [], sent = [];
  const rows = await uploadPhotoSequence(files, {
    prepare: async file => { prepared.push(file.name); return file; },
    send: async (_file, index) => { sent.push(index); stop = true; return { id: "created" }; },
    stopped: () => stop, fatal: () => false, progress: () => {},
  });
  assert.deepEqual(sent, [0]); assert.equal(prepared.length, 1); assert.deepEqual(rows.map(row => row.status), ["created", "not_processed", "not_processed"]);
});
await check("stop during compression sends no file", async () => {
  let stop = false;
  const rows = await uploadPhotoSequence(files, { prepare: async file => { stop = true; return file; }, send: async () => { throw new Error("MUST_NOT_SEND"); }, stopped: () => stop, fatal: () => false, progress: () => {} });
  assert.ok(rows.every(row => row.status === "not_processed"));
});
await check("fatal authorization/rate error prevents following uploads without discarding previous results", async () => {
  let requests = 0;
  const rows = await uploadPhotoSequence(files, { prepare: async file => file, send: async () => { requests++; if (requests === 2) throw new Error("Expired session"); return { id: "created" }; }, stopped: () => false, fatal: () => true, progress: () => {} });
  assert.equal(requests, 2); assert.deepEqual(rows.map(row => row.status), ["created", "unknown", "not_processed"]);
});
await check("strictly sequential compression and upload, maximum one file in flight", async () => {
  let inFlight = 0; const order = [];
  await uploadPhotoSequence(files, {
    prepare: async file => { assert.equal(inFlight++, 0); await Promise.resolve(); order.push("prepare"); return file; },
    send: async () => { assert.equal(inFlight, 1); order.push("send"); inFlight--; return { id: "created" }; },
    stopped: () => false, fatal: () => false, progress: () => {},
  });
  assert.deepEqual(order, ["prepare", "send", "prepare", "send", "prepare", "send"]);
});
await check("client rejects 31 before preparation; server independently validates the same bound", async () => {
  await assert.rejects(uploadPhotoSequence(Array.from({ length: 31 }, () => files[0]), { prepare: async () => { throw new Error("MUST_NOT_PREPARE"); }, send: async () => { throw new Error("MUST_NOT_SEND"); }, stopped: () => false, fatal: () => false, progress: () => {} }), /30/);
});
await check("photo proxy caps one 2MiB image plus bounded multipart envelope without changing legacy uploads", () => {
  assert.equal(backendBodyLimit("POST", ["products", "catalog", "11111111-1111-4111-8111-111111111111", "photos", "item"], "multipart/form-data; boundary=fixture"), 2 * 1024 * 1024 + 16 * 1024);
  assert.equal(backendBodyLimit("POST", ["product-images", "product", "fixture"], "multipart/form-data; boundary=fixture"), 5 * 1024 * 1024 + 64 * 1024);
});
console.log(JSON.stringify({ passed, failed: 0, productionAccess: false, realDatabase: false }));
