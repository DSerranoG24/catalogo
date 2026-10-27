import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import test from "node:test";
import express from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma";
import { makePhotoService, photoName, type PhotoProduct, type PhotoStore } from "./product-photo.service";
import { photoStore } from "../repositories/product-photo.repository";
import { updateProduct } from "../repositories/product.repository";
import { createPublicOrder } from "../repositories/order.repository";
import { findPublicCatalog } from "../repositories/catalog.repository";
import { makePhotoRouter, makeCompletePhotoHandler } from "../routes/product-photo.routes";
import { apiErrorHandler } from "../middlewares/error.middleware";
import type { AuthenticatedRequest } from "../types/auth.types";

const catalogId = randomUUID(), userId = randomUUID(), otherUser = randomUUID();
const image = { buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), mimetype: "image/png", originalname: "IMG_8432.png" };
function fixture() {
  const rows = new Map<string, PhotoProduct>(); const uploaded: string[] = [], removed: string[] = [];
  let broken = false, cleanupBroken = false, cleanupWarnings = 0;
  const store: PhotoStore = {
    owner: async (id, user) => id === catalogId && user === userId ? { archivedAt: null } : null,
    existing: async id => rows.get(id) ?? null,
    create: async data => {
      if (broken) throw new Error("PRIVATE_DATABASE_DETAILS");
      if (rows.has(data.id)) throw new Error("UNIQUE_CONFLICT");
      const result = { id: data.id, name: data.name, needsCompletion: true, active: false }; rows.set(data.id, result); return result;
    },
    complete: async (id, user, input) => {
      if (user !== userId || !rows.has(id)) throw new Error("PRODUCT_NOT_FOUND");
      const result = { id, name: input.name, needsCompletion: false, active: false }; rows.set(id, result); return result;
    },
    pending: async (_catalog, _user, page) => ({ count: rows.size, page, pages: Math.ceil(rows.size / 24), products: [...rows.values()].slice(0, 24).map(row => ({ ...row, price: 0, categoryId: null, description: null, images: [{ url: "private/path" }] })) }),
  };
  const service = makePhotoService({ store, secret: () => "test-secret-only-for-photo-plans-not-a-real-credential", sign: async () => "https://example.invalid/signed",
    upload: async (_buffer, path) => { uploaded.push(path); }, remove: async path => { if (cleanupBroken) throw new Error("PRIVATE_STORAGE_DETAILS"); removed.push(path); }, cleanupFailed: () => { cleanupWarnings++; } });
  return { service, rows, uploaded, removed, breakCreate() { broken = true; }, fixCreate() { broken = false; }, breakCleanup() { cleanupBroken = true; }, get warnings() { return cleanupWarnings; } };
}

test("photo plan enforces 1..30 on server; binds catalog, owner, slot and signature", async () => {
  const f = fixture();
  for (const count of [0, 31, 1000, 1.5]) await assert.rejects(f.service.plan(catalogId, userId, { count }));
  await assert.rejects(f.service.plan(catalogId, otherUser, { count: 1 }), /CATALOG_NOT_FOUND/);
  const plan = await f.service.plan(catalogId, userId, { count: 30 });
  await assert.rejects(f.service.upload(catalogId, userId, plan.token, 30, image), /INVALID_PHOTO_PLAN/);
  await assert.rejects(f.service.upload(catalogId, otherUser, plan.token, 0, image), /INVALID_PHOTO_PLAN/);
  await assert.rejects(f.service.upload(randomUUID(), userId, plan.token, 0, image), /INVALID_PHOTO_PLAN/);
  await assert.rejects(f.service.upload(catalogId, userId, `changed${plan.token}`, 0, image), /INVALID_PHOTO_PLAN/);
  assert.equal(f.uploaded.length, 0);
});

test("photo names reject camera names, UUIDs and long numbers; explicit filename is provisional only", () => {
  for (const name of ["IMG_8432.jpg", "123456789.png", `${randomUUID()}.png`, "WhatsApp Image.jpg"]) assert.equal(photoName(name), "Producto sin completar");
  assert.equal(photoName("Lámpara_de_mesa.png"), "Lámpara de mesa");
});

test("photo retries reuse stable product id; concurrent duplicate compensates its own object", async () => {
  const f = fixture(); const plan = await f.service.plan(catalogId, userId, { count: 1 });
  const [first, second] = await Promise.all([f.service.upload(catalogId, userId, plan.token, 0, image), f.service.upload(catalogId, userId, plan.token, 0, image)]);
  assert.equal(first.id, second.id); assert.equal(first.active, false); assert.equal(first.needsCompletion, true);
  assert.equal(f.rows.size, 1); assert.equal(f.uploaded.length, 2); assert.equal(f.removed.length, 1);
  assert.notEqual(f.uploaded[0], f.uploaded[1]);
  await f.service.upload(catalogId, userId, plan.token, 0, image); assert.equal(f.uploaded.length, 2);
});

