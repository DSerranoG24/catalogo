import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { creditBalanceOf, moneyCommandHash, netPaid, paymentFigures, returnedValue, reversedIds, type LedgerEntry } from "./sale-payment";
import { confirmSaleSchema, convertOrderToSaleSchema, creditRefundSchema, replaceSalePaymentSchema, salePaymentInputSchema, salePaymentsSchema, saleRefundSchema } from "../schemas/sales.schema";

const entry = (kind: string, amount: bigint, reversesEntryId: string | null = null): LedgerEntry => ({ id: randomUUID(), kind, amount, reversesEntryId });
const line = { id: "line", unitPrice: 150000n, unitDiscount: 0n };
const returned = (quantity: number) => returnedValue([line], quantity ? [{ lines: [{ saleLineId: "line", receivedQuantity: quantity }] }] : []);

test("example $300.000: 100.000 paid, 200.000 owed; a 150.000 return leaves 50.000; the full return turns the 100.000 paid into excess", () => {
  const sale = { total: 300000n, customerId: "ana" };
  const cash = entry("PAYMENT", 100000n);
  let figures = paymentFigures({ ...sale, status: "DELIVERED" }, returned(0), [cash]);
  assert.deepEqual([figures.effectiveTotal, figures.paid, figures.balance, figures.stage], [300000n, 100000n, 200000n, "BALANCE_DUE"]);
  figures = paymentFigures({ ...sale, status: "DELIVERED" }, returned(1), [cash]);
  assert.deepEqual([figures.returnedValue, figures.effectiveTotal, figures.balance], [150000n, 150000n, 50000n], "the return first reduces what is owed");
  figures = paymentFigures({ ...sale, status: "RETURNED" }, returned(2), [cash]);
  assert.deepEqual([figures.effectiveTotal, figures.paid, figures.balance, figures.refundDue], [0n, 100000n, 0n, 0n], "with a customer the 100.000 are excess for the credit balance, not «por devolver»");
  assert.equal(figures.paid - figures.effectiveTotal, 100000n, "excess to move to the customer's credit balance");
  const moved = entry("EXCESS_TO_CREDIT", 100000n);
  figures = paymentFigures({ ...sale, status: "RETURNED" }, returned(2), [cash, moved]);
  assert.deepEqual([figures.paid, figures.stage], [0n, "SETTLED"]);
});

test("without a customer the excess stays «por devolver» until a SALE_REFUND", () => {
  const sale = { status: "RETURNED", total: 60000n, customerId: null };
  const cash = entry("PAYMENT", 60000n);
  let figures = paymentFigures(sale, 60000n, [cash]);
  assert.deepEqual([figures.refundDue, figures.stage], [60000n, "REFUND_DUE"]);
  figures = paymentFigures(sale, 60000n, [cash, entry("SALE_REFUND", 60000n)]);
  assert.deepEqual([figures.refundDue, figures.stage], [0n, "SETTLED"]);
  const cancelled = paymentFigures({ status: "CANCELLED", total: 500000n, customerId: null }, 0n, [entry("PAYMENT", 200000n)]);
  assert.equal(cancelled.refundDue, 200000n, "a cancelled sale's advance is all excess");
});

test("stages and mixed payments: pending order, paid; a reversal counts against the entry it undoes", () => {
  const nequi = entry("PAYMENT", 50000n), cash = entry("PAYMENT", 35000n);
  const sale = { status: "CONFIRMED", total: 85000n, customerId: null };
  assert.equal(paymentFigures(sale, 0n, [nequi]).stage, "PENDING_ORDER");
  assert.deepEqual([paymentFigures(sale, 0n, [nequi, cash]).balance, paymentFigures(sale, 0n, [nequi, cash]).stage], [0n, "PAID"]);
  const undo = entry("REVERSAL", 50000n, nequi.id);
  assert.equal(netPaid([nequi, cash, undo]), 35000n);
  assert.deepEqual([...reversedIds([nequi, cash, undo])], [nequi.id]);
  const moved = entry("EXCESS_TO_CREDIT", 10000n);
  assert.equal(netPaid([nequi, moved, entry("REVERSAL", 10000n, moved.id)]), 50000n, "reversing a moved excess gives the money back to the sale");
  assert.throws(() => netPaid([entry("REVERSAL", 1n, randomUUID())]), /REVERSAL_WITHOUT_ENTRY/);
});

test("a return is valued at sale price, damaged units included (decision 9)", () => {
  const lines = [{ id: "a", unitPrice: 100000n, unitDiscount: 10000n }, { id: "b", unitPrice: 5000n, unitDiscount: 0n }];
  assert.equal(returnedValue(lines, [{ lines: [{ saleLineId: "a", receivedQuantity: 2 }] }, { lines: [{ saleLineId: "b", receivedQuantity: 1 }] }]), 185000n);
  assert.throws(() => returnedValue(lines, [{ lines: [{ saleLineId: "x", receivedQuantity: 1 }] }]));
});

test("customer credit balance: from sales, used, refunded and reversals", () => {
  const from = { id: "f", kind: "FROM_SALE", amount: 200000n, reversesEntryId: null };
  const used = { id: "u", kind: "USED", amount: 70000n, reversesEntryId: null };
  const refund = { id: "r", kind: "REFUND", amount: 30000n, reversesEntryId: null };
  assert.equal(creditBalanceOf([from, used, refund]), 100000n);
  assert.equal(creditBalanceOf([from, used, refund, { id: "x", kind: "REVERSAL", amount: 30000n, reversesEntryId: "r" }]), 130000n, "voiding a refund restores it");
  assert.equal(creditBalanceOf([from, { id: "y", kind: "REVERSAL", amount: 200000n, reversesEntryId: "f" }]), 0n);
});

