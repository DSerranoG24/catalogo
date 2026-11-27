import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";

/**
 * Payments of a sale (F2a-2b, docs/sales-payments-cartera-contract.md sections 4–5).
 *
 * Fiado switch. While false, a sale cannot be delivered with an unpaid balance (SALE_BALANCE_DUE) and no due date
 * is set. F2-2 turns it on (abonos exist then): delivery with a balance and a customer creates the debt and sets
 * "Sale".paymentDueDate from paymentTermDays. This is the only place to change.
 */
export const CREDIT_SALES_ENABLED = false;

type Tx = Prisma.TransactionClient;
export type EntryKind = "PAYMENT" | "CREDIT_USE" | "EXCESS_TO_CREDIT" | "SALE_REFUND" | "REVERSAL";
export type CreditKind = "FROM_SALE" | "USED" | "REFUND" | "REVERSAL";
export type PaymentMethod = "CASH" | "NEQUI" | "DAVIPLATA" | "BANK_TRANSFER" | "CARD" | "OTHER";
export type LedgerEntry = { id: string; kind: EntryKind | string; amount: bigint; reversesEntryId: string | null; creditEntryId?: string | null };
export type CreditEntry = { id: string; kind: CreditKind | string; amount: bigint; reversesEntryId: string | null };
export type PaymentInput = { method: PaymentMethod; amount: string; methodNote?: string; reference?: string; cashReceived?: string };
export type RefundInput = { method: PaymentMethod; methodNote?: string; reference?: string };

export class PaymentError extends Error {}
const fail = (code: string): never => { throw new PaymentError(code); };

// ---- Pure calculations (contract 5.1 and 5.2) ----

const POSITIVE = new Set(["PAYMENT", "CREDIT_USE", "RECEIPT_ALLOCATION"]);
/** Sign of an entry on the money paid for the sale; a reversal counts against the entry it undoes. */
function signed(entry: LedgerEntry, byId: Map<string, LedgerEntry>): bigint {
  if (entry.kind === "REVERSAL") {
    const original = entry.reversesEntryId ? byId.get(entry.reversesEntryId) : undefined;
    if (!original) throw new Error("REVERSAL_WITHOUT_ENTRY");
    return POSITIVE.has(original.kind) ? -entry.amount : entry.amount;
  }
  return POSITIVE.has(entry.kind) ? entry.amount : -entry.amount;
}
export function netPaid(entries: LedgerEntry[]) {
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  return entries.reduce((sum, entry) => sum + signed(entry, byId), 0n);
}
/** Ids of entries that a reversal already undid. */
export function reversedIds(entries: { reversesEntryId: string | null }[]) {
  return new Set(entries.flatMap(entry => entry.reversesEntryId ? [entry.reversesEntryId] : []));
}
export function creditBalanceOf(entries: CreditEntry[]) {
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  return entries.reduce((sum, entry) => {
    if (entry.kind === "REVERSAL") {
      const original = entry.reversesEntryId ? byId.get(entry.reversesEntryId) : undefined;
      if (!original) throw new Error("REVERSAL_WITHOUT_ENTRY");
      return sum + (original.kind === "FROM_SALE" ? -entry.amount : entry.amount);
    }
    return sum + (entry.kind === "FROM_SALE" ? entry.amount : -entry.amount);
  }, 0n);
}

type SaleLineValue = { id: string; unitPrice: bigint; unitDiscount: bigint };
type ReturnLineValue = { saleLineId: string; receivedQuantity: number };
/** Sale value of what came back, damaged or not (decision 9): Σ (unitPrice − unitDiscount) × receivedQuantity. */
export function returnedValue(lines: SaleLineValue[], returns: { lines: ReturnLineValue[] }[]) {
  const byLine = new Map(lines.map(line => [line.id, line]));
  let value = 0n;
  for (const ret of returns) for (const row of ret.lines) {
    const line = byLine.get(row.saleLineId);
    if (!line) throw new Error("RETURN_LINE_WITHOUT_SALE_LINE");
    value += (BigInt(line.unitPrice) - BigInt(line.unitDiscount)) * BigInt(row.receivedQuantity);
  }
  return value;
}

