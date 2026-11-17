import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { buildProductImageOrphanReport, listingOnlyFetch, type ListedObject, type ReferenceSnapshot } from "./report-product-image-orphans";

const catalog = "11111111-1111-4111-8111-111111111111", product = "22222222-2222-4222-8222-222222222222";
const file = (n: number) => `33333333-3333-4333-8333-${String(n).padStart(12, "0")}.jpg`;
const path = (n: number) => `${catalog}/${product}/${file(n)}`;
const now = new Date("2026-10-30T12:00:00Z"), old = "2026-10-28T12:00:00Z";
const object = (n: number, options: Partial<ListedObject> = {}): ListedObject => ({ name: file(n), id: `object-${n}`, created_at: old, updated_at: old, metadata: { size: 10 }, ...options });
const empty = (): ReferenceSnapshot => ({ catalogIds: [catalog], references: [], closurePrefixes: [] });
function listing(entries: ListedObject[]) {
  return async (prefix: string, offset: number) => {
    if (!prefix) return [{ name: catalog, id: null }];
    if (prefix === catalog) return [{ name: product, id: null }];
    return entries.slice(offset, offset + 100);
  };
}

test("report walks levels and all pages, counts bytes, and excludes jpeg/jpg/png/webp references from every source", async () => {
  const snapshot = empty();
  const sources = ["ProductImage.url", "Catalog.logoUrl", "Category.imageUrl", "CatalogBanner.imagePath", "ProductImageCleanupTask.path", "AccountClosureJob.pendingPaths"];
  snapshot.references = sources.map((source, i) => ({ source, id: String(i), catalogId: catalog, value: path(i) }));
  let reads = 0;
  const report = await buildProductImageOrphanReport({ readReferences: async () => { reads++; return snapshot; }, list: listing(Array.from({ length: 205 }, (_, i) => object(i))) }, now);
  assert.equal(reads, 2); assert.equal(report.counts.objects, 205); assert.equal(report.counts.candidates, 199);
  assert.equal(report.exclusions.filter(item => item.reason === "REFERENCED").length, 6);
  assert.equal(report.knownBytes.total, 2050); assert.equal(report.candidates[0].ageHours, 48);
  const extensions = ["jpeg", "jpg", "png", "webp"];
  const variants = await buildProductImageOrphanReport({ readReferences: async () => empty(), list: listing(extensions.map((ext, i) => object(i, { name: file(i).replace("jpg", ext) }))) }, now);
  assert.equal(variants.candidates.length, 4);
});

test("recent, boundary, invalid, absent and inconsistent dates cannot become candidates", async () => {
  const entries = [object(0, { updated_at: "2026-10-30T11:00:00Z" }), object(1, { created_at: "2026-10-29T12:00:00Z", updated_at: "2026-10-29T12:00:00Z" }),
    object(2, { created_at: null }), object(3, { updated_at: "bad-date" }), object(4, { created_at: "2026-02-30T12:00:00Z" }), object(5, { updated_at: "2026-10-27T12:00:00Z" })];
  const report = await buildProductImageOrphanReport({ readReferences: async () => empty(), list: listing(entries) }, now);
  assert.equal(report.candidates.length, 0); assert.equal(report.exclusions.length, 6);
  assert.ok(report.exclusions.every(item => ["MISSING_OR_INVALID_DATE", "LESS_THAN_OR_EQUAL_TO_24_HOURS"].includes(item.reason)));
});

test("second full reference read protects new references; removed references are conservatively protected too", async () => {
  let reads = 0;
  const report = await buildProductImageOrphanReport({ readReferences: async () => {
    const snapshot = empty(); snapshot.references = [{ source: "ProductImage.url", id: "image", catalogId: catalog, value: path(reads++ === 0 ? 0 : 1) }]; return snapshot;
  }, list: listing([object(0), object(1), object(2)]) }, now);
  assert.equal(reads, 2); assert.deepEqual(report.candidates.map(item => item.path), [path(2)]);
});

test("unknown historical URLs block their catalog and never leak into report; unscoped anomaly blocks everything", async () => {
  for (const scope of [catalog, null]) {
    const snapshot = empty(); snapshot.references = [{ source: "ProductImage.url", id: "image", catalogId: scope,
      value: "https://private.invalid/storage/v1/object/sign/product-images/a?token=DO_NOT_PRINT" }];
    const report = await buildProductImageOrphanReport({ readReferences: async () => snapshot, list: listing([object(0)]) }, now);
    assert.equal(report.candidates.length, 0); assert.equal(report.anomalies.length, 1);
    assert.equal(report.globalBlock, scope === null); assert.ok(!JSON.stringify(report).includes("DO_NOT_PRINT"));
  }
});

