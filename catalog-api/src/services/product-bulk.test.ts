import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import express from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma";
import { makeProductBulkService } from "./product-bulk.service";
import { bulkPreviewSchema, type BulkRequest } from "../schemas/product-bulk.schema";

const catalogId = "11111111-1111-4111-8111-111111111111", owner = "owner";
const secret = "bulk-unit-fixture-key-32-characters-minimum";
const id = (index: number) => `22222222-2222-4222-8222-${String(index).padStart(12, "0")}`;
const version = new Date("2026-10-28T12:00:00Z");
function fixture(count = 3) {
  let rows = Array.from({ length: count }, (_, index) => ({ id: id(index), name: `Producto ${index}`, catalogId,
    updatedAt: new Date(version), price: 100, salePrice: null as number | null, saleStartsAt: null as Date | null,
    saleEndsAt: null as Date | null, categoryId: null as string | null, needsCompletion: false, active: true }));
  let active = false, locked = false, failId: string | null = null, transactions = 0;
  const database = new Proxy(prisma, { get(_target, key) {
    if (key === "$transaction") return async (work: (tx: Prisma.TransactionClient) => Promise<unknown>) => {
      const before = structuredClone(rows); active = true; locked = false; transactions++;
      try { return await work(database); } catch (error) { rows = before; throw error; } finally { active = false; }
    };
    if (key === "$executeRaw") return async () => { assert.ok(active); return 0; };
    if (key === "$queryRaw") return async (sql: TemplateStringsArray | Prisma.Sql, ...values: unknown[]) => {
      assert.ok(active);
      if (Array.isArray(sql)) { assert.deepEqual(values, [catalogId, owner]); locked = true; return [{ id: catalogId, archivedAt: null }]; }
      assert.ok(locked); return rows.map(row => ({ id: row.id }));
    };
    if (key === "category") return { findFirst: async (args: Prisma.CategoryFindFirstArgs) => { assert.ok(active && locked); assert.equal(args.where?.catalogId, catalogId); return null; } };
    if (key === "productImage") return { findMany: async () => { assert.ok(active && locked); return []; } };
    if (key === "product") return {
      findMany: async (args: Prisma.ProductFindManyArgs) => {
        assert.ok(active && locked, "Reading current prices/versions must occur inside the locked transaction");
        assert.equal(args.where?.catalogId, catalogId);
        assert.deepEqual(args.where?.catalog, { userId: owner });
        return structuredClone(rows);
      },
      deleteMany: async (args: Prisma.ProductDeleteManyArgs) => {
        assert.ok(active && locked); if (args.where?.id === failId) throw new Error("fixture-write-failed");
        const before = rows.length; rows = rows.filter(row => row.id !== args.where?.id); return { count: before - rows.length };
      },
      updateMany: async (args: Prisma.ProductUpdateManyArgs) => {
        assert.ok(active && locked); if (args.where?.id === failId) throw new Error("fixture-write-failed");
        const row = rows.find(row => row.id === args.where?.id);
        if (!row) return { count: 0 };
        assert.deepEqual(args.where?.catalog, { userId: owner });
        Object.assign(row, args.data); row.updatedAt = new Date(version.getTime() + 1000); return { count: 1 };
      },
    };
    throw new Error("Unexpected persistence operation");
  } });
  return { service: makeProductBulkService(database), get rows() { return rows; }, get transactions() { return transactions; }, fail(value: string) { failId = value; } };
}
function request(operation: BulkRequest["operation"], count = 3): BulkRequest {
  return { items: Array.from({ length: count }, (_, index) => ({ id: id(index), updatedAt: version.toISOString() })), operation };
}

test("bulk delete rolls every prior deletion back if a later write fails, in ONE confirmation transaction", async () => {
  const f = fixture(); const before = structuredClone(f.rows);
  const preview = await f.service.preview(catalogId, owner, request({ action: "delete" }), secret); assert.ok(preview.token);
  f.fail(id(1));
  await assert.rejects(f.service.confirm(catalogId, owner, preview.token, secret, "ELIMINAR 3"), /fixture-write-failed/);
  assert.deepEqual(f.rows, before); assert.equal(f.transactions, 2);
});

test("discard skips complete or active products and reports an empty eligible subset without error", async () => {
  const f = fixture(); f.rows[0].needsCompletion = true; f.rows[0].active = false; f.rows[1].needsCompletion = true;
  const preview = await f.service.preview(catalogId, owner, request({ action: "discard" }), secret);
  assert.equal(preview.totalSelected, 3); assert.equal(preview.affected, 1); assert.ok(preview.token);
  const result = await f.service.confirm(catalogId, owner, preview.token, secret, "DESCARTAR 3");
  assert.equal(result.changed, 1); assert.equal(result.skipped, 2); assert.equal(f.rows.length, 2);
  const empty = fixture(); const none = await empty.service.preview(catalogId, owner, request({ action: "discard" }), secret);
  assert.equal(none.token, null); assert.equal(none.affected, 0); assert.deepEqual(none.issues, []); assert.equal(empty.rows.length, 3);
});

test("merged price and promotion validation happens in the transaction and refuses an invalid existing offer", async () => {
  const f = fixture(); f.rows[1].salePrice = 80; f.rows[1].saleStartsAt = version; f.rows[1].saleEndsAt = new Date(version.getTime() + 10000);
  const preview = await f.service.preview(catalogId, owner, request({ action: "price", price: 50 }), secret);
  assert.equal(preview.token, null); assert.equal(preview.issues[0]?.code, "INVALID_PROMOTION"); assert.equal(f.rows[0].price, 100);
  const offer = await f.service.preview(catalogId, owner, request({ action: "promotion", promotion: { salePrice: 100, saleStartsAt: version.toISOString(), saleEndsAt: new Date(version.getTime() + 10000).toISOString() } }), secret);
  assert.equal(offer.token, null); assert.equal(offer.issues.length, 3);
});

