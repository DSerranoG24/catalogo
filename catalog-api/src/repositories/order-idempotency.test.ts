import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { recoverIdempotentOrder } from "./order-idempotency";

type Receipt = { id: string; total: number };

function uniqueConflict() {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
    meta: { target: ["catalogId", "idempotencyKey"] },
  });
}

function createFakeOrderStore() {
  const orders = new Map<string, Receipt>();
  let sequence = 0;
  let writes = 0;

  async function submit(catalogId: string, key: string | undefined, total: number): Promise<Receipt> {
    const storeKey = key ? `${catalogId}:${key}` : `without-key:${catalogId}:${++sequence}`;
    return recoverIdempotentOrder(key, async () => {
      const existing = key ? orders.get(storeKey) : undefined;
      if (existing) return existing;
      await Promise.resolve();
      if (key && orders.has(storeKey)) throw uniqueConflict();
      const receipt = { id: `order-${++sequence}`, total };
      orders.set(storeKey, receipt);
      writes += 1;
      return receipt;
    }, async () => orders.get(storeKey) ?? null);
  }

  return { submit, orders, get writes() { return writes; } };
}

test("same idempotency key returns the same receipt without a second write", async () => {
  const store = createFakeOrderStore();
  const first = await store.submit("catalog-a", "request-1", 1200);
  const retry = await store.submit("catalog-a", "request-1", 9000);

  assert.deepEqual(retry, first);
  assert.equal(store.writes, 1);
});

test("concurrent submissions with the same key persist exactly one order", async () => {
  const store = createFakeOrderStore();
  const receipts = await Promise.all([
    store.submit("catalog-a", "request-2", 1200),
    store.submit("catalog-a", "request-2", 1200),
  ]);

  assert.deepEqual(receipts[0], receipts[1]);
  assert.equal(store.writes, 1);
  assert.equal(store.orders.size, 1);
});

test("same key in different catalogs creates distinct orders", async () => {
  const store = createFakeOrderStore();
  const first = await store.submit("catalog-a", "shared-key", 1200);
  const second = await store.submit("catalog-b", "shared-key", 1200);

  assert.notEqual(first.id, second.id);
  assert.equal(store.writes, 2);
});

test("orders without a key retain create-per-request behavior", async () => {
  const store = createFakeOrderStore();
  const first = await store.submit("catalog-a", undefined, 1200);
  const second = await store.submit("catalog-a", undefined, 1200);

  assert.notEqual(first.id, second.id);
  assert.equal(store.writes, 2);
});

test("only the matching Prisma unique constraint is recovered", async () => {
  const unrelatedConflict = new Prisma.PrismaClientKnownRequestError("Other unique constraint", {
    code: "P2002",
    clientVersion: "test",
    meta: { target: ["email"] },
  });
  await assert.rejects(
    recoverIdempotentOrder("key", async () => { throw unrelatedConflict; }, async () => ({ id: "ignored", total: 0 })),
    (error) => error === unrelatedConflict
  );
});
