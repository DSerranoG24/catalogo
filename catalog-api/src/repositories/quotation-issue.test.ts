import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma";
import { quotationSellerSchema } from "../services/quotation-data";
import { issueQuotation } from "./quotation-issue.repository";

const publicId = "11111111-1111-4111-8111-111111111111";
const orderId = "22222222-2222-4222-8222-222222222222";
type State = {
  counter: number;
  seller: { name: string; nit: null; phone: null; whatsappPhone: null; address: null; businessHours: null;
    email: null; instagramUrl: null; facebookUrl: null; tiktokUrl: null; quotationTerms: string };
  order: { id: string; catalogId: string; status: "PENDING" | "CANCELLED"; anonymizedAt?: Date | null; quotationNumber: number | null;
    quotationToken: string | null; quotationIssuedAt: Date | null; quotationSellerSnapshot: Prisma.JsonValue | null };
};

// Transactional simulator: serializes the row lock and publishes staged changes only on commit.
// It verifies application behavior, not the PostgreSQL engine's locking implementation.
function transactionStore() {
  let state: State = { counter: 0,
    seller: { name: "Vendedor al emitir", nit: null, phone: null, whatsappPhone: null, address: null,
      businessHours: null, email: null, instagramUrl: null, facebookUrl: null, tiktokUrl: null, quotationTerms: "Condiciones al emitir" },
    order: { id: orderId, catalogId: "catalog", status: "PENDING", quotationNumber: null, quotationToken: null,
      quotationIssuedAt: null, quotationSellerSnapshot: null },
  };
  let tail = Promise.resolve();
  let finalWriteFails = false;
  let increments = 0;
  let failAfterIncrement = false;
  const database = new Proxy(prisma, {
    get(_target, key) {
      if (key !== "$transaction") throw new Error("Quotation work must run inside its own transaction");
      return async (callback: (tx: Prisma.TransactionClient) => Promise<unknown>, options: { maxWait: number; timeout: number }) => {
        assert.equal(options.maxWait, 1000);
        assert.equal(options.timeout, 3000);
        let release = () => {};
        let staged: State | undefined;
        const working = () => { assert.ok(staged, "Lock the order before any read or counter write"); return staged; };
        const transaction = new Proxy(prisma, {
          get(_tx, operation) {
            if (operation === "$executeRaw") return async (strings: TemplateStringsArray) => {
              assert.match(strings.join(""), /SET LOCAL (lock_timeout|statement_timeout)/);
              return 0;
            };
            if (operation === "$queryRaw") return async (strings: TemplateStringsArray, ...values: unknown[]) => {
              assert.ok(strings.join("?").includes("FOR UPDATE OF o"));
              const previous = tail;
              tail = new Promise<void>(resolve => { release = resolve; });
              await previous;
              staged = structuredClone(state);
              return values[0] === orderId && values[1] === publicId ? [{ id: orderId }] : [];
            };
            if (operation === "catalog") return { update: async (args: Prisma.CatalogUpdateArgs) => {
              const current = working();
              assert.deepEqual(args.data.quotationCounter, { increment: 1 });
              current.counter++;
              increments++;
              if (failAfterIncrement) throw new Error("Simulated database failure after counter write");
              return { ...current.seller, quotationCounter: current.counter };
            } };
            if (operation === "order") return {
              findFirstOrThrow: async () => structuredClone(working().order),
              updateMany: async (args: Prisma.OrderUpdateManyArgs) => {
                const current = working();
                assert.equal(args.where?.quotationNumber, null);
                assert.equal(args.where?.quotationToken, null);
                if (finalWriteFails) return { count: 0 };
                assert.ok(typeof args.data.quotationNumber === "number");
                assert.ok(typeof args.data.quotationToken === "string");
                assert.ok(args.data.quotationIssuedAt instanceof Date);
                const seller = quotationSellerSchema.parse(args.data.quotationSellerSnapshot);
                current.order = { ...current.order, quotationNumber: args.data.quotationNumber,
                  quotationToken: args.data.quotationToken, quotationIssuedAt: args.data.quotationIssuedAt, quotationSellerSnapshot: seller };
                return { count: 1 };
              },
            };
            throw new Error("Unexpected operation in quotation transaction");
          },
        });
        try {
          const result = await callback(transaction);
          if (staged) state = staged;
          return result;
        } finally { release(); }
      };
    },
  });
  return { database, get state() { return state; }, get increments() { return increments; },
    failFinalWrite(value: boolean) { finalWriteFails = value; }, failCounterWrite(value: boolean) { failAfterIncrement = value; } };
}

