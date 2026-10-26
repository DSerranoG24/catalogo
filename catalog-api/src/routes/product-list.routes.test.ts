import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import express from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma";
import { productListQuery } from "../schemas/product-list.schema";
import { listProductPage, productListOrder, productListWhere, readProductPage, suggestProducts, suggestionSql, type ListedProduct } from "../repositories/product-list.repository";
import { makeProductListingService } from "../services/product-list.service";
import { makeProductListingRouter } from "./product-list.routes";
import type { AuthenticatedRequest } from "../types/auth.types";

const catalogId = "00000000-0000-4000-8000-000000000001";
const foreignId = "00000000-0000-4000-8000-000000000002";
function product(index: number): ListedProduct {
  return { id: String(index).padStart(4, "0"), catalogId, categoryId: null, name: `Producto ${index}`, slug: `producto-${index}`,
    description: null, brand: index === 26 ? "Acme" : null, model: null, sku: `SKU-${index}`, price: index, salePrice: null,
    saleStartsAt: null, saleEndsAt: null, stock: index % 2, active: index % 2 === 0, needsCompletion: index < 4, specs: null,
    createdAt: new Date(0), updatedAt: new Date(0), category: null, images: [{ id: `image-${index}`, productId: String(index), url: `private/${index}`, alt: null, position: 0, createdAt: new Date(0) }] };
}

test("listing query rejects invalid values, repeated parameters, huge pages and unsupported sizes", () => {
  assert.deepEqual(productListQuery.parse({}), { q: "", category: "all", status: "all", stock: "all", sort: "createdAt", order: "desc", page: 1, pageSize: 24 });
  for (const value of [{ page: "0" }, { page: "1000001" }, { page: "1.5" }, { pageSize: "25" }, { pageSize: ["24", "48"] }, { sort: "rawSQL" }, { order: "sideways" }, { status: "yes" }, { stock: "negative" }, { category: "bad-id" }, { q: "x".repeat(151) }, { unknown: "x" }]) assert.equal(productListQuery.safeParse(value).success, false);
  for (const pageSize of ["24", "48", "96"]) assert.equal(productListQuery.parse({ pageSize }).pageSize, Number(pageSize));
});

test("all filter clauses retain catalog and owner; search is literal and case insensitive", () => {
  const where = productListWhere(catalogId, "owner-a", productListQuery.parse({ q: " ACME%_ ", category: "none", stock: "in", status: "inactive" }));
  assert.deepEqual(where, { catalogId, catalog: { userId: "owner-a" }, categoryId: null, active: false, stock: { gt: 0 },
    OR: ["name", "sku", "brand", "model"].map(field => ({ [field]: { contains: "ACME\\%\\_", mode: "insensitive" } })) });
  assert.equal(productListWhere(catalogId, "owner-a", productListQuery.parse({ stock: "out", category: foreignId })).stock, 0);
});

test("every order has an id tie-breaker and price uses the base field", () => {
  for (const sort of ["createdAt", "name", "price", "stock", "category"]) for (const order of ["asc", "desc"]) {
    const clauses = productListOrder(productListQuery.parse({ sort, order }));
    assert.deepEqual(clauses[1], { id: "asc" });
    assert.deepEqual(clauses[0], sort === "category" ? { category: { name: order } } : { [sort]: order });
  }
});

test("category pagination crosses the null boundary with NULL last in both directions", async () => {
  const reads: Prisma.ProductFindManyArgs[] = [];
  const database = new Proxy(prisma, { get(_target, key) {
    if (key === "product") return { count: async () => 25, findMany: async (args: Prisma.ProductFindManyArgs) => { reads.push(args); return reads.length === 1 ? [product(25)] : [product(26), product(27)]; } };
    throw new Error("Unexpected database operation");
  } });
  for (const order of ["asc", "desc"]) {
    reads.length = 0;
    const result = await readProductPage(database, { catalogId, catalog: { userId: "owner-a" } }, productListQuery.parse({ sort: "category", order, page: "2" }));
    assert.equal(result.length, 3);
    assert.equal(reads[0].skip, 24); assert.equal(reads[0].take, 24);
    assert.deepEqual(reads[0].where, { AND: [{ catalogId, catalog: { userId: "owner-a" } }, { categoryId: { not: null } }] });
    assert.equal(reads[1].skip, 0); assert.equal(reads[1].take, 23);
    assert.deepEqual(reads[1].orderBy, [{ id: "asc" }]);
    assert.deepEqual(reads[1].where, { AND: [{ catalogId, catalog: { userId: "owner-a" } }, { categoryId: null }] });
  }
});

