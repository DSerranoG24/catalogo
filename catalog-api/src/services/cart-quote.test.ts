import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma";
import { getCartQuote, resolveCartQuote, QuoteChangedError } from "./cart-quote";
import { createPublicOrder } from "../repositories/order.repository";

function fixture(linked = false) {
  const catalog = { id: "catalog", userId: "owner" };
  let active = true;
  const product = { id: "product", name: "Product", price: 100, stock: 10, salePrice: null as number | null,
    saleStartsAt: null as Date | null, saleEndsAt: null as Date | null, inventoryItemId: linked ? "inventory" : null,
    inventoryItem: linked ? { userId: "owner", stock: 10, commercialTerms: { userId: "owner", unitSalePrice: 150n } } : null,
    publication: linked ? { id: "publication", userId: "owner", inventoryItemId: "inventory", status: "PUBLISHED", priceOverride: null as number | null } : null };
  let writes = 0;
  let saved: Prisma.OrderCreateArgs | undefined;
  const db = new Proxy(prisma, { get(_target, key) {
    if (key === "$transaction") return async (fn: (tx: Prisma.TransactionClient) => Promise<unknown>) => fn(db);
    if (key === "$queryRaw") return async () => [];
    if (key === "catalog") return { findFirst: async () => catalog };
    if (key === "product") return { findMany: async (args: Prisma.ProductFindManyArgs) => {
      assert.equal(args.where?.catalogId, catalog.id);
      assert.equal(args.where?.active, true);
      return active ? [product] : [];
    } };
    if (key === "order") return { create: async (args: Prisma.OrderCreateArgs) => { writes++; saved = args; return { id: "order" }; } };
    throw new Error("Unexpected database access");
  } });
  return { catalog, product, db, deactivate() { active = false; }, get writes() { return writes; }, get saved() { return saved; } };
}
const input = { customerName: "Test", customerPhone: "0000000", customerAddress: "Test address", consent: true as const,
  items: [{ productId: "product", quantity: 2 }] };

test("valid deterministic quote freezes historical and inventory prices", async () => {
  for (const linked of [false, true]) {
    const f = fixture(linked);
    const quote = await getCartQuote("public", input.items, f.db);
    assert.equal(quote.token, (await getCartQuote("public", input.items, f.db)).token);
    await createPublicOrder("public", { ...input, quoteToken: quote.token }, f.db);
    const unitPrice = linked ? 150 : 100;
    assert.equal(f.writes, 1);
    assert.equal(f.saved?.data.total, unitPrice * 2);
    assert.deepEqual(f.saved?.data.items, { create: [{ productId: "product", productName: "Product", quantity: 2, unitPrice, subtotal: unitPrice * 2 }] });
    if (linked) assert.equal(f.product.inventoryItem?.commercialTerms.unitSalePrice, 150n);
  }
});

const mutations: Record<string, (f: ReturnType<typeof fixture>) => void> = {
  price: f => { if (f.product.inventoryItem) f.product.inventoryItem.commercialTerms.unitSalePrice = 200n; },
  stock: f => { if (f.product.inventoryItem) f.product.inventoryItem.stock = 9; },
  deactivated: f => f.deactivate(),
  promotion: f => { f.product.salePrice = 50; f.product.saleStartsAt = new Date(0); f.product.saleEndsAt = new Date("2099-01-01"); },
  inventory: f => { f.product.inventoryItemId = "replacement"; },
  override: f => { if (f.product.publication) f.product.publication.priceOverride = 99; },
  owner: f => { if (f.product.inventoryItem) f.product.inventoryItem.userId = "foreign"; },
  catalog: f => { f.catalog.id = "other-catalog"; },
  catalogOwner: f => { f.catalog.userId = "other-owner"; },
  unpublishable: f => { if (f.product.inventoryItem) f.product.inventoryItem.commercialTerms.unitSalePrice = -1n; },
};
for (const [name, mutate] of Object.entries(mutations)) test(`rejects ${name} change without creating order`, async () => {
  const f = fixture(true); const quote = await getCartQuote("public", input.items, f.db);
  mutate(f);
  await assert.rejects(createPublicOrder("public", { ...input, quoteToken: quote.token }, f.db), (error: unknown) => error instanceof QuoteChangedError && error.code === "QUOTE_CHANGED");
  assert.equal(f.writes, 0);
});

test("expired promotion invalidates quote", async () => {
  const f = fixture();
  f.product.salePrice = 50; f.product.saleStartsAt = new Date(0); f.product.saleEndsAt = new Date("2020-01-02");
  const quote = await resolveCartQuote(f.db, f.catalog, input.items, new Date("2020-01-01"));
  await assert.rejects(createPublicOrder("public", { ...input, quoteToken: quote.token }, f.db), /QUOTE_CHANGED/);
  assert.equal(f.writes, 0);
});

test("missing, malformed and manipulated tokens fail closed", async () => {
  const f = fixture();
  for (const quoteToken of [undefined, "garbage", "q1." + "0".repeat(64), "q1." + "a".repeat(65)]) {
    await assert.rejects(createPublicOrder("public", { ...input, quoteToken }, f.db), QuoteChangedError);
  }
  assert.equal(f.writes, 0);
});

test("quantities are bound to quote and item order is canonical", async () => {
  const f = fixture(); const quote = await getCartQuote("public", input.items, f.db);
  await assert.rejects(createPublicOrder("public", { ...input, items: [{ productId: "product", quantity: 3 }], quoteToken: quote.token }, f.db), /QUOTE_CHANGED/);
  assert.equal(f.writes, 0);
  const a = [{ productId: "product", quantity: 1 }, { productId: "missing", quantity: 2 }];
  assert.equal((await getCartQuote("public", a, f.db)).token, (await getCartQuote("public", [...a].reverse(), f.db)).token);
});

for (const field of ["price", "stock"] as const) test(`historical ${field} changes invalidate quote`, async () => {
  const f = fixture(); const quote = await getCartQuote("public", input.items, f.db);
  f.product[field]++;
  await assert.rejects(createPublicOrder("public", { ...input, quoteToken: quote.token }, f.db), /QUOTE_CHANGED/);
  assert.equal(f.writes, 0);
});

test("override and active promotion use existing precedence and freeze the discounted price", async () => {
  const f = fixture(true);
  if (f.product.publication) f.product.publication.priceOverride = 120;
  f.product.salePrice = 80; f.product.saleStartsAt = new Date(0); f.product.saleEndsAt = new Date("2099-01-01");
  const quote = await getCartQuote("public", input.items, f.db);
  assert.equal(quote.lines[0]?.product?.regularPrice, 120);
  assert.equal(quote.lines[0]?.product?.price, 80);
  assert.ok(!JSON.stringify(quote).includes("owner"));
  await createPublicOrder("public", { ...input, quoteToken: quote.token }, f.db);
  assert.equal(f.saved?.data.total, 160);
  f.product.saleEndsAt = new Date("2098-01-01");
  await assert.rejects(createPublicOrder("public", { ...input, quoteToken: quote.token }, f.db), /QUOTE_CHANGED/);
  assert.equal(f.writes, 1);
});
