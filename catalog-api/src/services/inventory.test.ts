import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import express from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma";
import { inventoryBalance } from "./inventory-calculation";
import { inventoryItemSchema, inventoryMovementSchema, inventoryPageSchema } from "../schemas/inventory.schema";
import { inventoryHistory, moveInventory, listInventory } from "../repositories/inventory.repository";
import * as repository from "../repositories/inventory.repository";
import { makeInventoryRouter } from "../routes/inventory.routes";
import { inventoryTermsSchema } from "../schemas/inventory-batch.schema";

const itemId = "11111111-1111-4111-8111-111111111111";
const input = { key: "22222222-2222-4222-8222-222222222222", type: "OUT" as const, quantity: 3, reason: "Venta manual" };

test("inventory validates external quantities, identifiers and owner fields", () => {
  assert.equal(inventoryMovementSchema.safeParse({ ...input, quantity: 0 }).success, false);
  for (const quantity of [-1, 1.5, 2147483648, "2"]) assert.equal(inventoryMovementSchema.safeParse({ ...input, quantity }).success, false);
  assert.equal(inventoryMovementSchema.safeParse({ ...input, userId: "other" }).success, false);
  assert.equal(inventoryMovementSchema.safeParse({ ...input, reason: " " }).success, false);
  assert.equal(inventoryMovementSchema.safeParse({ ...input, type: "ADJUSTMENT", quantity: 0 }).success, true);
  assert.equal(inventoryItemSchema.parse({ id: itemId, name: " Product ", sku: " abc ", minimumStock: 0 }).sku, "ABC");
  assert.equal(inventoryItemSchema.safeParse({ id: itemId, name: "Product", sku: "ß".repeat(80), minimumStock: 0 }).success, false);
  assert.equal(inventoryPageSchema.safeParse({ page: -1 }).success, false);
  assert.equal(inventoryPageSchema.safeParse({ page: 1.5 }).success, false);
  assert.equal(inventoryItemSchema.safeParse({ id: itemId, name: "Product", sku: " ", minimumStock: 0 }).success, false);
  for (const value of ["-1", "1.5", "1e3", "9223372036854775808", -1]) {
    assert.equal(inventoryTermsSchema.safeParse({ expectedVersion: null, unitSalePrice: value, referenceUnitCost: null }).success, false);
    assert.equal(inventoryTermsSchema.safeParse({ expectedVersion: 1, unitSalePrice: "100", referenceUnitCost: value }).success, false);
  }
  assert.equal(inventoryTermsSchema.parse({ expectedVersion: null, unitSalePrice: "9007199254740993", referenceUnitCost: null }).unitSalePrice, "9007199254740993");
});

test("inventory creation replays by owned ID and rejects duplicate SKU only inside its owner", async () => {
  const rows: { id: string; userId: string; name: string; sku: string; minimumStock: number }[] = [];
  const db = new Proxy(prisma, { get(_target, key) {
    if (key === "$transaction") return async (work: (tx: Prisma.TransactionClient) => Promise<unknown>) => work(db);
    if (key === "$queryRaw") return async (_sql: TemplateStringsArray, ...values: unknown[]) => [{ id: values[0] }];
    if (key === "$executeRaw") return async () => 1;
    if (key === "inventoryItem") return {
      findFirst: async (args: Prisma.InventoryItemFindFirstArgs) => { assert.equal(typeof args.where?.userId, "string"); return rows.find(row => row.id === args.where?.id && row.userId === args.where?.userId) ?? null; },
      create: async (args: Prisma.InventoryItemCreateArgs) => {
        const data = args.data; assert.ok(data.userId && data.id);
        if (rows.some(row => row.id === data.id || row.userId === data.userId && row.sku === data.sku)) throw new Prisma.PrismaClientKnownRequestError("duplicate", { code: "P2002", clientVersion: "fixture" });
        const row = { id: data.id, userId: data.userId, name: data.name, sku: data.sku, minimumStock: Number(data.minimumStock) }; rows.push(row); return row;
      },
    };
    throw new Error(`Unexpected write: ${String(key)}`);
  } });
  const body = { id: itemId, name: "Product", sku: "SKU", minimumStock: 0 };
  const first = await repository.createInventory("owner", body, db);
  assert.deepEqual(await repository.createInventory("owner", body, db), first);
  await assert.rejects(repository.createInventory("owner", { ...body, name: "Changed" }, db), /KEY_CONFLICT/);
  await assert.rejects(repository.createInventory("owner", { ...body, id: "33333333-3333-4333-8333-333333333333" }, db), { code: "P2002" });
  await repository.createInventory("other", { ...body, id: "44444444-4444-4444-8444-444444444444" }, db);
  assert.equal(rows.length, 2);
});

