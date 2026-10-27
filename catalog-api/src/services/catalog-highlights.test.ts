import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import express from "express";
import type { Prisma, CatalogBanner } from "@prisma/client";
import { prisma } from "../config/prisma";
import { createProduct, updateProduct } from "../repositories/product.repository";
import { saveBanner, removeBanner, reorderBanners, featuredStatus } from "../repositories/catalog-banner.repository";
import { createBannerSchema, allowedBannerUrl } from "../schemas/catalog-banner.schema";
import { createProductSchema, updateProductSchema } from "../schemas/product.schema";
import { resolvePublicHighlights } from "./public-catalog-highlights";
import { makeBannerService } from "./catalog-banner.service";
import { makeBannerRouter } from "../routes/catalog-banner.routes";
import type { AuthenticatedRequest } from "../types/auth.types";
import { imageDimensions } from "../utils/image-validation";
import { findPublicCatalog } from "../repositories/catalog.repository";
import { makePublicCatalogController } from "../controllers/public-catalog.controller";

const catalogId = randomUUID(), productId = randomUUID(), categoryId = randomUUID();
const input = { title: "Novedades", linkType: "EXTERNAL" as const, linkValue: "https://example.invalid/oferta" };

function fixture(featured = 0, count = 0) {
  const products = new Set(Array.from({ length: featured }, (_, index) => `p${index}`));
  const banners = new Map<string, CatalogBanner>();
  for (let i = 0; i < count; i++) { const id = randomUUID(); banners.set(id, { ...input, id, catalogId, imagePath: `old/${id}`, subtitle: null, position: i, active: true, createdAt: new Date(0) }); }
  let queue = Promise.resolve(), locked = false;
  const database = new Proxy(prisma, { get(_target, key) {
    if (key === "$transaction") return (work: (tx: Prisma.TransactionClient) => Promise<unknown>) => {
      const run = queue.then(async () => { locked = false; return work(database); });
      queue = run.then(() => undefined, () => undefined); return run;
    };
    if (key === "$queryRaw") return async (sql: TemplateStringsArray, ...values: unknown[]) => {
      assert.match(sql.join(""), /WHERE id = .*AND "userId" = .*FOR UPDATE/s);
      assert.equal(values[0], catalogId);
      if (values[1] !== "owner") return [];
      locked = true; return [{ id: catalogId, archivedAt: null }];
    };
    if (key === "product") return {
      findFirst: async (args: { where: { id: string; catalogId?: string; needsCompletion?: boolean } }) => {
        if (args.where.needsCompletion) return null;
        if (args.where.catalogId) return args.where.id === productId ? { id: productId } : null;
        return { catalogId };
      },
      count: async (args: { where: { id?: { not: string } } }) => { assert.ok(locked); return [...products].filter(id => id !== args.where.id?.not).length; },
      create: async (args: { data: { featured?: boolean } }) => { assert.ok(locked); const id = randomUUID(); if (args.data.featured) products.add(id); return { id }; },
      updateMany: async (args: { where: { id: string }; data: { featured?: boolean } }) => { assert.ok(locked); if (args.data.featured === true) products.add(args.where.id); if (args.data.featured === false) products.delete(args.where.id); return { count: 1 }; },
    };
    if (key === "category") return { findFirst: async (args: { where: { id: string; catalogId: string } }) => args.where.catalogId === catalogId && args.where.id === categoryId ? { id: categoryId } : null };
    if (key === "catalogBanner") return {
      findFirst: async (args: { where: { id: string; catalogId: string } }) => banners.get(args.where.id) ?? null,
      findMany: async () => { assert.ok(locked); return [...banners.values()]; },
      create: async (args: { data: Omit<CatalogBanner, "id" | "createdAt" | "subtitle" | "active"> & { subtitle?: string | null; active?: boolean } }) => {
        assert.ok(locked); const row = { subtitle: null, active: true, ...args.data, id: randomUUID(), createdAt: new Date() }; banners.set(row.id, row); return row;
      },
      update: async (args: { where: { id: string }; data: Partial<CatalogBanner> }) => {
        assert.ok(locked); const current = banners.get(args.where.id); assert.ok(current); const row = { ...current, ...args.data }; banners.set(row.id, row); return row;
      },
      delete: async (args: { where: { id: string } }) => { assert.ok(locked); banners.delete(args.where.id); },
    };
    throw new Error(`Unexpected database operation ${String(key)}`);
  } });
  return { database, products, banners };
}

