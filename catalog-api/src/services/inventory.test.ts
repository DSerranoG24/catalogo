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

const itemId = "11111111-1111-4111-8111-111111111111";
const input = { key: "22222222-2222-4222-8222-222222222222", type: "OUT" as const, quantity: 3, reason: "Venta manual" };

test("inventory validates external quantities, identifiers and owner fields", () => {
  assert.equal(inventoryMovementSchema.safeParse({ ...input, quantity: 0 }).success, false);
  for (const quantity of [-1, 1.5, 2147483648, "2"]) assert.equal(inventoryMovementSchema.safeParse({ ...input, quantity }).success, false);
  assert.equal(inventoryMovementSchema.safeParse({ ...input, userId: "other" }).success, false);
  assert.equal(inventoryMovementSchema.safeParse({ ...input, reason: " " }).success, false);
  assert.equal(inventoryMovementSchema.safeParse({ ...input, type: "ADJUSTMENT", quantity: 0 }).success, true);
  assert.equal(inventoryItemSchema.parse({ id: itemId, name: " Product ", sku: " abc ", minimumStock: 0 }).sku, "ABC");
  assert.equal(inventoryPageSchema.safeParse({ page: -1 }).success, false);
  assert.equal(inventoryPageSchema.safeParse({ page: 1.5 }).success, false);
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
  let allowed = true, failWrite = false, locked = false, active = false;
  const database = new Proxy(prisma, { get(_target, key) {
    if (key === "$transaction") return async (work: (tx: Prisma.TransactionClient) => Promise<unknown>) => {
      const before = { stock, movements: structuredClone(movements) }; active = true; locked = false;
      try { return await work(database); } catch (error) { stock = before.stock; movements = before.movements; throw error; } finally { active = false; }
    };
    if (key === "$queryRaw") return async (_sql: TemplateStringsArray, ...values: unknown[]) => {
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
      findUnique: async () => { assert.ok(active && locked); return movements[0] ?? null; },
      create: async (args: { data: typeof input & { itemId: string; previousStock: number; resultingStock: number } }) => {
        assert.ok(active && locked); if (failWrite) throw new Error("fixture-write-failure");
        const row = { id: "movement", ...args.data }; movements.push(row); return row;
      },
      findMany: async () => { assert.ok(allowed); return movements; },
      count: async () => { assert.ok(allowed); return movements.length; },
    };
    return Reflect.get(_target, key);
  } });
  return { database, get stock() { return stock; }, get movements() { return movements; }, deny: () => { allowed = false; }, fail: () => { failWrite = true; } };
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
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
