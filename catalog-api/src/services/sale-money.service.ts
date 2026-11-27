import type { Prisma } from "@prisma/client";
import type { z } from "zod";
import { prisma } from "../config/prisma";
import { lockAccountForMoney, lockInventoryOwner } from "../repositories/account-lock";
import type { creditRefundSchema, creditRefundVoidSchema, saleCustomerLinkSchema, salePaymentsSchema, saleRefundSchema, voidSalePaymentSchema } from "../schemas/sales.schema";
import { captureCustomer } from "./sale-customer";
import { saleResultInclude } from "./sale.service";
import { attachPayments, customerCreditBalance, ledgerWriter, PaymentError, recordPayments, reversedIds, saleMoneyState, voidEntry, withMoneyReceipt } from "./sale-payment";

type Tx = Prisma.TransactionClient;
const fail = (code: string): never => { throw new PaymentError(code); };

/**
 * Money operations of F2a-2b that are not a sale transition (contract section 8). Lock order (Agents.md):
 * lockAccountForMoney -> receipt (sale_money_operations, replayed before any check) -> customer -> sale FOR UPDATE.
 */
export function makeSaleMoneyService(database = prisma) {
  async function lockSale(tx: Tx, ownerId: string, saleId: string) {
    await tx.$queryRaw`SELECT id FROM "Sale" WHERE id = ${saleId} AND "userId" = ${ownerId} FOR UPDATE`;
    const sale = await tx.sale.findFirst({ where: { id: saleId, userId: ownerId } });
    if (!sale) fail("NOT_FOUND");
    return sale!;
  }
  async function view(tx: Tx, ownerId: string, saleId: string) {
    const sale = await tx.sale.findUniqueOrThrow({ where: { id: saleId }, include: saleResultInclude });
    return (await attachPayments(tx, ownerId, [sale], true))[0];
  }
  const bump = (tx: Tx, saleId: string) => tx.sale.update({ where: { id: saleId }, data: { version: { increment: 1 } } });
  /** A TRACKED, non-draft sale at the expected version. */
  function trackedAt(sale: { status: string; paymentMode: string; version: number }, expectedVersion: number) {
    if (sale.status === "DRAFT") fail("INVALID_PAYMENT_STATE");
    if (sale.paymentMode !== "TRACKED") fail("LEGACY_SALE_PAYMENTS_UNSUPPORTED");
    if (sale.version !== expectedVersion) fail("VERSION_CONFLICT");
  }
  async function ownedCustomer(tx: Tx, ownerId: string, customerId: string) {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM customers WHERE id = ${customerId} AND "ownerId" = ${ownerId} FOR SHARE`;
    if (!rows.length) fail("CUSTOMER_NOT_FOUND");
  }
  const run = <T>(work: (tx: Tx) => Promise<T>) => database.$transaction(work);

  return {
    /** Anticipo: payments and/or customer credit on a CONFIRMED sale, never above its balance. */
    advance(ownerId: string, saleId: string, input: z.infer<typeof salePaymentsSchema>) {
      return run(async tx => { await lockAccountForMoney(tx, ownerId); return withMoneyReceipt(tx, ownerId, input, "SALE_ADVANCE", saleId, async () => {
        const sale = await lockSale(tx, ownerId, saleId); trackedAt(sale, input.expectedVersion);
        if (sale.status !== "CONFIRMED") fail("INVALID_PAYMENT_STATE");
        await recordPayments(tx, ledgerWriter(tx, ownerId, input.operationId), ownerId, saleId, input.payments, input.customerCreditAmount);
        await bump(tx, saleId); return view(tx, ownerId, saleId);
      }); });
    },
    /** Void a PAYMENT, CREDIT_USE or SALE_REFUND with a reason (compensating REVERSAL, contract 5.5). */
    voidPayment(ownerId: string, saleId: string, entryId: string, input: z.infer<typeof voidSalePaymentSchema>) {
      return run(async tx => { await lockAccountForMoney(tx, ownerId); return withMoneyReceipt(tx, ownerId, input, "SALE_PAYMENT_VOID", entryId, async () => {
        const sale = await lockSale(tx, ownerId, saleId); trackedAt(sale, input.expectedVersion);
        await voidEntry(tx, ledgerWriter(tx, ownerId, input.operationId), ownerId, saleId, entryId, input.reason);
        await bump(tx, saleId); return view(tx, ownerId, saleId);
      }); });
    },
    /** Link or change the customer of a CONFIRMED sale (correction B), copying the customer's data. */
    linkCustomer(ownerId: string, saleId: string, input: z.infer<typeof saleCustomerLinkSchema>) {
      return run(async tx => { await lockAccountForMoney(tx, ownerId); return withMoneyReceipt(tx, ownerId, input, "SALE_CUSTOMER", saleId, async () => {
        const snapshot = await captureCustomer(tx, ownerId, input.customerId); // customer FOR SHARE before the sale
        const sale = await lockSale(tx, ownerId, saleId);
        if (sale.status === "DRAFT") fail("INVALID_TRANSITION"); // drafts change their customer with PATCH /sales/:id
        if (sale.status !== "CONFIRMED") fail("CUSTOMER_CHANGE_BLOCKED");
        if (sale.version !== input.expectedVersion) fail("VERSION_CONFLICT");
        if (sale.customerId !== input.customerId) {
          if (sale.paymentMode === "TRACKED") {
            const { entries } = await saleMoneyState(tx, ownerId, saleId);
            const undone = reversedIds(entries);
            if (entries.some(entry => entry.kind === "CREDIT_USE" && !undone.has(entry.id))) fail("CUSTOMER_CHANGE_BLOCKED");
          }
          await tx.sale.update({ where: { id: saleId }, data: { ...snapshot, version: { increment: 1 } } });
        }
        return view(tx, ownerId, saleId);
      }); });
    },
    /** «Devolver dinero» of a sale without a customer that has money «por devolver». */
    refundSale(ownerId: string, saleId: string, input: z.infer<typeof saleRefundSchema>) {
      return run(async tx => { await lockAccountForMoney(tx, ownerId); return withMoneyReceipt(tx, ownerId, input, "SALE_REFUND", saleId, async () => {
        const sale = await lockSale(tx, ownerId, saleId); trackedAt(sale, input.expectedVersion);
        if (sale.customerId) fail("REFUND_REQUIRES_NO_CUSTOMER");
        const { figures } = await saleMoneyState(tx, ownerId, saleId);
        if (BigInt(input.amount) > figures.refundDue) fail("REFUND_EXCEEDS_DUE");
        await ledgerWriter(tx, ownerId, input.operationId).sale(saleId, { kind: "SALE_REFUND", amount: BigInt(input.amount), method: input.method,
          methodNote: input.methodNote ?? null, reference: input.reference ?? null, reason: input.reason });
        await bump(tx, saleId); return view(tx, ownerId, saleId);
      }); });
    },
    /** «Devolver dinero» from a customer's credit balance, never below zero. */
    refundCredit(ownerId: string, customerId: string, input: z.infer<typeof creditRefundSchema>) {
      return run(async tx => { await lockAccountForMoney(tx, ownerId); return withMoneyReceipt(tx, ownerId, input, "CREDIT_REFUND", customerId, async () => {
        await ownedCustomer(tx, ownerId, customerId);
        if (await customerCreditBalance(tx, ownerId, customerId) < BigInt(input.amount)) fail("CREDIT_INSUFFICIENT");
        const entry = await ledgerWriter(tx, ownerId, input.operationId).credit(customerId, { kind: "REFUND", amount: BigInt(input.amount), method: input.method,
          methodNote: input.methodNote ?? null, reference: input.reference ?? null, reason: input.reason });
        return { customerId, entryId: entry.id, balance: await customerCreditBalance(tx, ownerId, customerId) };
      }); });
    },
    /** Void a credit refund: the money is again in favour of the customer. */
    voidCreditRefund(ownerId: string, customerId: string, entryId: string, input: z.infer<typeof creditRefundVoidSchema>) {
      return run(async tx => { await lockAccountForMoney(tx, ownerId); return withMoneyReceipt(tx, ownerId, input, "CREDIT_REFUND_VOID", entryId, async () => {
        await ownedCustomer(tx, ownerId, customerId);
        const entry = await tx.customerCreditEntry.findFirst({ where: { id: entryId, ownerId, customerId } });
        if (!entry) fail("CREDIT_ENTRY_NOT_FOUND");
        if (entry!.kind !== "REFUND") fail("PAYMENT_NOT_VOIDABLE");
        if (await tx.customerCreditEntry.findFirst({ where: { reversesEntryId: entryId, ownerId } })) fail("PAYMENT_ALREADY_VOIDED");
        await ledgerWriter(tx, ownerId, input.operationId).credit(customerId, { kind: "REVERSAL", amount: entry!.amount, reversesEntryId: entryId, reason: input.reason });
        return { customerId, entryId, balance: await customerCreditBalance(tx, ownerId, customerId) };
      }); });
    },
    /** Credit balance of a customer and its movements (read-only). */
    customerCredit(ownerId: string, customerId: string) {
      return run(async tx => {
        await lockInventoryOwner(tx, ownerId);
        if (!await tx.customer.findFirst({ where: { id: customerId, ownerId }, select: { id: true } })) fail("CUSTOMER_NOT_FOUND");
        const entries = await tx.customerCreditEntry.findMany({ where: { ownerId, customerId }, orderBy: [{ createdAt: "asc" }, { position: "asc" }, { id: "asc" }] });
        const reversed = reversedIds(entries);
        return { customerId, balance: await customerCreditBalance(tx, ownerId, customerId), entries: entries.map(entry => ({ id: entry.id, kind: entry.kind, amount: entry.amount,
          saleId: entry.saleId, method: entry.method, methodNote: entry.methodNote, reference: entry.reference, reversesEntryId: entry.reversesEntryId, reason: entry.reason,
          voided: reversed.has(entry.id), createdAt: entry.createdAt })) };
      });
    },
  };
}