test("HTTP listing returns server totals, clamps deleted last page and signs only page thumbnails", async () => {
  const fixtures = Array.from({ length: 27 }, (_, i) => product(i + 1));
  const transaction = async (callback: (tx: typeof prisma) => Promise<unknown>, options: { isolationLevel: string }) => {
    assert.equal(options.isolationLevel, "RepeatableRead"); return callback(database);
  };
  const findCatalog = async (args: Prisma.CatalogFindFirstArgs) => args.where?.id === catalogId && args.where.userId === "owner-a" ? { id: catalogId } : null;
  let filtered = false;
  const count = async (args: Prisma.ProductCountArgs) => {
    assert.deepEqual(args.where?.catalog, { userId: "owner-a" }); assert.equal(args.where?.catalogId, catalogId);
    return args.where?.needsCompletion === true ? fixtures.filter(p => p.needsCompletion).length : args.where?.active === false ? fixtures.filter(p => !p.active).length : fixtures.length;
  };
  const findMany = async (args: Prisma.ProductFindManyArgs) => {
    assert.deepEqual(args.where?.catalog, { userId: "owner-a" }); assert.equal(args.where?.catalogId, catalogId);
    assert.deepEqual(args.include?.images, { take: 1, orderBy: [{ position: "asc" }, { id: "asc" }] });
    filtered = args.where?.active === false;
    return fixtures.filter(p => !filtered || !p.active).slice(args.skip, (args.skip ?? 0) + (args.take ?? 0));
  };
  const database = new Proxy(prisma, { get(_target, key) {
    if (key === "$transaction") return transaction;
    if (key === "catalog") return { findFirst: findCatalog };
    if (key === "product") return { count, findMany };
    if (key === "$queryRaw") return async (query: Prisma.Sql) => {
      assert.ok(query.values.includes(catalogId)); assert.ok(query.values.includes("owner-a"));
      return fixtures.filter(p => p.sku === query.values[2]).slice(0, 5);
    };
    throw new Error("Unexpected database operation");
  } });
  const signed: string[] = [];
  const app = express();
  app.use((req: AuthenticatedRequest, _res, next) => { if (req.headers["x-test-owner"]) req.user = { id: String(req.headers["x-test-owner"]), email: "test@example.invalid" }; next(); });
  app.use("/catalog/:catalogId", makeProductListingRouter(makeProductListingService(async path => { signed.push(path); return `https://images.example.invalid/${path}`; }, {
    listProductPage: (catalog, owner, query) => listProductPage(catalog, owner, query, database),
    suggestProducts: (catalog, owner, q) => suggestProducts(catalog, owner, q, database),
  })));
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}/catalog`;
  const get = (path: string, owner = "owner-a") => fetch(`${base}/${path}`, { headers: { "x-test-owner": owner } });
  try {
    assert.equal((await fetch(`${base}/${catalogId}/list`)).status, 401);
    assert.equal((await get(`${foreignId}/list`)).status, 404);
    assert.equal((await get(`${catalogId}/list`, "owner-b")).status, 404);
    assert.equal((await get(`${catalogId}/list?pageSize=999`)).status, 400);
    const firstPage = await (await get(`${catalogId}/list`)).json();
    assert.equal(firstPage.products.some((p: { id: string }) => p.id === "0026"), false);
    const suggestions = await (await get(`${catalogId}/suggestions?q=SKU-26`)).json();
    assert.equal(suggestions.products[0].id, "0026", "Suggestions find products outside the current page");
    assert.equal((await get(`${catalogId}/suggestions?q=SKU-26`, "owner-b")).status, 404);
    assert.equal((await get(`${catalogId}/suggestions?q=x`)).status, 400);
    assert.equal((await get(`${catalogId}/suggestions?q=SKU-26&page=2`)).status, 400);
    signed.length = 0;
    const response = await get(`${catalogId}/list?page=2`);
    const page = await response.json();
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(page.totalProducts, 27); assert.equal(page.totalFiltered, 27); assert.equal(page.pageSize, 24); assert.equal(page.needsCompletionCount, 3);
    assert.equal(page.products.length, 3); assert.equal(page.products[0].id, "0025"); assert.equal(signed.length, 3);
    assert.equal(page.products[0].images[0].url, "https://images.example.invalid/private/25");
    const result = await (await get(`${catalogId}/list?status=inactive&page=999`)).json();
    assert.equal(result.totalProducts, 27); assert.equal(result.totalFiltered, 14); assert.equal(result.page, 1); assert.equal(result.products.length, 14); assert.equal(result.needsCompletionCount, 3);
    fixtures.splice(0);
    const empty = await (await get(`${catalogId}/list?page=2`)).json();
    assert.equal(empty.totalProducts, 0); assert.equal(empty.totalFiltered, 0); assert.equal(empty.page, 1); assert.deepEqual(empty.products, []);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});

test("suggestions query ranks SKU/name/prefix/substring across the catalog, with five results and owner scope", () => {
  const query = suggestionSql(catalogId, "owner-a", "ACME");
  assert.ok(query.values.includes(catalogId)); assert.ok(query.values.includes("owner-a")); assert.ok(query.values.includes("ACME"));
  assert.match(query.sql, /p\."catalogId" = \? AND c\."userId" = \?/);
  assert.match(query.sql, /lower\(p.sku\).*THEN 0.*lower\(p.name\).*THEN 1/s);
  assert.match(query.sql, /THEN 2 ELSE 3 END/); assert.match(query.sql, /p.name ASC, p.id ASC LIMIT 5/);
  assert.doesNotMatch(query.sql, /OFFSET|active =|stock =/);
});