test("featured writes serialize: concurrent fifth selections allow only one, sixth fails, repeat and unmark succeed", async () => {
  const f = fixture(4);
  const results = await Promise.allSettled(["a", "b"].map(id => updateProduct(id, "owner", { featured: true }, f.database)));
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(f.products.size, 5);
  const selected = f.products.has("a") ? "a" : "b";
  await updateProduct(selected, "owner", { featured: true }, f.database);
  await updateProduct(selected, "owner", { name: "Sin cambiar destacados" }, f.database);
  assert.equal(f.products.size, 5);
  await assert.rejects(createProduct({ catalogId, name: "Sexto", slug: "sexto", price: 1, featured: true }, "owner", f.database), /FEATURED_LIMIT/);
  await updateProduct(selected, "owner", { featured: false }, f.database);
  assert.equal(f.products.size, 4);
  await assert.rejects(updateProduct("x", "other-owner", { featured: true }, f.database), /CATALOG_NOT_FOUND/);
});

test("private featured status warns after deactivation or deletion leaves fewer than three active selections", async () => {
  const rows = [0, 1, 2].map(index => ({ id: String(index), name: `Producto ${index}`, active: true }));
  const database = new Proxy(prisma, { get(_target, key) {
    if (key === "catalog") return { findFirst: async (args: { where: { id: string; userId: string } }) => args.where.id === catalogId && args.where.userId === "owner" ? { id: catalogId } : null };
    if (key === "product") return { findMany: async (args: { where: { catalogId: string; catalog: { userId: string }; featured: boolean } }) => {
      assert.deepEqual(args.where, { catalogId, catalog: { userId: "owner" }, featured: true }); return rows;
    } };
    throw new Error("Unexpected database call");
  } });
  assert.equal((await featuredStatus(catalogId, "owner", database)).visible, true);
  rows[0].active = false;
  const inactive = await featuredStatus(catalogId, "owner", database);
  assert.equal(inactive.validCount, 2); assert.ok(inactive.warning); assert.equal(inactive.visible, false);
  rows.shift(); assert.ok((await featuredStatus(catalogId, "owner", database)).warning);
  await assert.rejects(featuredStatus(catalogId, "other-owner", database), /CATALOG_NOT_FOUND/);
});

test("featured schema accepts drafts, rejects non-booleans, and omission preserves persistence", () => {
  assert.equal(updateProductSchema.parse({ featured: false }).featured, false);
  assert.equal(updateProductSchema.safeParse({ featured: "true" }).success, false);
  assert.equal("featured" in createProductSchema.parse({ name: "Uno", slug: "uno", price: 0 }), false);
});

test("banner writes serialize: only one concurrent third insert; ownership, occupied slots, reorder and removal", async () => {
  const f = fixture(0, 2);
  const results = await Promise.allSettled([0, 1].map(() => saveBanner(catalogId, "owner", undefined, input, "new/path", f.database)));
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(f.banners.size, 3);
  await assert.rejects(saveBanner(catalogId, "owner", undefined, input, "fourth/path", f.database), /BANNER_LIMIT/);
  await assert.rejects(saveBanner(catalogId, "other-owner", undefined, input, "foreign/path", f.database), /CATALOG_NOT_FOUND/);
  const ids = [...f.banners.keys()];
  await assert.rejects(saveBanner(catalogId, "owner", ids[0], { position: 1 }, undefined, f.database), /BANNER_POSITION_OCCUPIED/);
  await reorderBanners(catalogId, "owner", [...ids].reverse(), f.database);
  assert.equal(f.banners.get(ids[2])?.position, 0);
  await assert.rejects(reorderBanners(catalogId, "owner", [randomUUID()], f.database), /BANNER_ORDER_INVALID/);
  await removeBanner(catalogId, "owner", ids[0], f.database);
  assert.equal(f.banners.size, 2);
});

test("banner targets validate catalog membership and external protocols without fetching", async () => {
  const f = fixture();
  for (const linkValue of ["javascript:alert(1)", "data:text/html,bad", "ftp://example.invalid", "/relative", "https://user:password@example.invalid"]) {
    assert.equal(allowedBannerUrl(linkValue), false);
    assert.equal(createBannerSchema.safeParse({ ...input, linkValue }).success, false);
  }
  for (const linkType of ["PRODUCT", "CATEGORY"] as const) {
    await assert.rejects(saveBanner(catalogId, "owner", undefined, { ...input, linkType, linkValue: randomUUID() }, "path", f.database), /BANNER_TARGET_INVALID/);
    await saveBanner(catalogId, "owner", undefined, { ...input, linkType, linkValue: linkType === "PRODUCT" ? productId : categoryId }, "path", f.database);
  }
  await saveBanner(catalogId, "owner", undefined, { ...input, linkValue: "http://example.invalid" }, "path", f.database);
});

