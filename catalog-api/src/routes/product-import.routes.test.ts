import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import express from "express";
import { z } from "zod";
import { AuthenticatedRequest } from "../types/auth.types";
import { makeProductImportService } from "../services/product-import.service";
import { createImportFixture, importCatalogA as cat, importCatalogB as other, importTestSecret } from "../services/product-import.fixture";

async function withApi(verify: (base: string, fixture: ReturnType<typeof createImportFixture>) => Promise<void>) {
  process.env.JWT_SECRET = importTestSecret;
  const { makeProductImportRouter } = await import("./product-import.routes.js");
  const { apiErrorHandler } = await import("../middlewares/error.middleware.js");
  const fixture = createImportFixture(), app = express();
  app.use("/catalog/:catalogId/import", makeProductImportRouter((req: AuthenticatedRequest, res, next) => {
    const owner = req.headers["x-test-owner"];
    if (owner !== "owner-a" && owner !== "owner-b") return res.status(401).json({ success: false });
    req.user = { id: owner, email: "local-test@example.invalid" };
    next();
  }, makeProductImportService(fixture.store)));
  app.use(express.json({ limit: "32kb" }));
  app.post("/ordinary", (_req, res) => { res.json({ success: true }); });
  app.use(apiErrorHandler);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  try { await verify(`http://127.0.0.1:${address.port}`, fixture); }
  finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}
const jsonHeaders = { "content-type": "application/json", "x-test-owner": "owner-a" };
const validRow = { rowNumber: 2, name: "Producto", price: 1000 };

test("import HTTP requires authentication and rejects foreign or archived catalogs", async () => {
  await withApi(async (base, fixture) => {
    const body = JSON.stringify({ totalRows: 1, rows: [validRow] });
    assert.equal((await fetch(`${base}/catalog/${cat}/import/preview`, { method: "POST", headers: { "content-type": "application/json" }, body })).status, 401);
    assert.equal((await fetch(`${base}/catalog/${other}/import/preview`, { method: "POST", headers: jsonHeaders, body })).status, 404);
    fixture.catalog(cat).archived = true;
    assert.equal((await fetch(`${base}/catalog/${cat}/import/preview`, { method: "POST", headers: jsonHeaders, body })).status, 409);
    assert.equal(fixture.writes, 0);
  });
});

test("50 JSON rows can exceed 32 KB only on import routes; ordinary parser remains unchanged", async () => {
  await withApi(async (base, fixture) => {
    const rows = Array.from({ length: 50 }, (_, i) => ({ rowNumber: i + 2, name: `Producto ${i}`, price: i, description: "x".repeat(2000) }));
    const body = JSON.stringify({ totalRows: 50, rows });
    assert.ok(Buffer.byteLength(body) > 32 * 1024);
    assert.equal((await fetch(`${base}/ordinary`, { method: "POST", headers: jsonHeaders, body })).status, 413);
    const response = await fetch(`${base}/catalog/${cat}/import/preview`, { method: "POST", headers: jsonHeaders, body });
    assert.equal(response.status, 200);
    const preview = z.object({ previewToken: z.string(), ready: z.literal(true), summary: z.object({ new: z.literal(50) }) }).parse(await response.json());
    assert.equal(fixture.writes, 0);
    const confirmed = await fetch(`${base}/catalog/${cat}/import/confirm`, { method: "POST", headers: jsonHeaders,
      body: JSON.stringify({ totalRows: 50, rows, previewToken: preview.previewToken }) });
    assert.equal(confirmed.status, 200);
    assert.equal(fixture.writes, 50);
  });
});

test("HTTP rejects more than 50 rows, missing preview, non-JSON files and oversized bodies", async () => {
  await withApi(async base => {
    const post = (route: string, body: string, headers = jsonHeaders) => fetch(`${base}/catalog/${cat}/import/${route}`, { method: "POST", headers, body });
    const rows = Array.from({ length: 51 }, (_, i) => ({ ...validRow, rowNumber: i + 2 }));
    assert.equal((await post("preview", JSON.stringify({ totalRows: 51, rows }))).status, 400);
    assert.equal((await post("confirm", JSON.stringify({ totalRows: 1, rows: [validRow] }))).status, 409);
    assert.equal((await post("preview", "not an uploaded workbook", { ...jsonHeaders, "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })).status, 415);
    assert.equal((await post("preview", JSON.stringify({ padding: "x".repeat(2 * 1024 * 1024) }))).status, 413);
  });
});

test("specific per-owner/catalog limiter rejects abusive import traffic", async () => {
  await withApi(async base => {
    let status = 0;
    for (let attempt = 0; attempt < 61; attempt++) {
      status = (await fetch(`${base}/catalog/${cat}/import/preview`, { method: "POST", headers: jsonHeaders, body: "{}" })).status;
    }
    assert.equal(status, 429);
  });
});
