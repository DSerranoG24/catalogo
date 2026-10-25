import assert from "node:assert/strict";
import test from "node:test";
import { importBatchSchema } from "../schemas/product-import.schema";
import { makeProductImportService } from "./product-import.service";
import { createImportFixture, importCatalogA as cat, importCatalogB as other, importTestSecret as secret } from "./product-import.fixture";

type Rows = Record<string, unknown>[];
function setup() {
  const fixture = createImportFixture(), service = makeProductImportService(fixture.store);
  const batch = (rows: Rows, totalRows = rows.length, previewToken?: string) => importBatchSchema.parse({ rows, totalRows, previewToken });
  const preview = (rows: Rows, totalRows = rows.length, token?: string) => service.preview(cat, "owner-a", batch(rows, totalRows, token), secret);
  const confirm = (rows: Rows, token: string, totalRows = rows.length) => service.confirm(cat, "owner-a", batch(rows, totalRows, token), secret);
  const run = async (rows: Rows) => confirm(rows, (await preview(rows)).previewToken);
  return { fixture, service, batch, preview, confirm, run };
}

test("new row creates with server slug, existing category and no preview writes", async () => {
  const s = setup(), category = s.fixture.seedCategory(cat, "Artesanía");
  const rows = [{ rowNumber: 2, name: "  Vela ámbar  ", price: 25000, categoryName: "ARTESANÍA" }];
  const plan = await s.preview(rows);
  assert.equal(s.fixture.writes, 0);
  assert.equal(plan.summary.new, 1);
  const report = await s.confirm(rows, plan.previewToken);
  assert.equal(report.summary.new, 1);
  const product = s.fixture.catalog(cat).products[0];
  assert.ok(product);
  assert.equal(product.slug, "vela-ambar");
  assert.equal(product.categoryId, category.id);
  assert.equal(product.stock, 0);
});

test("SKU match takes precedence, updates existing product and preserves slug", async () => {
  const s = setup(), original = s.fixture.seedProduct(cat, { sku: "AbC", slug: "enlace-compartido" });
  const result = await s.run([{ rowNumber: 2, name: "Nombre nuevo", sku: " AbC ", price: 2000 }]);
  assert.equal(result.summary.updates, 1);
  assert.equal(result.rows[0]?.productId, original.id);
  assert.equal(s.fixture.catalog(cat).products[0]?.slug, "enlace-compartido");
});

test("without SKU, name matching ignores case and preserves accents", async () => {
  const s = setup(); s.fixture.seedProduct(cat, { name: "Té" });
  assert.equal((await s.run([{ rowNumber: 2, name: "TÉ", price: 2000 }])).summary.updates, 1);
  assert.equal((await s.run([{ rowNumber: 3, name: "Te", price: 2000 }])).summary.new, 1);
});

test("new SKU plus existing name updates and assigns SKU rather than duplicating", async () => {
  const s = setup(), original = s.fixture.seedProduct(cat, { name: "Artesanía", sku: null });
  const report = await s.run([{ rowNumber: 2, name: "ARTESANÍA", sku: "NUEVO", price: 1500 }]);
  assert.equal(report.summary.updates, 1);
  assert.equal(report.rows[0]?.productId, original.id);
  assert.equal(s.fixture.catalog(cat).products.length, 1);
  assert.equal(s.fixture.catalog(cat).products[0]?.sku, "NUEVO");
});

test("two matching names produce a row error and never choose the first", async () => {
  const s = setup(); s.fixture.seedProduct(cat, { name: "Igual", sku: "A" }); s.fixture.seedProduct(cat, { name: "IGUAL", sku: "B" });
  const report = await s.run([{ rowNumber: 2, name: "igual", price: 1000 }]);
  assert.equal(report.rows[0]?.code, "AMBIGUOUS_PRODUCT"); assert.equal(s.fixture.writes, 0);
});

test("different rows resolving to the same product are both errors", async () => {
  const s = setup(); s.fixture.seedProduct(cat, { name: "Vela", sku: "A" });
  const result = await s.run([{ rowNumber: 2, name: "Vela", price: 1000 }, { rowNumber: 3, name: "Otro nombre", sku: "A", price: 2000 }]);
  assert.equal(result.summary.errors, 2); assert.ok(result.rows.every(r => r.code === "FILE_CONFLICT")); assert.equal(s.fixture.writes, 0);
});