test("public highlights resolve from the full active collection, gate at three, cap at five, and omit individual broken targets", () => {
  const products = Array.from({ length: 30 }, (_, i) => ({ id: String(i), featured: i >= 24 }));
  const banners = [
    { linkType: "PRODUCT", linkValue: "24", position: 2 },
    { linkType: "PRODUCT", linkValue: "foreign-or-inactive", position: 0 },
    { linkType: "CATEGORY", linkValue: "inactive-or-foreign", position: 0 },
    { linkType: "EXTERNAL", linkValue: "javascript:alert(1)", position: 0 },
    { linkType: "CATEGORY", linkValue: categoryId, position: 0 },
    { linkType: "EXTERNAL", linkValue: "https://example.invalid", position: 1 },
  ];
  const resolved = resolvePublicHighlights(products, [{ id: categoryId }], banners);
  assert.equal(resolved.featuredProducts.length, 5);
  assert.equal(products.slice(0, 20).some(product => product.featured), false);
  assert.deepEqual(resolved.banners.map(banner => banner.position), [0, 1, 2]);
  for (let count = 0; count <= 5; count++) {
    const active = products.filter(product => product.featured).slice(0, count);
    assert.equal(resolvePublicHighlights(active, [], []).featuredProducts.length, count < 3 ? 0 : count);
  }
});

test("public repository scopes publication and active relations; HTTP signs banners individually and reuses signed featured prices", async () => {
  const products = Array.from({ length: 25 }, (_, index) => ({
    id: String(index), featured: index >= 22, name: `Producto ${index}`, slug: `p-${index}`, price: 1000,
    salePrice: null, saleStartsAt: null, saleEndsAt: null, images: [],
  }));
  const banners = ["broken-sign", "good", "foreign"].map((imagePath, position) => ({ id: imagePath, imagePath, title: imagePath, subtitle: null,
    linkType: "PRODUCT", linkValue: imagePath === "foreign" ? "not-in-this-catalog" : "22", position }));
  const database = new Proxy(prisma, { get(_target, key) {
    if (key === "catalog") return { findFirst: async (args: Prisma.CatalogFindFirstArgs) => {
      assert.equal(args.where?.active, true); assert.equal(args.where?.archivedAt, null);
      const p = args.select?.products, c = args.select?.categories, b = args.select?.banners;
      assert.ok(p && typeof p === "object"); assert.deepEqual(p.where, { active: true });
      assert.ok(c && typeof c === "object"); assert.deepEqual(c.where, { active: true });
      assert.ok(b && typeof b === "object"); assert.deepEqual(b.where, { active: true });
      assert.equal(p.skip, undefined); assert.equal(p.take, undefined);
      return args.where?.publicId === "published" ? { publicId: "published", logoUrl: null, products, categories: [], banners } : null;
    } };
    throw new Error("Unexpected database call");
  } });
  const app = express();
  app.get("/c/:publicId", makePublicCatalogController({ find: id => findPublicCatalog(id, database), signCategory: async category => category,
    sign: async path => { if (path === "broken-sign") throw new Error("STORAGE_FAILED"); return `https://example.invalid/${path}`; } }));
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  try {
    const base = `http://127.0.0.1:${address.port}/c/`;
    assert.equal((await fetch(base + "inactive-or-archived")).status, 404);
    const response = await fetch(base + "published?page=2"); assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.catalog.products.length, 25);
    assert.equal(body.catalog.featuredProducts.length, 3);
    assert.equal(body.catalog.featuredProducts[0].price, 1000);
    assert.equal("salePrice" in body.catalog.featuredProducts[0], false);
    assert.deepEqual(body.catalog.banners.map((banner: { id: string }) => banner.id), ["good"]);
    assert.equal(body.catalog.banners[0].imageUrl, "https://example.invalid/good");
  } finally { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});