test("confirmation revalidates current promotion inside the transaction instead of trusting preview", async () => {
  const f = fixture();
  const preview = await f.service.preview(catalogId, owner, request({ action: "price", price: 90 }), secret); assert.ok(preview.token);
  f.rows[2].salePrice = 95; f.rows[2].saleStartsAt = version; f.rows[2].saleEndsAt = new Date(version.getTime() + 10000);
  await assert.rejects(f.service.confirm(catalogId, owner, preview.token, secret), /BULK_REVIEW_REQUIRED/);
  assert.ok(f.rows.every(row => row.price === 100));
});

test("another catalog's category is rejected and explicit categoryId null clears assignment", async () => {
  const f = fixture(); const invalid = await f.service.preview(catalogId, owner, request({ action: "category", categoryId: id(99) }), secret);
  assert.equal(invalid.token, null); assert.equal(invalid.issues[0]?.code, "CATEGORY_CHANGED");
  f.rows[0].categoryId = id(99);
  const preview = await f.service.preview(catalogId, owner, request({ action: "category", categoryId: null }), secret); assert.ok(preview.token);
  await f.service.confirm(catalogId, owner, preview.token, secret); assert.equal(f.rows[0].categoryId, null);
});

test("changed updatedAt, missing/foreign ID and forged identity reject the whole bulk", async () => {
  const f = fixture(); const preview = await f.service.preview(catalogId, owner, request({ action: "price", price: 90 }), secret); assert.ok(preview.token);
  f.rows[1].updatedAt = new Date(version.getTime() + 1000);
  await assert.rejects(f.service.confirm(catalogId, owner, preview.token, secret), /BULK_REVIEW_REQUIRED/);
  assert.ok(f.rows.every(row => row.price === 100));
  await assert.rejects(f.service.confirm(catalogId, "another-owner", preview.token, secret), /INVALID_BULK_PREVIEW/);
  const unavailable = request({ action: "delete" }); unavailable.items[1].id = id(999);
  const result = await f.service.preview(catalogId, owner, unavailable, secret); assert.equal(result.token, null);
  assert.ok(result.issues.some(issue => issue.code === "PRODUCT_UNAVAILABLE")); assert.equal(f.rows.length, 3);
});

test("96 unique items are admitted; 97 and duplicates rejected; maximum preview and confirm bodies fit 32 KiB", async () => {
  const f = fixture(96), input = request({ action: "delete" }, 96);
  assert.equal(bulkPreviewSchema.safeParse(input).success, true);
  assert.equal(bulkPreviewSchema.safeParse(request({ action: "delete" }, 97)).success, false);
  assert.equal(bulkPreviewSchema.safeParse({ ...input, items: [input.items[0], input.items[0]] }).success, false);
  const preview = await f.service.preview(catalogId, owner, input, secret); assert.ok(preview.token);
  assert.ok(Buffer.byteLength(JSON.stringify(input)) < 32768);
  assert.ok(Buffer.byteLength(JSON.stringify({ token: preview.token, confirmation: "ELIMINAR 96" })) < 32768);
  const app = express(); app.use(express.json({ limit: "32kb" })); app.post("/bulk", (_req, res) => res.json({ success: true }));
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(413).json({ error: error instanceof Error ? "BODY_LIMIT" : "ERROR" }));
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening"); const address = server.address(); assert.ok(address && typeof address !== "string");
  try {
    const url = `http://127.0.0.1:${address.port}/bulk`, headers = { "Content-Type": "application/json" };
    assert.equal((await fetch(url, { method: "POST", headers, body: JSON.stringify(input) })).status, 200);
    assert.equal((await fetch(url, { method: "POST", headers, body: JSON.stringify({ token: preview.token, confirmation: "ELIMINAR 96" }) })).status, 200);
    assert.equal((await fetch(url, { method: "POST", headers, body: JSON.stringify({ padding: "x".repeat(32768) }) })).status, 413);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

test("real bulk HTTP routes enforce review, typed destructive total and complete rollback on write failure", async () => {
  process.env.JWT_SECRET ??= secret;
  const { makeProductBulkRouter } = await import("../routes/product-bulk.routes.js");
  const f = fixture(), app = express();
  app.use(express.json({ limit: "32kb" }));
  app.use("/catalog/:catalogId/bulk", makeProductBulkRouter((req, _res, next) => {
    Object.assign(req, { user: { id: owner } }); next();
  }, f.service, () => secret));
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening"); const address = server.address(); assert.ok(address && typeof address !== "string");
  try {
    const base = `http://127.0.0.1:${address.port}/catalog/${catalogId}/bulk`, headers = { "Content-Type": "application/json" };
    const response = await fetch(base + "/preview", { method: "POST", headers, body: JSON.stringify(request({ action: "delete" })) }); assert.equal(response.status, 200);
    const preview = await response.json(); assert.ok(typeof preview.token === "string");
    assert.equal((await fetch(base + "/confirm", { method: "POST", headers, body: JSON.stringify({ token: preview.token }) })).status, 409);
    f.fail(id(1));
    assert.equal((await fetch(base + "/confirm", { method: "POST", headers, body: JSON.stringify({ token: preview.token, confirmation: "ELIMINAR 3" }) })).status, 503);
    assert.equal(f.rows.length, 3);
    assert.equal((await fetch(base + "/preview", { method: "POST", headers, body: JSON.stringify(request({ action: "delete" }, 97)) })).status, 400);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