export type PaymentStage = "PENDING_ORDER" | "PAID" | "BALANCE_DUE" | "REFUND_DUE" | "SETTLED";
export type PaymentFigures = { total: bigint; returnedValue: bigint; effectiveTotal: bigint; paid: bigint; balance: bigint; refundDue: bigint; stage: PaymentStage | null };
/** Figures of a TRACKED sale. balance = effectiveTotal − paid; refundDue (sales without a customer) = max(−balance, 0). */
export function paymentFigures(sale: { status: string; total: bigint; customerId: string | null }, returned: bigint, entries: LedgerEntry[]): PaymentFigures {
  const total = BigInt(sale.total);
  const effectiveTotal = ["CANCELLED", "RETURNED"].includes(sale.status) ? 0n : total - returned;
  const paid = netPaid(entries);
  const raw = effectiveTotal - paid;
  const balance = raw > 0n ? raw : 0n;
  const refundDue = raw < 0n && !sale.customerId ? -raw : 0n;
  let stage: PaymentStage | null = null;
  if (sale.status === "CONFIRMED") stage = balance > 0n ? "PENDING_ORDER" : "PAID";
  else if (sale.status === "DELIVERED") stage = refundDue > 0n ? "REFUND_DUE" : balance > 0n ? "BALANCE_DUE" : "PAID";
  else if (sale.status === "CANCELLED" || sale.status === "RETURNED") stage = refundDue > 0n ? "REFUND_DUE" : "SETTLED";
  return { total, returnedValue: returned, effectiveTotal, paid, balance, refundDue, stage };
}

// ---- Idempotency of money operations (sale_money_operations) ----

export function moneyCommandHash(kind: string, resourceId: string, input: object) {
  const { requestId: _transport, ...command } = input as Record<string, unknown>;
  return createHash("sha256").update(JSON.stringify({ kind, resourceId, command })).digest("hex");
}
const jsonSafe = (value: unknown) => JSON.parse(JSON.stringify(value, (_k, v) => typeof v === "bigint" ? v.toString() : v));

/**
 * Receipt lookup and storage for money operations. The caller already holds lockAccountForMoney (Agents.md), so a
 * repeated operationId is answered from its receipt before any state or version check.
 */
export async function withMoneyReceipt<T>(tx: Tx, ownerId: string, input: { operationId: string; requestId: string }, kind: string, resourceId: string, work: () => Promise<T>) {
  const requestHash = moneyCommandHash(kind, resourceId, input);
  const prior = await tx.saleMoneyOperation.findUnique({ where: { ownerId_operationId: { ownerId, operationId: input.operationId } } });
  if (prior) {
    if (prior.kind !== kind || prior.resourceId !== resourceId || prior.requestHash !== requestHash) fail("IDEMPOTENCY_CONFLICT");
    return { result: prior.responseSnapshot as unknown as T, idempotent: true };
  }
  const result = await work();
  await tx.saleMoneyOperation.create({ data: { ownerId, operationId: input.operationId, requestId: input.requestId, kind, resourceId, requestHash, responseSnapshot: jsonSafe(result) } });
  return { result: jsonSafe(result) as T, idempotent: false };
}

// ---- Ledger writes ----

/** Writes entries of one operation, numbering them per sale and for the credit ledger (unique per operation). */
export function ledgerWriter(tx: Tx, ownerId: string, operationId: string) {
  const salePositions = new Map<string, number>();
  let creditPosition = 0;
  return {
    async sale(saleId: string, data: { kind: EntryKind; amount: bigint; method?: PaymentMethod | null; methodNote?: string | null; reference?: string | null; cashReceived?: bigint | null;
      creditEntryId?: string | null; reversesEntryId?: string | null; reason?: string | null }) {
      const position = (salePositions.get(saleId) ?? 0) + 1; salePositions.set(saleId, position);
      return tx.salePaymentEntry.create({ data: { ownerId, saleId, operationId, position, kind: data.kind, amount: data.amount, method: data.method ?? null, methodNote: data.methodNote ?? null,
        reference: data.reference ?? null, cashReceived: data.cashReceived ?? null, creditEntryId: data.creditEntryId ?? null, reversesEntryId: data.reversesEntryId ?? null, reason: data.reason ?? null } });
    },
    async credit(customerId: string, data: { kind: CreditKind; amount: bigint; saleId?: string | null; method?: PaymentMethod | null; methodNote?: string | null; reference?: string | null;
      reversesEntryId?: string | null; reason?: string | null }) {
      creditPosition += 1;
      return tx.customerCreditEntry.create({ data: { ownerId, customerId, operationId, position: creditPosition, kind: data.kind, amount: data.amount, saleId: data.saleId ?? null,
        method: data.method ?? null, methodNote: data.methodNote ?? null, reference: data.reference ?? null, reversesEntryId: data.reversesEntryId ?? null, reason: data.reason ?? null } });
    },
  };
}
export type LedgerWriter = ReturnType<typeof ledgerWriter>;