test("a cross-catalog reference protects its target and blocks both scopes rather than declaring it orphaned", async () => {
  const snapshot = empty(); snapshot.catalogIds.push(product);
  snapshot.references = [{ source: "ProductImage.url", id: "image", catalogId: product, value: path(0) }];
  const report = await buildProductImageOrphanReport({ readReferences: async () => snapshot, list: listing([object(0), object(1)]) }, now);
  assert.equal(report.candidates.length, 0); assert.equal(report.exclusions[0].reason, "REFERENCED");
  assert.deepEqual(report.blockedCatalogIds, [catalog, product]);
});

test("missing catalog, closure scope, non-product paths and optional nulls are safely classified", async () => {
  const snapshot = empty(); snapshot.references = [{ source: "Catalog.logoUrl", id: catalog, catalogId: catalog, value: null, optional: true }];
  const others = ["branding", "banners", `categories/${product}`];
  const list = async (prefix: string, offset: number): Promise<ListedObject[]> => {
    if (!prefix) return [{ name: catalog, id: null }];
    if (prefix === catalog) return [{ name: product, id: null }, { name: "branding", id: null }, { name: "banners", id: null }, { name: "categories", id: null }];
    if (prefix === `${catalog}/categories`) return [{ name: product, id: null }];
    return offset ? [] : [object(0)];
  };
  const report = await buildProductImageOrphanReport({ readReferences: async () => snapshot, list }, now);
  assert.equal(report.candidates.length, 1); assert.equal(report.outOfScope.length, others.length); assert.equal(report.anomalies.length, 0);
  const missing = await buildProductImageOrphanReport({ readReferences: async () => ({ ...empty(), catalogIds: [] }), list: listing([object(0)]) }, now);
  assert.equal(missing.exclusions[0].reason, "CATALOG_MISSING_OR_CHANGED_REVIEW");
  snapshot.closurePrefixes = [catalog];
  const closing = await buildProductImageOrphanReport({ readReferences: async () => snapshot, list: listing([object(0)]) }, now);
  assert.equal(closing.exclusions[0].reason, "ACCOUNT_CLOSURE_SCOPE");
});

test("list/read failures produce sanitized incomplete report without actionable candidates", async () => {
  let reads = 0;
  const report = await buildProductImageOrphanReport({ readReferences: async () => { reads++; return empty(); }, list: async () => { throw new Error("SECRET_PROVIDER_DETAILS"); } }, now);
  assert.equal(reads, 2); assert.equal(report.complete, false); assert.equal(report.globalBlock, true); assert.equal(report.candidates.length, 0);
  assert.ok(!JSON.stringify(report).includes("SECRET_PROVIDER_DETAILS"));
  let index = 0;
  const finalFailed = await buildProductImageOrphanReport({ readReferences: async () => { if (index++) throw new Error("private"); return empty(); }, list: listing([object(0)]) }, now);
  assert.equal(finalFailed.complete, false); assert.equal(finalFailed.candidates.length, 0);
});

test("Storage transport allows only listing the configured bucket and blocks mutation or redirects", async () => {
  let calls = 0;
  const transport: typeof fetch = async (_input, options) => { calls++; assert.equal(options?.redirect, "error"); return new Response("{}"); };
  const safeFetch = listingOnlyFetch("https://storage.invalid", transport);
  await safeFetch("https://storage.invalid/storage/v1/object/list/product-images", { method: "POST" });
  for (const [url, method] of [["https://storage.invalid/storage/v1/object/product-images/a", "DELETE"], ["https://storage.invalid/storage/v1/object/list/other", "POST"], ["https://elsewhere.invalid/storage/v1/object/list/product-images", "POST"]]) {
    await assert.rejects(safeFetch(url, { method }), /READ_ONLY_STORAGE_TRANSPORT/);
  }
  assert.equal(calls, 1);
  const source = await readFile(new URL("report-product-image-orphans.ts", `file:///${__dirname.replaceAll("\\", "/")}/`), "utf8");
  assert.doesNotMatch(source, /\.remove\s*\(|\.createMany\s*\(|\.deleteMany\s*\(|enqueueProductImages|from ["'][^"']*worker/);
});