test("conflicts across preview batches invalidate earlier rows before any confirmation", async () => {
  const s = setup();
  const first = [{ rowNumber: 2, name: "Mismo nuevo", price: 1000 }], second = [{ rowNumber: 3, name: "MISMO NUEVO", sku: "A", price: 1000 }];
  const p1 = await s.preview(first, 2), p2 = await s.preview(second, 2, p1.previewToken);
  assert.equal(p1.ready, false); assert.equal(p2.ready, true);
  assert.deepEqual(p2.invalidatedRows, [2, 3]);
  assert.equal((await s.confirm(first, p2.previewToken, 2)).summary.errors, 1);
  assert.equal(s.fixture.writes, 0);
});

test("unknown and foreign categories are row errors, never auto-created", async () => {
  const s = setup(); s.fixture.seedCategory(other, "Solo en B");
  const result = await s.run([{ rowNumber: 2, name: "A", price: 1, categoryName: "Inexistente" }, { rowNumber: 3, name: "B", price: 1, categoryName: "Solo en B" }]);
  assert.ok(result.rows.every(r => r.code === "UNKNOWN_CATEGORY")); assert.equal(s.fixture.catalog(cat).categories.length, 0);
});

test("ambiguous category name is rejected", async () => {
  const s = setup(); s.fixture.seedCategory(cat, "Ropa"); s.fixture.seedCategory(cat, "ROPA");
  assert.equal((await s.run([{ rowNumber: 2, name: "Nuevo", price: 1, categoryName: "ropa" }])).rows[0]?.code, "AMBIGUOUS_CATEGORY");
});

test("blank cells preserve optional fields, category, stock and promotion; zero remains explicit", async () => {
  const s = setup(), category = s.fixture.seedCategory(cat, "Existente");
  s.fixture.seedProduct(cat, { name: "Con datos", sku: "A", brand: "Marca", model: "Modelo", description: "Descripción",
    categoryId: category.id, stock: 9, salePrice: 500, saleStartsAt: new Date("2026-10-01T00:00:00Z"), saleEndsAt: new Date("2026-11-01T00:00:00Z") });
  const row = { rowNumber: 2, name: "Con datos", sku: "", description: " ", brand: null, model: "", categoryName: "", stock: "", price: "", salePrice: "", saleStartsAt: "", saleEndsAt: null };
  assert.equal((await s.run([row])).summary.updates, 1);
  const p = s.fixture.catalog(cat).products[0]; assert.ok(p);
  assert.equal(p.brand, "Marca"); assert.equal(p.model, "Modelo"); assert.equal(p.description, "Descripción");
  assert.equal(p.categoryId, category.id); assert.equal(p.stock, 9); assert.equal(p.salePrice, 500); assert.equal(p.sku, "A");
  assert.equal((await s.run([{ rowNumber: 2, name: "Con datos", stock: 0 }])).summary.updates, 1);
  assert.equal(s.fixture.catalog(cat).products[0]?.stock, 0);
});

test("inactive product updates without reactivation", async () => {
  const s = setup(); s.fixture.seedProduct(cat, { name: "Inactivo", active: false });
  assert.equal((await s.run([{ rowNumber: 2, name: "INACTIVO", price: 500 }])).summary.updates, 1);
  assert.equal(s.fixture.catalog(cat).products[0]?.active, false);
});

test("archived catalog and another owner's catalog reject the entire batch", async () => {
  const s = setup(), batch = s.batch([{ rowNumber: 2, name: "Nuevo", price: 1 }]);
  await assert.rejects(s.service.preview(other, "owner-a", batch, secret), /CATALOG_NOT_FOUND/);
  s.fixture.catalog(cat).archived = true;
  await assert.rejects(s.service.preview(cat, "owner-a", batch, secret), /CATALOG_ARCHIVED/);
  assert.equal(s.fixture.writes, 0);
});