export async function customerCreditBalance(tx: Tx, ownerId: string, customerId: string) {
  const entries = await tx.customerCreditEntry.findMany({ where: { ownerId, customerId }, select: { id: true, kind: true, amount: true, reversesEntryId: true } });
  return creditBalanceOf(entries);
}

type SaleForMoney = { id: string; userId: string; status: string; total: bigint; customerId: string | null; paymentMode: string;
  lines: SaleLineValue[]; returns: { lines: ReturnLineValue[] }[] };
const saleMoneyInclude = { lines: true, returns: { include: { lines: true } } } as const;

/** Current figures of a sale, read inside the caller's transaction (after its row lock). */
export async function saleMoneyState(tx: Tx, ownerId: string, saleId: string) {
  const sale = await tx.sale.findFirst({ where: { id: saleId, userId: ownerId }, include: saleMoneyInclude }) as unknown as SaleForMoney | null;
  if (!sale) fail("NOT_FOUND");
  const entries = await tx.salePaymentEntry.findMany({ where: { saleId, ownerId }, orderBy: [{ createdAt: "asc" }, { position: "asc" }, { id: "asc" }] });
  return { sale: sale!, entries, figures: paymentFigures(sale!, returnedValue(sale!.lines, sale!.returns), entries) };
}

/**
 * Records the payments and the customer credit used in one go. The caller checked that the sale is TRACKED and not
 * a draft. Nothing is ever paid above the effective total (PAYMENT_EXCEEDS_BALANCE).
 */
export async function recordPayments(tx: Tx, w: LedgerWriter, ownerId: string, saleId: string, payments: PaymentInput[] = [], customerCreditAmount?: string) {
  const { sale, figures } = await saleMoneyState(tx, ownerId, saleId);
  const credit = customerCreditAmount === undefined ? 0n : BigInt(customerCreditAmount);
  const incoming = payments.reduce((sum, payment) => sum + BigInt(payment.amount), 0n) + credit;
  if (incoming > figures.balance) fail("PAYMENT_EXCEEDS_BALANCE");
  if (credit > 0n) {
    if (!sale.customerId) fail("CUSTOMER_REQUIRED_FOR_CREDIT");
    if (await customerCreditBalance(tx, ownerId, sale.customerId!) < credit) fail("CREDIT_INSUFFICIENT");
    const used = await w.credit(sale.customerId!, { kind: "USED", amount: credit, saleId });
    await w.sale(saleId, { kind: "CREDIT_USE", amount: credit, creditEntryId: used.id });
  }
  for (const payment of payments) await w.sale(saleId, { kind: "PAYMENT", amount: BigInt(payment.amount), method: payment.method, methodNote: payment.methodNote ?? null,
    reference: payment.reference ?? null, cashReceived: payment.cashReceived === undefined ? null : BigInt(payment.cashReceived) });
}

/** Reverses one entry; entries paired with the credit balance reverse their credit entry in the same operation. */
async function reverseEntry(tx: Tx, w: LedgerWriter, ownerId: string, entry: { id: string; saleId: string; amount: bigint; creditEntryId: string | null }, reason: string) {
  let creditEntryId: string | null = null;
  if (entry.creditEntryId) {
    const original = await tx.customerCreditEntry.findFirst({ where: { id: entry.creditEntryId, ownerId } });
    if (!original) fail("CREDIT_ENTRY_NOT_FOUND");
    creditEntryId = (await w.credit(original!.customerId, { kind: "REVERSAL", amount: original!.amount, saleId: original!.saleId, reversesEntryId: original!.id, reason })).id;
  }
  return w.sale(entry.saleId, { kind: "REVERSAL", amount: entry.amount, reversesEntryId: entry.id, creditEntryId, reason });
}

/**
 * Settles a sale after any change (contract 5.1 and 5.5): money that a void took back from a moved excess is first
 * recovered from the credit balance; any excess goes to the customer's credit balance (EXCESS_TO_CREDIT + FROM_SALE)
 * or, without a customer, stays «por devolver» unless refundNow returns it (SALE_REFUND).
 */
