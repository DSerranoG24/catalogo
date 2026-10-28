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
      if (key === "$queryRaw") return async () => [{ id: "catalog" }];
      if (key === "orderDeletionMarker") return { findUnique: async () => null };
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

test("core transaction persists prices and lines without any quotation operations", async () => {
  const database = databaseFixture({
    catalog: {
      findFirst: async () => ({ id: "catalog" }),
    },
    product: { findMany: async () => [{ id: "product", name: "Nombre original", price: 2000, salePrice: null, saleStartsAt: null, saleEndsAt: null }] },
    order: { create: async (args: Prisma.OrderCreateArgs) => {
      assert.equal(args.data.total, 4000);
      assert.ok(args.data.items);
      for (const key of ["quotationNumber", "quotationToken", "quotationIssuedAt", "quotationSellerSnapshot"]) {
        assert.ok(!(key in args.data), "Quotation state must not participate in the purchase transaction");
      }
      return { id: "created" };
    } },
  });
  await createPublicOrder("catalog-public", input, database);
});

test("idempotent retry returns the persisted order without allocating a quotation number", async () => {
  const receipt = { id: "original", total: 4000 };
  const database = databaseFixture({
    catalog: { findFirst: async () => ({ id: "catalog" }) },
    order: { findUnique: async () => receipt },
  });
  assert.deepEqual(await createPublicOrder("catalog", { ...input, idempotencyKey: "retry" }, database), receipt);
});

test("quotation queries require matching catalog, order, token and non-cancelled status", async () => {
  const read = mock.fn(async (args: Prisma.OrderFindFirstArgs) => {
    assert.deepEqual(args.where, { id: "order", quotationToken: "token", anonymizedAt: null, status: { not: "CANCELLED" }, catalog: { publicId: "catalog" } });
    return null;
  });
  const database = databaseFixture({ order: { findFirst: read } });
  assert.equal(await findQuotation("catalog", "order", "token", database), null);
  assert.equal(await quotationStillAccessible("catalog", "order", "token", database), false);
  assert.equal(read.mock.callCount(), 2);
});