test("concurrent issuance of the same order emits once and consumes exactly one number", async () => {
  const store = transactionStore();
  const [first, second] = await Promise.all([issueQuotation(publicId, orderId, store.database), issueQuotation(publicId, orderId, store.database)]);
  assert.ok(first && second);
  assert.equal(first.quotationNumber, 1);
  assert.equal(second.quotationNumber, 1);
  assert.ok(first.quotationToken === second.quotationToken, "Both attempts must recover one capability");
  assert.equal(store.state.counter, 1);
  assert.equal(store.increments, 1);
});

test("a failed final update rolls back counter and quotation; retry freezes current seller and emission date", async () => {
  const store = transactionStore();
  store.failFinalWrite(true);
  await assert.rejects(issueQuotation(publicId, orderId, store.database), /QUOTATION_WRITE_CONFLICT/);
  assert.equal(store.state.counter, 0);
  assert.equal(store.state.order.quotationNumber, null);
  assert.equal(store.state.order.quotationToken, null);
  store.state.seller.name = "Vendedor modificado después del registro";
  store.state.seller.quotationTerms = "Condiciones nuevas";
  store.failFinalWrite(false);
  const beforeIssuance = Date.now();
  const issued = await issueQuotation(publicId, orderId, store.database);
  assert.ok(issued);
  assert.equal(issued.quotationNumber, 1);
  assert.ok(issued.quotationIssuedAt.getTime() >= beforeIssuance);
  const snapshot = quotationSellerSchema.parse(store.state.order.quotationSellerSnapshot);
  assert.equal(snapshot.name, "Vendedor modificado después del registro");
  assert.equal(snapshot.quotationTerms, "Condiciones nuevas");
});

test("database failure after counter increment rolls back instead of continuing an aborted transaction", async () => {
  const store = transactionStore();
  store.failCounterWrite(true);
  await assert.rejects(issueQuotation(publicId, orderId, store.database));
  assert.equal(store.state.counter, 0);
  assert.equal(store.state.order.quotationIssuedAt, null);
});

test("retry of an issued quotation returns the original data without renumbering or changing snapshot", async () => {
  const store = transactionStore();
  const first = await issueQuotation(publicId, orderId, store.database);
  const original = structuredClone(store.state.order.quotationSellerSnapshot);
  store.state.seller.name = "Nombre posterior";
  const retry = await issueQuotation(publicId, orderId, store.database);
  assert.ok(first && retry);
  assert.equal(retry.quotationNumber, first.quotationNumber);
  assert.ok(retry.quotationToken === first.quotationToken);
  assert.equal(retry.quotationIssuedAt.getTime(), first.quotationIssuedAt.getTime());
  assert.deepEqual(store.state.order.quotationSellerSnapshot, original);
  assert.equal(store.increments, 1);
});

test("cancelled orders and mismatched catalog/order pairs do not allocate a number", async () => {
  const store = transactionStore();
  store.state.order.status = "CANCELLED";
  assert.equal(await issueQuotation(publicId, orderId, store.database), null);
  assert.equal(await issueQuotation("other-catalog", orderId, store.database), null);
  assert.equal(store.state.counter, 0);
  assert.equal(store.increments, 0);
});

test("anonymization prevents new issuance and recovery of an already issued quotation", async () => {
  const fresh = transactionStore();
  fresh.state.order.anonymizedAt = new Date();
  assert.equal(await issueQuotation(publicId, orderId, fresh.database), null);
  assert.equal(fresh.increments, 0);
  const issued = transactionStore();
  await issueQuotation(publicId, orderId, issued.database);
  issued.state.order.anonymizedAt = new Date();
  assert.equal(await issueQuotation(publicId, orderId, issued.database), null);
  assert.equal(issued.increments, 1);
});
