import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { Prisma, type OrderStatus } from "@prisma/client";
import { prisma } from "../config/prisma";
import { anonymizeOrder, deletePendingOrder, deletedOrderKeyHash } from "./order-privacy.repository";
import { createPublicOrder, findOrdersByCatalog } from "./order.repository";
import { createPublicOrderSchema } from "../schemas/order.schema";
import { CUSTOMER_CONSENT_VERSIONS } from "../services/customer-consent";
import { anonymizeOrderSchema } from "../schemas/order-privacy.schema";

const input = { confirmation: "ANONIMIZAR" as const, clientDataReviewed: true as const, redactProductNames: false, redactSellerFields: [] };
const seller = { name: "Negocio", nit: null, phone: "1111111", whatsappPhone: null, address: null,
  businessHours: null, email: null, instagramUrl: null, facebookUrl: null, tiktokUrl: null, quotationTerms: "Condiciones del vendedor" };

// In-memory transactional double. These tests verify repository decisions, not PostgreSQL locks.
function fixture(status: OrderStatus = "COMPLETED") {
  let state = {
    order: { id: "order", catalogId: "catalog", idempotencyKey: "old-key", status,
      customerName: "Cliente prueba", customerPhone: "3000000000", customerEmail: "buyer@example.invalid",
      customerAddress: "Dirección de prueba", notes: "Nota privada", total: 4000,
      createdAt: new Date("2026-10-20T00:00:00Z"), firstConfirmedAt: new Date("2026-10-21T00:00:00Z"),
      quotationIssuedAt: new Date("2026-10-20T01:00:00Z"), quotationNumber: 4,
      quotationSellerSnapshot: structuredClone(seller), customerConsentAt: new Date("2026-10-20T00:00:00Z"),
      customerConsentVersion: null as string | null, anonymizedAt: null as Date | null },
    items: [{ productName: "Producto", quantity: 2, unitPrice: 2000, subtotal: 4000 }],
    markers: [] as string[], deleted: false, creates: 0,
  };
  const locks: string[] = [];
  const database = new Proxy(prisma, { get(_target, key) {
    if (key === "$transaction") return async (fn: (tx: Prisma.TransactionClient) => Promise<unknown>) => {
      const original = structuredClone(state);
      try { return await fn(database); } catch (error) { state = original; throw error; }
    };
    if (key === "$queryRaw") return async (sql: TemplateStringsArray, ...values: unknown[]) => {
      locks.push(sql.join("?"));
      return sql.join("").includes("FROM orders") && (values[0] !== "order" || values[1] !== "owner" || state.deleted) ? [] : [{ id: "catalog" }];
    };
    if (key === "catalog") return { findFirst: async () => ({ id: "catalog" }) };
    if (key === "orderDeletionMarker") return {
      upsert: async (args: Prisma.OrderDeletionMarkerUpsertArgs) => { state.markers.push(args.create.keyHash); return {}; },
      findUnique: async (args: Prisma.OrderDeletionMarkerFindUniqueArgs) => state.markers.includes(args.where.catalogId_keyHash?.keyHash ?? "") ? {} : null,
    };
    if (key === "orderItem") return { updateMany: async (args: Prisma.OrderItemUpdateManyArgs) => { assert.equal(args.where?.orderId, "order"); for (const item of state.items) Object.assign(item, args.data); return { count: state.items.length }; } };
    if (key === "order") return {
      findFirstOrThrow: async (args: Prisma.OrderFindFirstOrThrowArgs) => { assert.deepEqual(args.where, { id: "order", catalog: { userId: "owner" } }); return structuredClone(state.order); },
      update: async (args: Prisma.OrderUpdateArgs) => { Object.assign(state.order, args.data); return { anonymizedAt: state.order.anonymizedAt }; },
      delete: async () => { state.deleted = true; state.items = []; return {}; },
      findUnique: async () => state.deleted ? null : { id: state.order.id, total: state.order.total },
      create: async (args: Prisma.OrderCreateArgs) => { state.creates++; assert.equal(args.data.customerConsentVersion, "2026-10-27.v1"); return { id: "new" }; },
    };
    if (key === "product") return { findMany: async () => [{ id: "product", name: "Producto", price: 2000, salePrice: null, saleStartsAt: null, saleEndsAt: null }] };
    throw new Error("Unexpected persistence call");
  } });
  return { database, locks, get state() { return state; } };
}

test("anonymization preserves business amounts, lines, dates, consent and seller data", async () => {
  const store = fixture(); const before = structuredClone(store.state);
  const result = await anonymizeOrder("order", "owner", input, store.database);
  assert.ok(result.anonymizedAt instanceof Date);
  assert.equal(store.state.order.customerName, "Cliente anonimizado");
  assert.equal(store.state.order.customerPhone, "");
  for (const key of ["customerEmail", "customerAddress", "notes"] as const) assert.equal(store.state.order[key], null);
  for (const key of ["total", "createdAt", "firstConfirmedAt", "quotationIssuedAt", "quotationNumber", "customerConsentAt", "customerConsentVersion", "quotationSellerSnapshot"] as const) assert.deepEqual(store.state.order[key], before.order[key]);
  assert.deepEqual(store.state.items, before.items);
  const again = await anonymizeOrder("order", "owner", input, store.database);
  assert.deepEqual(again.anonymizedAt, result.anonymizedAt);
  assert.match(store.locks[0] ?? "", /FOR UPDATE OF o/);
});