test("failed creation removes uploaded object; a failed image does not prevent next item", async () => {
  const f = fixture(); const plan = await f.service.plan(catalogId, userId, { count: 3 });
  f.breakCreate(); await assert.rejects(f.service.upload(catalogId, userId, plan.token, 0, image), /PHOTO_CREATE_FAILED/);
  assert.deepEqual(f.removed, f.uploaded);
  f.fixCreate(); const next = await f.service.upload(catalogId, userId, plan.token, 1, image); assert.equal(next.active, false);
  await assert.rejects(f.service.upload(catalogId, userId, plan.token, 2, { ...image, buffer: Buffer.from("not an image") }), /INVALID_PHOTO_FILE/);
  await assert.rejects(f.service.upload(catalogId, userId, plan.token, 2, { ...image, buffer: Buffer.alloc(2 * 1024 * 1024 + 1) }), /INVALID_PHOTO_FILE/);
  assert.equal(f.rows.size, 1);
});

test("cleanup errors use only fixed warning and never expose storage/database details", async () => {
  const f = fixture(); f.breakCreate(); f.breakCleanup(); const plan = await f.service.plan(catalogId, userId, { count: 1 });
  await assert.rejects(f.service.upload(catalogId, userId, plan.token, 0, image), /^Error: PHOTO_CREATE_FAILED$/);
  assert.equal(f.warnings, 1);
});

test("lost database commit response does not delete an image already referenced by the committed product", async () => {
  let saved: (PhotoProduct & { imagePath: string }) | null = null; const removed: string[] = [];
  const store: PhotoStore = {
    owner: async () => ({ archivedAt: null }), existing: async () => saved,
    create: async data => { saved = { id: data.id, name: data.name, needsCompletion: true, active: false, imagePath: data.path }; throw new Error("COMMIT_RESPONSE_LOST"); },
    complete: async () => { throw new Error("NOT_USED"); }, pending: async () => { throw new Error("NOT_USED"); },
  };
  const service = makePhotoService({ store, secret: () => "local-test-secret", sign: async path => path, upload: async () => {}, remove: async path => { removed.push(path); }, cleanupFailed: () => {} });
  const plan = await service.plan(catalogId, userId, { count: 1 });
  const result = await service.upload(catalogId, userId, plan.token, 0, image);
  assert.equal(result.needsCompletion, true); assert.equal(result.active, false); assert.deepEqual(removed, []); assert.equal("imagePath" in result, false);
});

function repositoryFixture() {
  let row: { id: string; catalogId: string; name: string; active: boolean; needsCompletion: boolean } | undefined;
  let payload: Prisma.ProductCreateArgs | undefined; let locked = false;
  const db = new Proxy(prisma, { get(_target, key) {
    if (key === "$transaction") return async (work: (tx: Prisma.TransactionClient) => Promise<unknown>) => work(db);
    if (key === "$queryRaw") return async (_sql: TemplateStringsArray, ...values: unknown[]) => { assert.deepEqual(values, [catalogId, userId]); locked = true; return [{ id: catalogId, archivedAt: null }]; };
    if (key === "product") return {
      create: async (args: Prisma.ProductCreateArgs) => {
        assert.ok(locked); payload = args;
        row = { id: String(args.data.id), catalogId, name: args.data.name, active: Boolean(args.data.active), needsCompletion: Boolean(args.data.needsCompletion) }; return row;
      },
      findFirst: async (args: Prisma.ProductFindFirstArgs) => {
        if (args.where?.catalog && "userId" in args.where.catalog && args.where.catalog.userId !== userId) return null;
        if (args.where?.needsCompletion === true && !row?.needsCompletion) return null;
        return row ?? null;
      },
      update: async (args: Prisma.ProductUpdateArgs) => { assert.ok(locked && row); const data = args.data; assert.equal(data.active, false); assert.equal(data.needsCompletion, false); row = { ...row, active: false, needsCompletion: false, name: typeof data.name === "string" ? data.name : row.name }; return row; },
      updateMany: async () => { throw new Error("ACTIVATION_MUST_NOT_WRITE"); },
      findMany: async (args: Prisma.ProductFindManyArgs) => { assert.equal(args.where?.active, true); return row?.active ? [row] : []; },
    };
    if (key === "category") return { findFirst: async () => null };
    if (key === "catalog") return { findFirst: async (args: Prisma.CatalogFindFirstArgs) => {
      if (args.select?.products) {
        assert.equal(typeof args.select.products === "object" && args.select.products.where?.active, true);
        return { id: catalogId, products: row?.active ? [row] : [], categories: [], banners: [] };
      }
      return { id: catalogId };
    } };
    if (key === "order") return { create: async () => { throw new Error("DRAFT_ORDER_MUST_NOT_WRITE"); } };
    throw new Error("Unexpected database operation");
  } });
  return { db, get payload() { return payload; }, get row() { return row; } };
}

