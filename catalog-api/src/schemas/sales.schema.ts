import { z } from "zod";
const money = z.preprocess(v => typeof v === "number" && Number.isSafeInteger(v) ? String(v) : v, z.string().refine(v => /^\d+$/.test(v) && BigInt(v) <= 9223372036854775807n, "COP entero válido"));
const quantity = z.number().int().positive().max(2147483647);
const uuid = z.uuid();
export const saleOperationStatusSchema = z.enum(["PREPARED", "SUCCEEDED", "REJECTED", "ABANDONED"]);
export const saleMovementRoleSchema = z.enum(["SALE_CONFIRMATION", "SALE_CANCELLATION", "SALE_RETURN_RESELLABLE", "SALE_RETURN_DAMAGED"]);
export const saleOperationSchema = z.object({ operationId: uuid, requestId: uuid, expectedSaleVersion: z.number().int().positive().nullable(), status: saleOperationStatusSchema, requestHash: z.string().regex(/^[a-f0-9]{64}$/), responseSnapshot: z.unknown().nullable() }).strict();
export const saleLineInputSchema = z.object({ inventoryItemId: uuid, quantity, unitDiscount: money }).strict();
export const createSaleSchema = z.object({ operationId: uuid, requestId: uuid, customerId: uuid.nullable().optional(), customerName: z.string().trim().max(160).optional(), customerPhone: z.string().trim().max(40).optional() }).strict();
export const updateDraftSaleSchema = z.object({ operationId: uuid, expectedVersion: z.number().int().positive(), lines: z.array(saleLineInputSchema).min(1).max(100), customerId: uuid.nullable().optional(), customerName: z.string().trim().max(160).nullable().optional(), customerPhone: z.string().trim().max(40).nullable().optional() }).strict();
// ---- Payments of a sale (F2a-2b, docs/sales-payments-cartera-contract.md). Amounts: COP integers as strings, 1..1e12. ----
export const MAX_PAYMENT_AMOUNT = 1_000_000_000_000n;
// Zod runs every refinement, so each one guards its own BigInt conversion.
const isAmount = (v: unknown): v is string => typeof v === "string" && /^\d+$/.test(v) && BigInt(v) >= 1n && BigInt(v) <= MAX_PAYMENT_AMOUNT;
const paymentAmount = money.refine(isAmount, "Monto entre 1 y 1.000.000.000.000");
export const salePaymentMethodSchema = z.enum(["CASH", "NEQUI", "DAVIPLATA", "BANK_TRANSFER", "CARD", "OTHER"]);
const methodNote = z.string().trim().min(3).max(80);
const reference = z.string().trim().min(1).max(100);
const moneyReason = z.string().trim().min(3).max(300);
const noteRule = (v: { method: string; methodNote?: string }, ctx: z.RefinementCtx) => {
  if ((v.method === "OTHER") !== (v.methodNote !== undefined)) ctx.addIssue({ code: "custom", path: ["methodNote"], message: "La nota es obligatoria con OTHER y solo con OTHER." });
};
/** One real payment. cashReceived (CASH only, >= amount) is informative: the change is shown, never stored. */
export const salePaymentInputSchema = z.object({ method: salePaymentMethodSchema, amount: paymentAmount, methodNote: methodNote.optional(), reference: reference.optional(), cashReceived: paymentAmount.optional() }).strict()
  .superRefine((v, ctx) => {
    noteRule(v, ctx);
    if (v.cashReceived !== undefined && (v.method !== "CASH" || !isAmount(v.cashReceived) || !isAmount(v.amount) || BigInt(v.cashReceived) < BigInt(v.amount))) ctx.addIssue({ code: "custom", path: ["cashReceived"], message: "El efectivo recibido solo aplica a pagos en efectivo y no puede ser menor que el monto." });
  });
export const refundInputSchema = z.object({ method: salePaymentMethodSchema, methodNote: methodNote.optional(), reference: reference.optional() }).strict().superRefine(noteRule);
const paymentsField = z.array(salePaymentInputSchema).max(10);
/** Sending payments or customerCreditAmount (even payments: []) is what makes a confirmed sale TRACKED; omitting both keeps today's LEGACY flow. */
const paymentFields = { payments: paymentsField.optional(), customerCreditAmount: paymentAmount.optional() };

export const confirmSaleSchema = z.object({ operationId: uuid, requestId: uuid, expectedVersion: z.number().int().positive(), deliverImmediately: z.boolean().default(false), ...paymentFields }).strict();
export const transitionSaleSchema = z.object({ operationId: uuid, requestId: uuid, expectedVersion: z.number().int().positive() }).strict();
export const deliverSaleSchema = transitionSaleSchema.extend(paymentFields).strict();
export const cancelSaleSchema = transitionSaleSchema.extend({ reason: z.string().trim().min(3).max(300), refundNow: refundInputSchema.optional() }).strict();
export const returnLineSchema = z.object({ saleLineId: uuid, receivedQuantity: quantity, resellableQuantity: z.number().int().min(0), damagedQuantity: z.number().int().min(0) }).strict().superRefine((v, ctx) => { if (v.resellableQuantity + v.damagedQuantity !== v.receivedQuantity) ctx.addIssue({ code: "custom", message: "La disposición debe coincidir con la cantidad recibida.", path: ["resellableQuantity"] }); });
export const returnSaleSchema = transitionSaleSchema.extend({ reason: z.string().trim().min(3).max(300), lines: z.array(returnLineSchema).min(1).max(100), refundNow: refundInputSchema.optional() }).strict();
/** Anticipo on a CONFIRMED sale: at least one payment or some customer credit. */
export const salePaymentsSchema = transitionSaleSchema.extend(paymentFields).strict().superRefine((v, ctx) => {
  if (!v.payments?.length && v.customerCreditAmount === undefined) ctx.addIssue({ code: "custom", path: ["payments"], message: "Registra al menos un pago." });
});
export const voidSalePaymentSchema = transitionSaleSchema.extend({ reason: moneyReason }).strict();
export const saleCustomerLinkSchema = transitionSaleSchema.extend({ customerId: uuid }).strict();
export const saleRefundSchema = transitionSaleSchema.extend({ amount: paymentAmount, method: salePaymentMethodSchema, methodNote: methodNote.optional(), reference: reference.optional(), reason: moneyReason }).strict().superRefine(noteRule);
export const creditRefundSchema = z.object({ operationId: uuid, requestId: uuid, amount: paymentAmount, method: salePaymentMethodSchema, methodNote: methodNote.optional(), reference: reference.optional(), reason: moneyReason }).strict().superRefine(noteRule);
export const creditRefundVoidSchema = z.object({ operationId: uuid, requestId: uuid, reason: moneyReason }).strict();
export const convertOrderToSaleSchema = z.object({
  operationId: uuid,
  requestId: uuid,
  customerId: uuid.nullable().optional(),
  mode: z.enum(["DRAFT", "CONFIRMED", "DELIVERED"]).default("DRAFT"),
  acceptPriceDifference: z.boolean().default(false),
  ...paymentFields,
}).strict().superRefine((value, ctx) => {
  if (value.operationId === value.requestId) ctx.addIssue({ code: "custom", path: ["requestId"], message: "operationId y requestId deben ser distintos." });
  if (value.mode === "DRAFT" && (value.payments !== undefined || value.customerCreditAmount !== undefined)) ctx.addIssue({ code: "custom", path: ["payments"], message: "Un borrador no registra pagos." });
});