test("entries, exits and counted adjustments preserve valid balances", () => {
  assert.equal(inventoryBalance(5, input), 2);
  assert.equal(inventoryBalance(5, { ...input, type: "IN" }), 8);
  assert.equal(inventoryBalance(5, { ...input, type: "ADJUSTMENT", quantity: 0 }), 0);
  assert.throws(() => inventoryBalance(2, input), /INVALID_STOCK/);
  assert.throws(() => inventoryBalance(2147483647, { ...input, type: "IN" }), /INVALID_STOCK/);
});

function fixture() {
  let stock = 5;
  let movements: { id: string; itemId: string; key: string; type: string; quantity: number; reason: string; previousStock: number; resultingStock: number }[] = [];
  let allowed = true, failWrite = false, locked = false, active = false, closed = false;
  const database = new Proxy(prisma, { get(_target, key) {
    if (key === "$transaction") return async (work: (tx: Prisma.TransactionClient) => Promise<unknown>) => {
      const before = { stock, movements: structuredClone(movements) }; active = true; locked = false;
      try { return await work(database); } catch (error) { stock = before.stock; movements = before.movements; throw error; } finally { active = false; }
    };
    if (key === "$queryRaw") return async (_sql: TemplateStringsArray, ...values: unknown[]) => {
      if (_sql.join("").includes("FROM users")) { assert.ok(active); assert.deepEqual(values, ["owner"]); return closed ? [] : [{ id: "owner" }]; }
      assert.ok(active); assert.deepEqual(values, [itemId, "owner"]); locked = true;
      return allowed ? [{ id: itemId }] : [];
    };
    if (key === "inventoryItem") return {
      findUniqueOrThrow: async () => { assert.ok(active && locked); return { stock }; },
      update: async (args: Prisma.InventoryItemUpdateArgs) => { assert.ok(active && locked); assert.equal(typeof args.data.stock, "number"); stock = Number(args.data.stock); },
      findFirst: async (args: Prisma.InventoryItemFindFirstArgs) => { assert.equal(args.where?.userId, "owner"); return allowed ? { id: itemId } : null; },
      findMany: async (args: Prisma.InventoryItemFindManyArgs) => { assert.equal(args.where?.userId, "owner"); assert.equal(args.skip, 24); assert.equal(args.take, 24); return []; },
      count: async (args: Prisma.InventoryItemCountArgs) => { assert.equal(args.where?.userId, "owner"); return 0; },
    };
    if (key === "inventoryMovement") return {
      findUnique: async (args: Prisma.InventoryMovementFindUniqueArgs) => { assert.ok(active && locked); return movements.find(row => row.itemId === args.where.itemId_key?.itemId && row.key === args.where.itemId_key.key) ?? null; },
      create: async (args: { data: typeof input & { itemId: string; previousStock: number; resultingStock: number } }) => {
        assert.ok(active && locked); if (failWrite) throw new Error("fixture-write-failure");
        const row = { id: "movement", ...args.data }; movements.push(row); return row;
      },
      findMany: async () => { assert.ok(allowed); return movements; },
      count: async () => { assert.ok(allowed); return movements.length; },
    };
    return Reflect.get(_target, key);
  } });
  return { database, get stock() { return stock; }, get movements() { return movements; }, deny: () => { allowed = false; }, fail: () => { failWrite = true; }, close: () => { closed = true; } };
}

test("owned movement locks row, updates balance and records once on identical retry", async () => {
  const state = fixture();
  const first = await moveInventory("owner", itemId, input, state.database);
  const retry = await moveInventory("owner", itemId, input, state.database);
  assert.deepEqual(retry, first); assert.equal(state.stock, 2); assert.equal(state.movements.length, 1);
  await assert.rejects(moveInventory("owner", itemId, { ...input, quantity: 4 }, state.database), /KEY_CONFLICT/);
  assert.equal(state.stock, 2);
});

test("another user's item cannot be moved or read in history", async () => {
  const state = fixture(); state.deny();
  await assert.rejects(moveInventory("owner", itemId, input, state.database), /NOT_FOUND/);
  await assert.rejects(inventoryHistory("owner", itemId, 1, state.database), /NOT_FOUND/);
  assert.equal(state.stock, 5); assert.equal(state.movements.length, 0);
});

