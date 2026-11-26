import { z } from "zod";
import { amount, isCalendarDate, isoDate, keys, noteMatchesMethod, PAYMENT_METHODS, text, uuid, version } from "./expense.schema";

// Gastos F1b (docs/expenses-f1b-contract.md). Strict: unknown fields, ownerId, status or totals are rejected.
const method = z.enum(PAYMENT_METHODS);
const note = text(3, 80);
const optionalNote = { paymentMethodNote: note.nullable().optional() };

const recurringFields = {
  description: text(1, 300), categoryId: uuid, paymentMethod: method, ...optionalNote, supplierName: text(1, 160).nullable().optional(),
  estimatedAmount: amount.nullable().optional(), frequency: z.enum(["WEEKLY", "MONTHLY", "YEARLY"]), interval: z.number().int().min(1).max(12),
  anchorDate: isoDate, endDate: isoDate.nullable().optional(),
};
const endAfterAnchor = (value: { anchorDate?: string; endDate?: string | null }) => !value.anchorDate || !value.endDate || value.endDate >= value.anchorDate;
export const createRecurringSchema = z.object({ ...keys, ...recurringFields }).strict().superRefine(noteMatchesMethod).refine(endAfterAnchor);
/** Partial edit; method/note consistency is checked against the resulting values in the repository. */
export const updateRecurringSchema = z.object({ ...keys, expectedVersion: version, ...Object.fromEntries(Object.entries(recurringFields).map(([k, v]) => [k, v.optional()])) as {
  [K in keyof typeof recurringFields]: z.ZodOptional<(typeof recurringFields)[K]> } }).strict()
  .refine(value => Object.keys(recurringFields).some(k => (value as Record<string, unknown>)[k] !== undefined)).refine(endAfterAnchor);
export const recurringStateSchema = z.object({ ...keys, expectedVersion: version }).strict();
export const recurringListSchema = z.object({ status: z.enum(["current", "ACTIVE", "PAUSED", "ENDED", "all"]).default("current") }).strict();

const scheduledFields = {
  dueDate: isoDate, plannedAmount: amount.nullable().optional(), description: text(1, 300), categoryId: uuid, paymentMethod: method, ...optionalNote,
  supplierName: text(1, 160).nullable().optional(),
};
export const createScheduledSchema = z.object({ ...keys, ...scheduledFields }).strict().superRefine(noteMatchesMethod);
export const updateScheduledSchema = z.object({ ...keys, expectedVersion: version, ...Object.fromEntries(Object.entries(scheduledFields).map(([k, v]) => [k, v.optional()])) as {
  [K in keyof typeof scheduledFields]: z.ZodOptional<(typeof scheduledFields)[K]> } }).strict()
  .refine(value => Object.keys(scheduledFields).some(k => (value as Record<string, unknown>)[k] !== undefined));
/** Mark paid: the real amount is mandatory and may differ from the planned one; the date is the payment date. */
export const payScheduledSchema = z.object({
  ...keys, expectedVersion: version, amount, expenseDate: isoDate, paymentMethod: method, ...optionalNote,
  paymentReference: text(1, 100).nullable().optional(), categoryId: uuid.optional(), description: text(1, 300).optional(), supplierName: text(1, 160).nullable().optional(),
}).strict().superRefine(noteMatchesMethod);
export const cancelScheduledSchema = z.object({ ...keys, expectedVersion: version, reason: text(1, 300).optional() }).strict();
const withinYear = (value: { from?: string; to?: string }) => !value.from || !value.to || (value.from <= value.to && (Date.parse(value.to) - Date.parse(value.from)) / 86400000 <= 366);
export const scheduledListSchema = z.object({
  status: z.enum(["PENDING", "PAID", "CANCELLED", "all"]).default("PENDING"), kind: z.enum(["fixed", "single", "all"]).default("all"),
  from: isoDate.optional(), to: isoDate.optional(),
}).strict().refine(withinYear);

export { isCalendarDate };
export type CreateRecurringInput = z.infer<typeof createRecurringSchema>;
export type UpdateRecurringInput = z.infer<typeof updateRecurringSchema>;
export type CreateScheduledInput = z.infer<typeof createScheduledSchema>;
export type UpdateScheduledInput = z.infer<typeof updateScheduledSchema>;
export type PayScheduledInput = z.infer<typeof payScheduledSchema>;
export type ScheduledListQuery = z.infer<typeof scheduledListSchema>;