test("payment input validation: methods, note with OTHER only, cash received, amounts and limits", () => {
  const ok = (value: unknown) => salePaymentInputSchema.safeParse(value).success;
  assert.ok(ok({ method: "NEQUI", amount: "50000" }));
  assert.ok(ok({ method: "CASH", amount: "35000", cashReceived: "50000" }));
  assert.ok(ok({ method: "OTHER", amount: "1", methodNote: "Bancolombia" }));
  assert.ok(!ok({ method: "OTHER", amount: "1" }), "OTHER needs a note");
  assert.ok(!ok({ method: "CASH", amount: "1", methodNote: "Caja" }), "a note only with OTHER");
  assert.ok(!ok({ method: "CASH", amount: "10", cashReceived: "9" }), "cash received below the amount");
  assert.ok(!ok({ method: "CARD", amount: "10", cashReceived: "10" }), "cash received outside CASH");
  assert.ok(!ok({ method: "CASH", amount: "0" }));
  assert.ok(!ok({ method: "CASH", amount: "1000000000001" }));
  assert.ok(!ok({ method: "CASH", amount: "1.5" }));
  assert.ok(!ok({ method: "FIADO", amount: "1" }), "fiado is not a method");
  assert.ok(!ok({ method: "CASH", amount: "1", total: "1" }), "unknown fields are rejected");
  const keys = { operationId: randomUUID(), requestId: randomUUID(), expectedVersion: 1 };
  assert.ok(confirmSaleSchema.parse(keys).payments === undefined, "without payments the confirmation stays LEGACY");
  assert.ok(!confirmSaleSchema.safeParse({ ...keys, payments: Array.from({ length: 11 }, () => ({ method: "CASH", amount: "1" })) }).success, "at most 10 payments");
  assert.ok(!salePaymentsSchema.safeParse({ ...keys, payments: [] }).success, "an advance needs a payment");
  assert.ok(salePaymentsSchema.safeParse({ ...keys, customerCreditAmount: "1000" }).success);
  assert.ok(!saleRefundSchema.safeParse({ ...keys, amount: "1", method: "CASH" }).success, "a refund needs a reason");
  assert.ok(!creditRefundSchema.safeParse({ operationId: randomUUID(), requestId: randomUUID(), amount: "1", method: "OTHER", reason: "Devuelto" }).success);
  const conversion = { operationId: randomUUID(), requestId: randomUUID() };
  assert.ok(!convertOrderToSaleSchema.safeParse({ ...conversion, payments: [] }).success, "a draft conversion records no payments");
  assert.ok(convertOrderToSaleSchema.safeParse({ ...conversion, mode: "DELIVERED", payments: [{ method: "CASH", amount: "1" }] }).success);
});

test("money receipts hash the command without requestId, scoped by kind and resource", () => {
  const body = { operationId: "op", expectedVersion: 2, payments: [{ method: "CASH", amount: "1" }] };
  assert.equal(moneyCommandHash("SALE_ADVANCE", "s1", { ...body, requestId: "a" }), moneyCommandHash("SALE_ADVANCE", "s1", { ...body, requestId: "b" }));
  assert.notEqual(moneyCommandHash("SALE_ADVANCE", "s1", body), moneyCommandHash("SALE_ADVANCE", "s2", body));
  assert.notEqual(moneyCommandHash("SALE_ADVANCE", "s1", body), moneyCommandHash("SALE_REFUND", "s1", body));
  assert.notEqual(moneyCommandHash("SALE_ADVANCE", "s1", body), moneyCommandHash("SALE_ADVANCE", "s1", { ...body, expectedVersion: 3 }));
});

test("«anular y reemplazar» (F2a-3c): a reason and one valid payment; the receipt ignores requestId", () => {
  const keys = { operationId: randomUUID(), requestId: randomUUID(), expectedVersion: 3 };
  assert.ok(replaceSalePaymentSchema.safeParse({ ...keys, reason: "Era en efectivo", payment: { method: "CASH", amount: "85000", cashReceived: "100000" } }).success);
  assert.ok(!replaceSalePaymentSchema.safeParse({ ...keys, payment: { method: "CASH", amount: "85000" } }).success, "the reason is mandatory");
  assert.ok(!replaceSalePaymentSchema.safeParse({ ...keys, reason: "ab", payment: { method: "CASH", amount: "85000" } }).success, "3 to 300 characters");
  assert.ok(!replaceSalePaymentSchema.safeParse({ ...keys, reason: "Era Nequi", payment: { method: "NEQUI", amount: "85000", cashReceived: "90000" } }).success, "cash received only in cash");
  assert.ok(!replaceSalePaymentSchema.safeParse({ ...keys, reason: "Era otro", payment: { method: "OTHER", amount: "85000" } }).success, "OTHER needs its note");
  assert.ok(!replaceSalePaymentSchema.safeParse({ ...keys, reason: "Dos pagos", payments: [{ method: "CASH", amount: "1" }] }).success, "one replacement, not a list");
  const body = { ...keys, reason: "Era en efectivo", payment: { method: "CASH", amount: "85000" } };
  assert.equal(moneyCommandHash("SALE_PAYMENT_REPLACE", "e1", body), moneyCommandHash("SALE_PAYMENT_REPLACE", "e1", { ...body, requestId: randomUUID() }));
});