test("manual counts preserve signed deltas, zero-count semantics and exact retry receipts", async () => {
  const state = fixture();
  await moveInventory("owner", itemId, { ...input, type: "IN", quantity: 3 }, state.database);
  assert.equal(state.stock, 8);
  const up = await moveInventory("owner", itemId, { ...input, key: "33333333-3333-4333-8333-333333333333", type: "ADJUSTMENT", quantity: 12 }, state.database);
  assert.equal(up.previousStock, 8); assert.equal(up.resultingStock, 12); assert.equal(up.delta, 4); assert.equal(up.quantity, 12);
  const downInput = { ...input, key: "44444444-4444-4444-8444-444444444444", type: "ADJUSTMENT" as const, quantity: 7 };
  const down = await moveInventory("owner", itemId, downInput, state.database);
  assert.equal(down.previousStock, 12); assert.equal(down.resultingStock, 7); assert.equal(down.delta, -5);
  assert.deepEqual(await moveInventory("owner", itemId, downInput, state.database), down);
  assert.equal(state.movements.length, 3); assert.equal(state.stock, 7);
  const unchangedInput = { ...downInput, key: "55555555-5555-4555-8555-555555555555" };
  const unchanged = await moveInventory("owner", itemId, unchangedInput, state.database);
  assert.equal(unchanged.delta, 0); assert.equal(state.stock, 7);
  assert.deepEqual(await moveInventory("owner", itemId, unchangedInput, state.database), unchanged);
  assert.equal(state.movements.length, 4, "Preserve the existing manual no-op receipt contract; batches use separate no-op rules");
});

test("an owned item without movements returns an empty history without inventing entries", async () => {
  const state = fixture();
  assert.deepEqual(await inventoryHistory("owner", itemId, 1, state.database), { movements: [], total: 0, page: 1 });
  assert.equal(state.stock, 5); assert.equal(state.movements.length, 0);
});

test("movement failure rolls back balance and insufficient stock writes nothing", async () => {
  const state = fixture(); state.fail();
  await assert.rejects(moveInventory("owner", itemId, input, state.database), /fixture-write-failure/);
  assert.equal(state.stock, 5); assert.equal(state.movements.length, 0);
  await assert.rejects(moveInventory("owner", itemId, { ...input, quantity: 6 }, state.database), /INVALID_STOCK/);
  assert.equal(state.stock, 5);
});

test("listing is scoped to owner and paginated", async () => {
  const state = fixture();
  assert.deepEqual(await listInventory("owner", 2, "abc", state.database), { items: [], total: 0, page: 2 });
});

test("requests authenticated before closure cannot write inventory after closure", async () => {
  const state = fixture(); state.close();
  await assert.rejects(moveInventory("owner", itemId, input, state.database), /ACCOUNT_CLOSED/);
  await assert.rejects(repository.createInventory("owner", { id: itemId, name: "Product", sku: "ABC", minimumStock: 0 }, state.database), /ACCOUNT_CLOSED/);
  assert.equal(state.stock, 5); assert.equal(state.movements.length, 0);
});

test("inventory HTTP routes require a session, validate bodies and scope writes", async () => {
  const state = fixture();
  const service: typeof repository = { ...repository,
    moveInventory: (owner, id, body) => moveInventory(owner, id, body, state.database),
    inventoryHistory: (owner, id, page) => inventoryHistory(owner, id, page, state.database),
  };
  const app = express(); app.use(express.json());
  app.use("/protected", makeInventoryRouter(service));
  app.use("/inventory", makeInventoryRouter(service, async (req, _res, next) => {
    req.user = { id: "owner", email: "fixture@example.invalid", emailVerifiedAt: null, hasLocalPassword: false }; next(); return undefined;
  }));
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const post = (body: unknown) => fetch(`${base}/inventory/items/${itemId}/movements`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  try {
    assert.equal((await fetch(`${base}/protected/items`)).status, 401);
    assert.equal((await post({ ...input, userId: "other" })).status, 400);
    assert.equal((await post({ ...input, quantity: 6 })).status, 409);
    assert.equal((await post(input)).status, 200);
    assert.equal((await post(input)).status, 200); assert.equal(state.stock, 2);
    assert.equal((await post({ ...input, reason: "Different operation" })).status, 409);
    state.deny();
    assert.equal((await post(input)).status, 404);
    assert.equal((await fetch(`${base}/inventory/items/${itemId}/movements`)).status, 404);
    assert.equal((await fetch(`${base}/inventory/items/not-a-uuid/movements`)).status, 400);
    state.close();
    assert.equal((await post(input)).status, 401);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