function png(width: number, height: number) {
  const bytes = Buffer.alloc(33); Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes); bytes.writeUInt32BE(13, 8); bytes.write("IHDR", 12); bytes.writeUInt32BE(width, 16); bytes.writeUInt32BE(height, 20); return bytes;
}
test("dimension reader handles PNG, progressive JPEG and WebP variants, truncation and invalid headers", () => {
  assert.deepEqual(imageDimensions(png(2400, 1200)), { width: 2400, height: 1200 });
  const jpeg = Buffer.from([255,216,255,194,0,11,8,0,100,9,97,1,1,17,0]);
  assert.deepEqual(imageDimensions(jpeg), { width: 2401, height: 100 });
  for (const type of ["VP8X", "VP8L", "VP8 "]) {
    const data = Buffer.alloc(type === "VP8L" ? 6 : 10);
    if (type === "VP8X") { data.writeUIntLE(2399, 4, 3); data.writeUIntLE(1199, 7, 3); }
    if (type === "VP8L") { data[0] = 47; data.writeUInt32LE(2399 | (1199 << 14), 1); }
    if (type === "VP8 ") { Buffer.from([157,1,42]).copy(data, 3); data.writeUInt16LE(2400, 6); data.writeUInt16LE(1200, 8); }
    const header = Buffer.alloc(20); header.write("RIFF"); header.writeUInt32LE(12 + data.length, 4); header.write("WEBP", 8); header.write(type, 12); header.writeUInt32LE(data.length, 16);
    assert.deepEqual(imageDimensions(Buffer.concat([header, data])), { width: 2400, height: 1200 });
  }
  for (const bytes of [Buffer.alloc(0), png(0, 10), png(2, 3).subarray(0, 20), jpeg.subarray(0, 9), Buffer.from("RIFF0000WEBP")]) assert.equal(imageDimensions(bytes), null);
});

function serviceFixture() {
  const f = fixture(); const events: string[] = []; let fail = false;
  const service = makeBannerService({
    owner: async (_id, user) => user === "owner" ? { id: catalogId } : null,
    list: async () => [...f.banners.values()], featured: async () => ({ products: [], selectedCount: 0, validCount: 0, visible: false, warning: null }),
    save: async (catalog, user, id, data, path) => { events.push("save"); if (fail) throw new Error("DB_FAILED"); return saveBanner(catalog, user, id, data, path, f.database); },
    remove: async (catalog, user, id) => removeBanner(catalog, user, id, f.database),
    reorder: async (catalog, user, ids) => reorderBanners(catalog, user, ids, f.database),
    upload: async (_buffer, path) => { events.push(`upload:${path}`); }, deleteImage: async path => { events.push(`delete:${path}`); }, sign: async path => `https://example.invalid/${path}`,
  });
  return { ...f, service, events, fail: () => { fail = true; } };
}

test("banner storage persists paths, compensates failed writes, and deletes replaced images only after commit", async () => {
  const f = serviceFixture(); const file = { buffer: png(100, 100), mimetype: "image/png" };
  const banner = await f.service.save(catalogId, "owner", undefined, input, file);
  assert.match(banner.imagePath, new RegExp(`^${catalogId}/banners/[a-f0-9-]+\\.png$`));
  await f.service.save(catalogId, "owner", banner.id, {}, file);
  assert.ok(f.events.indexOf(`delete:${banner.imagePath}`) > f.events.lastIndexOf("save"));
  const uploadsBefore = f.events.length;
  await assert.rejects(f.service.save(catalogId, "other", undefined, input, file), /CATALOG_NOT_FOUND/);
  assert.equal(f.events.length, uploadsBefore);
  f.fail(); await assert.rejects(f.service.save(catalogId, "owner", undefined, input, file), /DB_FAILED/);
  assert.match(f.events.at(-1) ?? "", /^delete:/);
});

test("banner HTTP upload enforces MIME/signature/dimensions and preserves metadata-only updates", async () => {
  const f = serviceFixture(); const app = express(); app.use(express.json());
  app.use((req: AuthenticatedRequest, _res, next) => { req.user = { id: "owner", email: "test@example.invalid", emailVerifiedAt: null, hasLocalPassword: false }; next(); });
  app.use("/catalogs/:id/banners", makeBannerRouter(f.service));
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}/catalogs/${catalogId}/banners`;
  const post = async (bytes: Buffer, mime = "image/png") => { const body = new FormData(); for (const [key, value] of Object.entries(input)) body.set(key, value); body.set("image", new Blob([new Uint8Array(bytes)], { type: mime }), "banner.png"); return fetch(base, { method: "POST", body }); };
  try {
    for (const [bytes, mime] of [[png(2401, 100), "image/png"], [png(100, 2401), "image/png"], [Buffer.from("bad"), "image/png"], [png(100, 100), "image/jpeg"], [png(100, 100), "image/svg+xml"]] as const) assert.equal((await post(bytes, mime)).status, 400);
    const response = await post(png(2400, 100)); assert.equal(response.status, 201);
    const id = [...f.banners.keys()][0];
    assert.equal((await fetch(`${base}/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "Actualizado" }) })).status, 200);
    assert.equal(f.banners.get(id)?.title, "Actualizado");
    assert.equal((await fetch(`${base}/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ linkValue: "javascript:alert(1)" }) })).status, 400);
  } finally { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
