import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma";
import { createPublicOrder } from "./order.repository";
import { findQuotation, quotationStillAccessible } from "./quotation.repository";

const input = { customerName: "Cliente de prueba", customerPhone: "3000000000", customerAddress: "Direccion de prueba", consent: true as const, items: [{ productId: "product", quantity: 2 }] };

// Prisma's dynamic delegates cannot be replaced by Node's descriptor-based mock.method.
// Unexpected database operations fail closed; these fixtures never connect to a database.
function databaseFixture(models: Record<string, Record<string, unknown>>) {
  const database = new Proxy(prisma, {
    get(_target, key) {
      if (key === "$transaction") return async (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) => callback(database);
      if (typeof key === "string" && key in models) return models[key];
      throw new Error("Unexpected database operation in test");
    },
  });
  return database;
}

test("archived catalog cannot create an order or allocate a quotation number", async () => {
  const database = databaseFixture({ catalog: {
    findFirst: async (args: Prisma.CatalogFindFirstArgs) => {
      assert.equal(args.where?.archivedAt, null);
      assert.equal(args.where?.active, true);
      return null;
    },
  } });
  await assert.rejects(createPublicOrder("archived-catalog", input, database), /CATALOG_NOT_FOUND/);
});

test("new order persists an atomic increment, frozen seller, issue date and random token inside its transaction", async () => {
  const increment = mock.fn(async (args: Prisma.CatalogUpdateManyArgs) => {
    assert.deepEqual(args.data.quotationCounter, { increment: 1 });
    assert.equal(args.where?.archivedAt, null);
    return { count: 1 };
  });
  const database = databaseFixture({
    catalog: {
      findFirst: async () => ({ id: "catalog" }), updateMany: increment,
      findUniqueOrThrow: async () => ({ quotationCounter: 123, name: "Vendedor inicial", nit: null,
        phone: null, whatsappPhone: null, address: null, businessHours: null, email: null,
        instagramUrl: null, facebookUrl: null, tiktokUrl: null, quotationTerms: "Garantia inicial" }),
    },
    product: { findMany: async () => [{ id: "product", name: "Nombre original", price: 2000, salePrice: null, saleStartsAt: null, saleEndsAt: null }] },
    order: { create: async (args: Prisma.OrderCreateArgs) => {
      assert.equal(increment.mock.callCount(), 1);
      assert.equal(args.data.quotationNumber, 123);
      assert.ok(args.data.quotationIssuedAt instanceof Date);
      assert.match(String(args.data.quotationToken), /^[0-9a-f]{64}$/);
      assert.equal(args.data.total, 4000);
      const snapshot = args.data.quotationSellerSnapshot;
      assert.ok(snapshot && typeof snapshot === "object" && "name" in snapshot);
      assert.equal(snapshot.name, "Vendedor inicial");
      assert.ok("quotationTerms" in snapshot);
      assert.equal(snapshot.quotationTerms, "Garantia inicial");
      assert.ok(!("logoUrl" in snapshot));
      return { id: "created" };
    } },
  });
  await createPublicOrder("catalog-public", input, database);
});

test("idempotent retry returns the persisted quotation without allocating another number", async () => {
  const receipt = { id: "original", quotationNumber: 5, quotationToken: "a".repeat(64) };
  const database = databaseFixture({
    catalog: { findFirst: async () => ({ id: "catalog" }) },
    order: { findUnique: async () => receipt },
  });
  assert.deepEqual(await createPublicOrder("catalog", { ...input, idempotencyKey: "retry" }, database), receipt);
});

test("quotation queries require matching catalog, order, token and non-cancelled status", async () => {
  const read = mock.fn(async (args: Prisma.OrderFindFirstArgs) => {
    assert.deepEqual(args.where, { id: "order", quotationToken: "token", status: { not: "CANCELLED" }, catalog: { publicId: "catalog" } });
    return null;
  });
  const database = databaseFixture({ order: { findFirst: read } });
  assert.equal(await findQuotation("catalog", "order", "token", database), null);
  assert.equal(await quotationStillAccessible("catalog", "order", "token", database), false);
  assert.equal(read.mock.callCount(), 2);
});
