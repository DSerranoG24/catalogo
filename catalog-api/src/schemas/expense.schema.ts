import { z } from "zod";

// Gastos F1a (docs/expenses-contract.md v1.2). Strict schemas: unknown fields, ownerId,
// recordedAt, taxMode or status sent by the client are rejected.
export const PAYMENT_METHODS = ["CASH", "NEQUI", "DAVIPLATA", "BANK_TRANSFER", "CARD", "OTHER"] as const;
export const MAX_EXPENSE_AMOUNT = 1000000000000n;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const uuid = z.uuid();
export const version = z.number().int().min(1).max(2147483647);
/** Single-line text: no control characters, trimmed, inner whitespace collapsed. */
export const text = (min: number, max: number) => z.string().max(max * 4).regex(/^[^\u0000-\u001f\u007f]*$/)
  .transform(value => value.trim().replace(/\s+/g, " ")).pipe(z.string().min(min).max(max));
/** COP as a decimal string of digits, 1..1.000.000.000.000. Never a JSON number. */
export const amount = z.string().refine(value => /^[1-9][0-9]{0,12}$/.test(value) && BigInt(value) <= MAX_EXPENSE_AMOUNT);

export function isCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
export const isoDate = z.string().refine(isCalendarDate);
export const keys = { operationId: uuid, requestId: uuid };

const expenseFields = {
  expenseDate: isoDate,
  amount,
  categoryId: uuid,
  paymentMethod: z.enum(PAYMENT_METHODS),
  paymentMethodNote: text(3, 80).nullable().optional(),
  paymentReference: text(1, 100).nullable().optional(),
  description: text(1, 300),
  supplierName: text(1, 160).nullable().optional(),
};
export function noteMatchesMethod(value: { paymentMethod: PaymentMethod; paymentMethodNote?: string | null }, ctx: z.RefinementCtx) {
  if ((value.paymentMethod === "OTHER") !== (value.paymentMethodNote !== undefined && value.paymentMethodNote !== null))
    ctx.addIssue({ code: "custom", path: ["paymentMethodNote"], message: "OTHER requires a note; other methods have none." });
}

export const expenseInputSchema = z.object(expenseFields).strict().superRefine(noteMatchesMethod);
export const createExpenseSchema = z.object({ ...keys, ...expenseFields }).strict().superRefine(noteMatchesMethod);
/** Reclassify: only category, description and the payment-method note. */
export const reclassifyExpenseSchema = z.object({ ...keys, expectedVersion: version, categoryId: uuid.optional(), description: text(1, 300).optional(), paymentMethodNote: text(3, 80).optional() })
  .strict().refine(value => value.categoryId !== undefined || value.description !== undefined || value.paymentMethodNote !== undefined);
export const voidExpenseSchema = z.object({ ...keys, expectedVersion: version, reason: text(3, 300), replacement: expenseInputSchema.optional() }).strict();

export const seedCategoriesSchema = z.object(keys).strict();
export const createCategorySchema = z.object({ ...keys, name: text(1, 60) }).strict();
export const updateCategorySchema = z.object({ ...keys, expectedVersion: version, name: text(1, 60).optional(), position: z.number().int().min(0).max(10000).optional() })
  .strict().refine(value => value.name !== undefined || value.position !== undefined);
export const categoryStateSchema = z.object({ ...keys, expectedVersion: version }).strict();

export const categoryListSchema = z.object({ status: z.enum(["active", "archived", "all"]).default("active") }).strict();
const withinRange = (value: { from: string; to: string }) => value.from <= value.to && (Date.parse(value.to) - Date.parse(value.from)) / 86400000 <= 365;
export const expenseListSchema = z.object({
  from: isoDate, to: isoDate, categoryId: uuid.optional(), paymentMethod: z.enum(PAYMENT_METHODS).optional(),
  status: z.enum(["CONFIRMED", "VOIDED", "SKIPPED", "all"]).default("CONFIRMED"), origin: z.enum(["fixed"]).optional(), cursor: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/).optional(),
}).strict().refine(withinRange);
export const expenseSummarySchema = z.object({ from: isoDate, to: isoDate, categoryId: uuid.optional(), paymentMethod: z.enum(PAYMENT_METHODS).optional() }).strict().refine(withinRange);
export const expenseIdSchema = uuid;

/** Category identity: NFC, trimmed, collapsed spaces, lower case. */
export function normalizeCategoryName(name: string) { return name.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase(); }

export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;
export type ExpenseInput = z.infer<typeof expenseInputSchema>;
export type ReclassifyExpenseInput = z.infer<typeof reclassifyExpenseSchema>;
export type VoidExpenseInput = z.infer<typeof voidExpenseSchema>;
export type ExpenseListQuery = z.infer<typeof expenseListSchema>;
export type ExpenseSummaryQuery = z.infer<typeof expenseSummarySchema>;