export async function settleSale(tx: Tx, w: LedgerWriter, ownerId: string, saleId: string, options: { refundNow?: RefundInput; reason?: string } = {}) {
  let state = await saleMoneyState(tx, ownerId, saleId);
  if (state.figures.paid < 0n) {
    const undone = reversedIds(state.entries);
    const moved = state.entries.filter(entry => entry.kind === "EXCESS_TO_CREDIT" && !undone.has(entry.id)).reverse();
    let paid = state.figures.paid;
    for (const entry of moved) {
      if (paid >= 0n) break;
      await reverseEntry(tx, w, ownerId, entry, options.reason ?? "Anulación de un pago");
      paid += entry.amount;
    }
    if (paid < 0n) fail(state.sale.customerId ? "CREDIT_ALREADY_USED" : "PAYMENT_ALREADY_REFUNDED");
    state = await saleMoneyState(tx, ownerId, saleId);
  }
  const excess = state.figures.paid - state.figures.effectiveTotal;
  if (excess > 0n && state.sale.customerId) {
    const moved = await w.credit(state.sale.customerId, { kind: "FROM_SALE", amount: excess, saleId });
    await w.sale(saleId, { kind: "EXCESS_TO_CREDIT", amount: excess, creditEntryId: moved.id });
  } else if (excess > 0n && options.refundNow) {
    await w.sale(saleId, { kind: "SALE_REFUND", amount: excess, method: options.refundNow.method, methodNote: options.refundNow.methodNote ?? null,
      reference: options.refundNow.reference ?? null, reason: options.reason ?? null });
  }
  if (state.sale.customerId && await customerCreditBalance(tx, ownerId, state.sale.customerId) < 0n) fail("CREDIT_ALREADY_USED");
}

/** Voids one PAYMENT, CREDIT_USE or SALE_REFUND of a sale with a reason, then settles it. */
export async function voidEntry(tx: Tx, w: LedgerWriter, ownerId: string, saleId: string, entryId: string, reason: string) {
  const { entries } = await saleMoneyState(tx, ownerId, saleId);
  const entry = entries.find(row => row.id === entryId);
  if (!entry) fail("PAYMENT_NOT_FOUND");
  if (!["PAYMENT", "CREDIT_USE", "SALE_REFUND"].includes(entry!.kind)) fail("PAYMENT_NOT_VOIDABLE");
  if (reversedIds(entries).has(entryId)) fail("PAYMENT_ALREADY_VOIDED");
  await reverseEntry(tx, w, ownerId, entry!, reason);
  await settleSale(tx, w, ownerId, saleId, { reason });
}

// ---- Read model ----

type SaleView = { id: string; status: string; total: bigint; customerId: string | null; paymentMode: string; lines: SaleLineValue[]; returns: { lines: ReturnLineValue[] }[] };
const presentEntry = (entry: Prisma.SalePaymentEntryGetPayload<object>, reversed: Set<string>) => ({
  id: entry.id, kind: entry.kind, amount: entry.amount, method: entry.method, methodNote: entry.methodNote, reference: entry.reference, cashReceived: entry.cashReceived,
  change: entry.cashReceived === null ? null : entry.cashReceived - entry.amount, reversesEntryId: entry.reversesEntryId, reason: entry.reason, voided: reversed.has(entry.id),
  operationId: entry.operationId, createdAt: entry.createdAt });

/**
 * The `payments` block of a sale (contract 7.2). LEGACY sales: { mode: "LEGACY" } only. Detail adds the movements
 * and, with a customer, the customer's current credit balance. Read-only.
 */
export async function attachPayments<T extends SaleView>(tx: Tx, ownerId: string, sales: T[], detail: boolean) {
  const tracked = sales.filter(sale => sale.paymentMode === "TRACKED");
  const entries = tracked.length ? await tx.salePaymentEntry.findMany({ where: { ownerId, saleId: { in: tracked.map(sale => sale.id) } }, orderBy: [{ createdAt: "asc" }, { position: "asc" }, { id: "asc" }] }) : [];
  const credit = new Map<string, bigint>();
  if (detail) for (const customerId of new Set(sales.flatMap(sale => sale.customerId ? [sale.customerId] : []))) credit.set(customerId, await customerCreditBalance(tx, ownerId, customerId));
  return sales.map(sale => {
    const customerCredit = sale.customerId && credit.has(sale.customerId) ? credit.get(sale.customerId)! : null;
    if (sale.paymentMode !== "TRACKED") return { ...sale, payments: { mode: "LEGACY" as const, ...(detail ? { customerCredit } : {}) } };
    const mine = entries.filter(entry => entry.saleId === sale.id);
    const figures = paymentFigures(sale, returnedValue(sale.lines, sale.returns), mine);
    const reversed = reversedIds(mine);
    return { ...sale, payments: { mode: "TRACKED" as const, creditSalesEnabled: CREDIT_SALES_ENABLED, ...figures,
      ...(detail ? { entries: mine.map(entry => presentEntry(entry, reversed)), customerCredit } : {}) } };
  });
}