test("only terminal own orders can be anonymized; explicit review is required", async () => {
  for (const status of ["PENDING", "CONFIRMED"] as const) await assert.rejects(anonymizeOrder("order", "owner", input, fixture(status).database), /ORDER_NOT_TERMINAL/);
  await anonymizeOrder("order", "owner", input, fixture("CANCELLED").database);
  await assert.rejects(anonymizeOrder("order", "other-owner", input, fixture().database), /ORDER_NOT_FOUND/);
  assert.equal(anonymizeOrderSchema.safeParse({ ...input, clientDataReviewed: false }).success, false);
});

test("review removes selected customer-bearing free text, keeping seller fields and line amounts", async () => {
  const store = fixture();
  store.state.items[0].productName = "Trabajo para cliente privado";
  store.state.order.quotationSellerSnapshot.quotationTerms = "Datos del cliente en texto libre";
  await anonymizeOrder("order", "owner", { ...input, redactProductNames: true, redactSellerFields: ["quotationTerms"] }, store.database);
  assert.equal(store.state.order.quotationSellerSnapshot.quotationTerms, null);
  assert.equal(store.state.order.quotationSellerSnapshot.name, seller.name);
  assert.equal(store.state.items[0].productName, "Producto (datos personales retirados)");
  assert.equal(store.state.items[0].subtotal, 4000);
});

test("only PENDING deletion succeeds and exact name confirmation is checked under the order lock", async () => {
  for (const status of ["CONFIRMED", "COMPLETED", "CANCELLED"] as const) await assert.rejects(deletePendingOrder("order", "owner", "Cliente prueba", fixture(status).database), /ORDER_NOT_PENDING/);
  const store = fixture("PENDING");
  await assert.rejects(deletePendingOrder("order", "other-owner", "Cliente prueba", store.database), /ORDER_NOT_FOUND/);
  await assert.rejects(deletePendingOrder("order", "owner", "incorrecto", store.database), /ORDER_CONFIRMATION_MISMATCH/);
  await deletePendingOrder("order", "owner", "Cliente prueba", store.database);
  assert.equal(store.state.deleted, true); assert.equal(store.state.items.length, 0);
  assert.deepEqual(store.state.markers, [deletedOrderKeyHash("old-key")]);
  assert.equal(store.state.order.quotationNumber, 4);
});

test("deleted idempotency key cannot recreate the order after a retry", async () => {
  const store = fixture("PENDING");
  await deletePendingOrder("order", "owner", "Cliente prueba", store.database);
  await assert.rejects(createPublicOrder("public", { customerName: "Cliente", customerPhone: "3000000000", customerAddress: "Dirección", consent: true, idempotencyKey: "old-key", items: [{ productId: "product", quantity: 2 }] }, store.database), /ORDER_DELETED/);
  assert.equal(store.state.creates, 0);
  assert.match(store.state.markers[0] ?? "", /^[a-f0-9]{64}$/);
});

test("consent accepts displayed versions or transition null/omission, rejecting invented versions", () => {
  const data = { customerName: "Cliente", customerPhone: "3000000000", customerAddress: "Dirección", consent: true, items: [{ productId: "11111111-1111-4111-8111-111111111111", quantity: 1 }] };
  for (const version of [undefined, null, "2026-10-27.v1"]) assert.equal(createPublicOrderSchema.safeParse({ ...data, customerConsentVersion: version }).success, true);
  assert.equal(createPublicOrderSchema.safeParse({ ...data, customerConsentVersion: "inventada" }).success, false);
  const frontend = readFileSync("../catalog-generator/lib/customer-consent.ts", "utf8");
  assert.ok(frontend.includes(CUSTOMER_CONSENT_VERSIONS["2026-10-27.v1"].text));
  assert.ok(frontend.includes('version: "2026-10-27.v1"'));
});

test("new orders persist the displayed consent version; idempotent receipt leaves historical null intact", async () => {
  const store = fixture("PENDING");
  const data = { customerName: "Cliente", customerPhone: "3000000000", customerAddress: "Dirección", consent: true as const, customerConsentVersion: "2026-10-27.v1", items: [{ productId: "product", quantity: 2 }] };
  await createPublicOrder("public", data, store.database);
  await createPublicOrder("public", { ...data, idempotencyKey: "old-key" }, store.database);
  assert.equal(store.state.creates, 1); assert.equal(store.state.order.customerConsentVersion, null);
});

test("order pagination keeps the owner filter, bounds reads, and rejects a foreign cursor", async () => {
  let ownsCursor = true, reads = 0;
  const database = new Proxy(prisma, { get(_target, key) {
    if (key === "order") return {
      findFirst: async (args: Prisma.OrderFindFirstArgs) => { assert.deepEqual(args.where, { id: "cursor", catalogId: "catalog", catalog: { userId: "owner" } }); return ownsCursor ? { id: "cursor" } : null; },
      findMany: async (args: Prisma.OrderFindManyArgs) => {
        reads++; assert.equal(args.take, 100); assert.equal(args.skip, 1);
        assert.deepEqual(args.cursor, { id: "cursor" });
        assert.deepEqual(args.where, { catalogId: "catalog", catalog: { userId: "owner" } });
        assert.deepEqual(args.orderBy, [{ createdAt: "desc" }, { id: "desc" }]);
        return [];
      },
    };
    throw new Error("Unexpected persistence call");
  } });
  await findOrdersByCatalog("catalog", "owner", "cursor", database);
  ownsCursor = false;
  await assert.rejects(findOrdersByCatalog("catalog", "owner", "cursor", database), /ORDER_CURSOR_NOT_FOUND/);
  assert.equal(reads, 1);
});
