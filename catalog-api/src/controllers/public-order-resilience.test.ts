import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import express from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma";
import { createPublicOrder } from "../repositories/order.repository";
import { quotationBaseUrl } from "../services/quotation-data";
import { QuotationFailureEvent } from "../services/quotation-errors";
import type { makePublicOrderController } from "./public-catalog.controller";

const publicId = "11111111-1111-4111-8111-111111111111";
const productId = "22222222-2222-4222-8222-222222222222";
const orderId = "33333333-3333-4333-8333-333333333333";
const createdAt = new Date("2026-10-24T10:00:00Z");
const receipt = { id: orderId, status: "PENDING" as const, total: 2500, createdAt,
  items: [{ productName: "Producto", quantity: 2, unitPrice: 1250, subtotal: 2500 }] };
type Dependencies = NonNullable<Parameters<typeof makePublicOrderController>[0]>;

// Exercise the real order repository and its idempotency against an isolated persistence double.
function purchaseStore() {
  let saved: typeof receipt | null = null;
  let writes = 0;
  const database = new Proxy(prisma, {
    get(_target, key) {
      if (key === "$transaction") return async (fn: (tx: Prisma.TransactionClient) => Promise<unknown>) => fn(database);
      if (key === "catalog") return { findFirst: async () => ({ id: "catalog" }) };
      if (key === "product") return { findMany: async () => [{ id: productId, name: "Producto", price: 1250, salePrice: null, saleStartsAt: null, saleEndsAt: null }] };
      if (key === "order") return {
        findUnique: async () => saved,
        create: async (args: Prisma.OrderCreateArgs) => {
          assert.equal(args.data.total, 2500);
          assert.equal(args.data.quotationNumber, undefined);
          assert.equal(args.data.quotationToken, undefined);
          writes++;
          saved = receipt;
          return saved;
        },
      };
      throw new Error("Unexpected database operation");
    },
  });
  return { create: (id: string, data: Parameters<typeof createPublicOrder>[1]) => createPublicOrder(id, data, database),
    get writes() { return writes; }, get saved() { return saved; } };
}

const bodySchema = z.object({ success: z.literal(true), requestId: z.string().min(1), order: z.object({
  id: z.string().uuid(), total: z.number(), quotationNumber: z.string().nullable(), quotationUrl: z.string().nullable(), quotationIssuedAt: z.string().nullable(),
}) });

async function withController(overrides: Partial<Dependencies>, verify: (context: {
  submit: () => Promise<z.infer<typeof bodySchema>>; events: QuotationFailureEvent[]; store: ReturnType<typeof purchaseStore>;
}) => Promise<void>) {
  const store = purchaseStore();
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SECRET_KEY = "local-test-placeholder";
  const { makePublicOrderController } = await import("./public-catalog.controller.js");
  const events: QuotationFailureEvent[] = [];
  const app = express();
  app.use(express.json());
  app.post("/catalogs/:publicId/orders", makePublicOrderController({
    create: store.create, base: () => "https://api.example.invalid/api",
    issue: async () => { throw new Error("private details must not enter logs"); },
    log: event => { events.push(event); }, ...overrides,
  }));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    await verify({ events, store, submit: async () => {
      const response = await fetch(`http://127.0.0.1:${address.port}/catalogs/${publicId}/orders`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idempotencyKey: "same-purchase", customerName: "Cliente de prueba", customerPhone: "3000000000",
          customerAddress: "Dirección de prueba", consent: true, items: [{ productId, quantity: 2 }] }),
      });
      assert.equal(response.status, 201);
      const result = bodySchema.parse(await response.json());
      assert.equal(response.headers.get("x-request-id"), result.requestId);
      return result;
    } });
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}

test("quotation failure preserves a committed purchase, returns 201/null and logs only safe correlation fields", async () => {
  await withController({}, async ({ submit, store, events }) => {
    const result = await submit();
    assert.equal(store.writes, 1);
    assert.ok(store.saved);
    assert.equal(result.order.quotationNumber, null);
    assert.equal(result.order.quotationUrl, null);
    assert.equal(result.order.quotationIssuedAt, null);
    assert.deepEqual(events, [{ event: "quotation_issue_failed", requestId: result.requestId, errorCode: "ISSUANCE_FAILED" }]);
  });
});

test("missing PUBLIC_API_URL does not prevent purchase commit or return 500", async () => {
  const previous = process.env.PUBLIC_API_URL;
  delete process.env.PUBLIC_API_URL;
  try {
    await withController({ base: quotationBaseUrl, issue: async () => { throw new Error("Must not issue without configuration"); } }, async ({ submit, events, store }) => {
      const result = await submit();
      assert.equal(store.writes, 1);
      assert.equal(result.order.quotationUrl, null);
      assert.equal(events[0]?.errorCode, "CONFIGURATION");
    });
  } finally { if (previous === undefined) delete process.env.PUBLIC_API_URL; else process.env.PUBLIC_API_URL = previous; }
});

test("idempotent retry after quotation failure keeps one purchase and may complete its quotation", async () => {
  let attempt = 0;
  await withController({ issue: async () => {
    if (++attempt === 1) throw new Error("Temporary quotation failure");
    return { quotationNumber: 1, quotationToken: "a".repeat(64), quotationIssuedAt: new Date() };
  } }, async ({ submit, store }) => {
    const first = await submit();
    const second = await submit();
    assert.equal(first.order.id, second.order.id);
    assert.equal(first.order.quotationUrl, null);
    assert.equal(second.order.quotationNumber, "COT-000001");
    assert.ok(second.order.quotationUrl);
    assert.equal(store.writes, 1);
  });
});

test("even failure of the quotation logger cannot turn the committed purchase into an error", async () => {
  await withController({ log: () => { throw new Error("Log transport unavailable"); } }, async ({ submit, store }) => {
    assert.equal((await submit()).order.quotationUrl, null);
    assert.equal(store.writes, 1);
  });
});

test("quotation formatting failure returns 201 with all quotation fields null", async () => {
  await withController({ issue: async () => ({ quotationNumber: 0, quotationToken: "a".repeat(64), quotationIssuedAt: new Date() }) }, async ({ submit, events }) => {
    const result = await submit();
    assert.equal(result.order.quotationNumber, null);
    assert.equal(result.order.quotationUrl, null);
    assert.equal(result.order.quotationIssuedAt, null);
    assert.equal(events[0]?.errorCode, "QUOTATION_INTEGRITY");
  });
});