test("repository creates inactive draft plus first image atomically; draft cannot be activated or ordered", async () => {
  const f = repositoryFixture(); const store = photoStore(f.db); const id = randomUUID();
  const draft = await store.create({ id, catalogId, userId, name: "Producto sin completar", path: "own/catalog/photo.webp" });
  assert.equal(draft.active, false); assert.equal(draft.needsCompletion, true);
  assert.equal(f.payload?.data.price, 0); assert.deepEqual(f.payload?.data.images, { create: { url: "own/catalog/photo.webp", position: 0 } });
  assert.deepEqual((await findPublicCatalog("public-id", f.db))?.products, []);
  await assert.rejects(updateProduct(id, userId, { active: true }, f.db), /PRODUCT_INCOMPLETE/);
  await assert.rejects(createPublicOrder("public-id", { customerName: "Test", customerPhone: "000", customerAddress: "Test", consent: true, items: [{ productId: id, quantity: 1 }] }, f.db));
  assert.equal(f.row?.active, false);
});

test("completing requires ownership/review and keeps product inactive; category must belong to catalog", async () => {
  const f = repositoryFixture(); const store = photoStore(f.db); const id = randomUUID();
  await store.create({ id, catalogId, userId, name: "Provisional", path: "own/photo" });
  await assert.rejects(store.complete(id, otherUser, { name: "Nombre revisado", price: 100, reviewed: true }), /PRODUCT_NOT_FOUND/);
  await assert.rejects(store.complete(id, userId, { name: "Nombre revisado", price: 100, reviewed: true, categoryId: randomUUID() }), /INVALID_PHOTO_CATEGORY/);
  const completed = await store.complete(id, userId, { name: "Nombre revisado", price: 100, reviewed: true });
  assert.equal(completed.needsCompletion, false); assert.equal(completed.active, false);
  await assert.rejects(store.complete(id, userId, { name: "Again", price: 100, reviewed: true }), /PRODUCT_ALREADY_COMPLETE/);
});

test("HTTP rejects count 31 and multi-file bodies; server returns pending total independent of visible page", async () => {
  const f = fixture(); const app = express(); app.use(express.json());
  app.use((req: AuthenticatedRequest, _res, next) => { if (req.headers["x-owner"]) req.user = { id: String(req.headers["x-owner"]), email: "test@example.invalid" }; next(); });
  app.use("/catalog/:catalogId/photos", makePhotoRouter(f.service));
  app.put("/products/:id/complete", makeCompletePhotoHandler(f.service)); app.use(apiErrorHandler);
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  try {
    const address = server.address(); assert.ok(address && typeof address !== "string"); const base = `http://127.0.0.1:${address.port}`;
    const url = `${base}/catalog/${catalogId}/photos`;
    const headers = { "content-type": "application/json", "x-owner": userId };
    assert.equal((await fetch(`${url}/plan`, { method: "POST", headers, body: JSON.stringify({ count: 31 }) })).status, 400);
    assert.equal((await fetch(`${url}/plan`, { method: "POST", headers: { ...headers, "x-owner": otherUser }, body: JSON.stringify({ count: 1 }) })).status, 404);
    assert.equal((await fetch(`${url}/pending`)).status, 401);
    const plan = await f.service.plan(catalogId, userId, { count: 30 });
    for (let index = 0; index < 30; index++) await f.service.upload(catalogId, userId, plan.token, index, image);
    const response = await fetch(`${url}/pending`, { headers: { "x-owner": userId } });
    const body = await response.json(); assert.equal(body.count, 30); assert.equal(body.products.length, 24); assert.equal(response.headers.get("cache-control"), "private, no-store");
    const data = new FormData(); data.append("token", plan.token); data.append("index", "0");
    for (let i = 0; i < 31; i++) data.append("image", new Blob([image.buffer], { type: "image/png" }), "fixture.png");
    assert.equal((await fetch(`${url}/item`, { method: "POST", headers: { "x-owner": userId }, body: data })).status, 400);
    const invalid = await fetch(`${base}/products/${[...f.rows.keys()][0]}/complete`, { method: "PUT", headers, body: JSON.stringify({ name: "Name", price: 100 }) }); assert.equal(invalid.status, 400);
    assert.equal(f.rows.size, 30);
    const singlePlan = await f.service.plan(catalogId, userId, { count: 1 });
    const single = new FormData(); single.append("token", singlePlan.token); single.append("index", "0"); single.append("image", new Blob([image.buffer], { type: "image/png" }), "fixture.png");
    const accepted = await fetch(`${url}/item`, { method: "POST", headers: { "x-owner": userId }, body: single });
    assert.equal(accepted.status, 201); assert.equal((await accepted.json()).product.active, false);
    const tooLarge = new FormData(); tooLarge.append("token", singlePlan.token); tooLarge.append("index", "0"); tooLarge.append("image", new Blob([Buffer.alloc(2 * 1024 * 1024 + 1)], { type: "image/png" }), "large.png");
    assert.equal((await fetch(`${url}/item`, { method: "POST", headers: { "x-owner": userId }, body: tooLarge })).status, 413);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
