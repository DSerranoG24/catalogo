import type { DisplayStatus, Sale } from "./sales-ui.mjs";

export type HistoryFilter = "all" | DisplayStatus;
export type PaymentStage = "PENDING_ORDER" | "PAID" | "BALANCE_DUE" | "REFUND_DUE" | "SETTLED";
export type MoneyMethod = "CASH" | "NEQUI" | "DAVIPLATA" | "BANK_TRANSFER" | "CARD" | "OTHER";
export type LedgerEntry = { id: string; kind: "PAYMENT" | "CREDIT_USE" | "EXCESS_TO_CREDIT" | "SALE_REFUND" | "REVERSAL" | "RECEIPT_ALLOCATION"; amount: string; method: MoneyMethod | null;
  methodNote?: string | null; reference?: string | null; cashReceived: string | null; change: string | null; reversesEntryId: string | null; reason?: string | null; voided: boolean; createdAt: string };
export type SalePayments =
  | { mode: "LEGACY"; customerCredit: string | null }
  | { mode: "TRACKED"; total: string; returnedValue: string; effectiveTotal: string; paid: string; balance: string; refundDue: string; stage: PaymentStage | null; entries: LedgerEntry[]; customerCredit: string | null };
export type LedgerRow = { id: string; kind: LedgerEntry["kind"]; label: string; amount: string; sign: 1 | -1; createdAt: string; change: string | null; reference: string | null;
  voided: boolean; voidReason: string | null; voidedAt: string | null; reason: string | null };
export type DetailActions = { continueDraft: boolean; chargeAndDeliver: boolean; registerPayment: boolean; deliver: boolean; cancel: boolean; registerReturn: boolean;
  refundMoney: boolean; refundCredit: boolean; voidable: string[]; replaceable: string[] };

export const HISTORY_FILTERS: HistoryFilter[];
export const FILTER_LABELS: Record<HistoryFilter, string>;
export const VY_STATUS_TONES: Record<DisplayStatus, string>;
export const STAGE_LABELS: Record<PaymentStage, string>;
export const REFUND_METHODS: MoneyMethod[];
export const REFUND_METHOD_LABELS: Record<MoneyMethod, string>;
export function isSaleId(value: unknown): value is string;
export function salePayments(sale: Sale): SalePayments;
export function rowMoney(sale: Sale): { paid: string; balance: string; refundDue: string; stage: PaymentStage | null } | null;
export function filterSales(sales: Sale[], status: HistoryFilter): Sale[];
export function apiStatusOf(filter: HistoryFilter): string;
export function detailActions(sale: Sale, payments?: SalePayments): DetailActions;
export function ledgerRows(entries: LedgerEntry[]): LedgerRow[];
export function changeGiven(entries: LedgerEntry[]): bigint;
export function reasonError(value: unknown): string | null;
export function refundMethod(method: string, note: string): { value: { method: MoneyMethod; methodNote?: string }; error?: undefined } | { error: string; value?: undefined };
export function cancelOutcome(sale: Sale, payments?: SalePayments): { kind: "none" } | { kind: "credit" | "refund"; amount: string };
export function saleIdFrom(value: unknown): string | null;