test("mixed batch commits valid rows and rolls back a failing row only", async () => {
  const s = setup(); s.fixture.failRow("Falla");
  const rows = [{ rowNumber: 2, name: "Primero", price: 1 }, { rowNumber: 3, name: "Falla", price: 2 },
    { rowNumber: 4, name: "Inválido", price: -1 }, { rowNumber: 5, name: "Último", price: 3 }];
  const report = await s.run(rows);
  assert.equal(report.summary.new, 2); assert.equal(report.summary.errors, 2); assert.equal(s.fixture.writes, 2);
  assert.deepEqual(s.fixture.catalog(cat).products.map(p => p.name), ["Primero", "Último"]);
});

test("batch and file limits are enforced before processing", async () => {
  const s = setup(), rows = Array.from({ length: 51 }, (_, i) => ({ rowNumber: i + 2, name: `Producto ${i}`, price: 1 }));
  assert.throws(() => s.batch(rows)); assert.throws(() => s.batch(rows.slice(0, 1), 501));
  assert.ok(importBatchSchema.safeParse({ totalRows: 50, rows: rows.slice(0, 50) }).success);
});

test("confirmation revalidates product/category versions and row input", async () => {
  const s = setup(), original = s.fixture.seedProduct(cat, { name: "Existente" });
  const rows = [{ rowNumber: 2, name: "Existente", price: 3000 }], plan = await s.preview(rows);
  original.price = 999;
  assert.equal((await s.confirm(rows, plan.previewToken)).rows[0]?.code, "IMPORT_STATE_CHANGED");
  const newPlan = await s.preview(rows);
  assert.equal((await s.confirm([{ ...rows[0], rowNumber: 2, name: "Existente", price: 4000 }], newPlan.previewToken)).rows[0]?.code, "IMPORT_STATE_CHANGED");
  const category = s.fixture.seedCategory(cat, "Categoría");
  const next = [{ rowNumber: 3, name: "Nuevo", price: 1, categoryName: "Categoría" }], cp = await s.preview(next);
  category.name = "Renombrada";
  assert.equal((await s.confirm(next, cp.previewToken)).summary.errors, 1);
});

test("signed preview cannot be tampered with or used by another owner", async () => {
  const s = setup(), rows = [{ rowNumber: 2, name: "Nuevo", price: 1 }], plan = await s.preview(rows);
  await assert.rejects(s.confirm(rows, plan.previewToken + "changed"), /INVALID_IMPORT_PREVIEW/);
  await assert.rejects(s.service.confirm(cat, "owner-b", s.batch(rows, 1, plan.previewToken), secret), /CATALOG_NOT_FOUND/);
});

test("concurrent confirmations of new-name rows cannot create duplicate products", async () => {
  const s = setup(), rows = [{ rowNumber: 2, name: "Concurrente", price: 1 }];
  const a = await s.preview(rows), b = await s.preview(rows);
  const results = await Promise.all([s.confirm(rows, a.previewToken), s.confirm(rows, b.previewToken)]);
  assert.equal(results.reduce((sum, r) => sum + r.summary.new, 0), 1);
  assert.equal(s.fixture.catalog(cat).products.length, 1);
});

test("slug collision gets numeric suffix, and images/active/IDs cannot be imported", async () => {
  const s = setup(); s.fixture.seedProduct(cat, { name: "Otro nombre", slug: "cafe" });
  assert.equal((await s.run([{ rowNumber: 2, name: "Café", price: 1 }])).summary.new, 1);
  assert.ok(s.fixture.catalog(cat).products.some(p => p.slug === "cafe-2"));
  const result = await s.run([{ rowNumber: 3, name: "No permitido", price: 1, active: true, categoryId: "foreign-id" }]);
  assert.equal(result.rows[0]?.code, "INVALID_ROW");
});

test("promotion rules are reused for new and existing products", async () => {
  const s = setup();
  const report = await s.run([{ rowNumber: 2, name: "Mala oferta", price: 1000, saleEnabled: true, salePrice: 1200,
    saleStartsAt: "2026-10-01T00:00:00Z", saleEndsAt: "2026-11-01T00:00:00Z" }]);
  assert.equal(report.rows[0]?.code, "INVALID_PROMOTION"); assert.equal(s.fixture.writes, 0);
});
