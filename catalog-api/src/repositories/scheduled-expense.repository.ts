import { Prisma, type ExpenseCategory, type RecurringExpenseTemplate, type ScheduledExpensePayment } from "@prisma/client";
import { prisma } from "../config/prisma";
import { lockAccountForMoney } from "./account-lock";
import { activeCategory, ExpenseError, expenseView, insertExpense, makeExpenseMutation, type EventDraft, type Tx } from "./expense.repository";
import { bogotaToday, fromDbDate, minExpenseDate, toDbDate } from "../services/expense-dates";
import { addDays, nextOccurrence, syncPlan, type ScheduleRule } from "../services/schedule-dates";
import type { CreateRecurringInput, CreateScheduledInput, PayScheduledInput, ScheduledListQuery, UpdateRecurringInput, UpdateScheduledInput } from "../schemas/scheduled-expense.schema";

// Gastos F1b (docs/expenses-f1b-contract.md): fixed expenses (recurring_expense_templates) and scheduled payments.
// Scheduled payments never count in expense totals; paying one creates a CONFIRMED expense linked by scheduledPaymentId.
export const RECURRING_QUOTA = 100;
export const SINGLE_PENDING_QUOTA = 500;
export const MAX_DUE_DAYS_AHEAD = 366;
export const LIST_LIMIT = 500;

type PaymentRow = ScheduledExpensePayment & { category?: Pick<ExpenseCategory, "name" | "archivedAt"> | null; paidExpense?: { amount: bigint | null; expenseDate: Date } | null };
type TemplateRow = RecurringExpenseTemplate & { category?: Pick<ExpenseCategory, "name" | "archivedAt"> | null };
const paymentInclude = { category: { select: { name: true, archivedAt: true } }, paidExpense: { select: { amount: true, expenseDate: true } } } satisfies Prisma.ScheduledExpensePaymentInclude;
const templateInclude = { category: { select: { name: true, archivedAt: true } } } satisfies Prisma.RecurringExpenseTemplateInclude;
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);

export function scheduledView(p: PaymentRow, today: string) {
  const dueDate = fromDbDate(p.dueDate);
  return {
    id: p.id, status: p.status, kind: p.templateId ? "fixed" as const : "single" as const, templateId: p.templateId,
    occurrenceDate: p.occurrenceDate ? fromDbDate(p.occurrenceDate) : null, dueDate, daysUntilDue: daysBetween(today, dueDate), overdue: p.status === "PENDING" && dueDate < today,
    plannedAmount: p.plannedAmount?.toString() ?? null, description: p.description, categoryId: p.categoryId, categoryName: p.category?.name ?? p.categoryNameSnapshot,
    categoryArchived: Boolean(p.category?.archivedAt), paymentMethod: p.paymentMethod, paymentMethodNote: p.paymentMethodNote, supplierName: p.supplierName,
    customized: Boolean(p.customizedAt), paidExpenseId: p.paidExpenseId, paidAt: p.paidAt?.toISOString() ?? null,
    paidAmount: p.paidExpense?.amount?.toString() ?? null, paidDate: p.paidExpense ? fromDbDate(p.paidExpense.expenseDate) : null,
    cancelledAt: p.cancelledAt?.toISOString() ?? null, cancelReason: p.cancelReason, version: p.version,
  };
}
export const ruleOf = (t: Pick<RecurringExpenseTemplate, "frequency" | "interval" | "anchorDate" | "endDate">): ScheduleRule =>
  ({ frequency: t.frequency, interval: t.interval, anchorDate: fromDbDate(t.anchorDate), endDate: t.endDate ? fromDbDate(t.endDate) : null });
export function recurringView(t: TemplateRow, today: string) {
  return {
    id: t.id, status: t.status, description: t.description, categoryId: t.categoryId, categoryName: t.category?.name ?? null, categoryArchived: Boolean(t.category?.archivedAt),
    paymentMethod: t.paymentMethod, paymentMethodNote: t.paymentMethodNote, supplierName: t.supplierName, estimatedAmount: t.estimatedAmount?.toString() ?? null,
    frequency: t.frequency, interval: t.interval, anchorDate: fromDbDate(t.anchorDate), endDate: t.endDate ? fromDbDate(t.endDate) : null,
    nextDate: t.status === "ENDED" ? null : nextOccurrence(ruleOf(t), today), endedAt: t.endedAt?.toISOString() ?? null, version: t.version,
  };
}
const sameNoteRule = (method: string, note: string | null | undefined) => (method === "OTHER") === (note !== null && note !== undefined);
function allowedDueDate(date: string, today: string) { return date >= minExpenseDate(today) && date <= addDays(today, MAX_DUE_DAYS_AHEAD); }

/**
 * Generates the occurrences of one ACTIVE fixed expense up to the horizon (contract §5). Duplicates are ignored by the
 * partial unique index through ON CONFLICT DO NOTHING (correction B); generatedThrough advances without a version bump.
 */
async function generate(tx: Tx, ownerId: string, template: RecurringExpenseTemplate, today: string) {
  if (template.status !== "ACTIVE") return 0;
  const plan = syncPlan(ruleOf(template), template.generatedThrough ? fromDbDate(template.generatedThrough) : null, today);
  let created = 0;
  if (plan.dates.length) {
    const category = await tx.expenseCategory.findFirst({ where: { id: template.categoryId, ownerId }, select: { name: true } });
    const result = await tx.scheduledExpensePayment.createMany({ skipDuplicates: true, data: plan.dates.map(date => ({
      ownerId, templateId: template.id, occurrenceDate: toDbDate(date), dueDate: toDbDate(date), plannedAmount: template.estimatedAmount, description: template.description,
      categoryId: template.categoryId, categoryNameSnapshot: category?.name ?? null, paymentMethod: template.paymentMethod, paymentMethodNote: template.paymentMethodNote, supplierName: template.supplierName,
    })) });
    created = result.count;
  }
  await tx.recurringExpenseTemplate.update({ where: { id_ownerId: { id: template.id, ownerId } }, data: { generatedThrough: toDbDate(plan.through) } });
  return created;
}
/** Cancels the PENDING occurrences of a template due after today (optionally only the ones not edited by hand). */
async function cancelFuture(tx: Tx, ownerId: string, templateId: string, today: string, reason: string, now: Date, onlyUncustomized: boolean) {
  const { count } = await tx.scheduledExpensePayment.updateMany({
    where: { ownerId, templateId, status: "PENDING", dueDate: { gt: toDbDate(today) }, ...(onlyUncustomized ? { customizedAt: null } : {}) },
    data: { status: "CANCELLED", cancelledAt: now, cancelReason: reason, version: { increment: 1 } } });
  return count;
}

export function makeScheduledExpenseRepository(database: typeof prisma = prisma, clock: () => Date = () => new Date()) {
  const mutation = makeExpenseMutation(database, clock);
  async function lockedTemplate(tx: Tx, ownerId: string, id: string) {
    await tx.$queryRaw`SELECT id FROM recurring_expense_templates WHERE id = ${id} AND "ownerId" = ${ownerId} FOR UPDATE`;
    const row = await tx.recurringExpenseTemplate.findFirst({ where: { id, ownerId }, include: templateInclude });
    if (!row) throw new ExpenseError("RECURRING_EXPENSE_NOT_FOUND");
    return row;
  }
  async function lockedPayment(tx: Tx, ownerId: string, id: string) {
    await tx.$queryRaw`SELECT id FROM scheduled_expense_payments WHERE id = ${id} AND "ownerId" = ${ownerId} FOR UPDATE`;
    const row = await tx.scheduledExpensePayment.findFirst({ where: { id, ownerId }, include: paymentInclude });
    if (!row) throw new ExpenseError("SCHEDULED_EXPENSE_NOT_FOUND");
    return row;
  }
  const reloadTemplate = (tx: Tx, ownerId: string, id: string) => tx.recurringExpenseTemplate.findFirstOrThrow({ where: { id, ownerId }, include: templateInclude });
  const reloadPayment = (tx: Tx, ownerId: string, id: string) => tx.scheduledExpensePayment.findFirstOrThrow({ where: { id, ownerId }, include: paymentInclude });
  const templateEvent = (id: string, eventType: string, after: unknown, before?: unknown): EventDraft => ({ entityKind: "TEMPLATE", entityId: id, eventType, before, after });
  const paymentEvent = (id: string, eventType: string, after: unknown, before?: unknown): EventDraft => ({ entityKind: "SCHEDULED_PAYMENT", entityId: id, eventType, before, after });

  return {
    /** POST /expenses/scheduled/sync: explicit generation (correction A); idempotent and safe in parallel (B). */
    async sync(ownerId: string) {
      return database.$transaction(async tx => {
        // Same per-account lock as every expense mutation (replaces 'expenses-v1').
        await lockAccountForMoney(tx, ownerId);
        const today = bogotaToday(clock());
        const templates = await tx.recurringExpenseTemplate.findMany({ where: { ownerId, status: "ACTIVE" }, orderBy: { id: "asc" } });
        let generated = 0;
        for (const template of templates) generated += await generate(tx, ownerId, template, today);
        const pendingCount = await tx.scheduledExpensePayment.count({ where: { ownerId, status: "PENDING" } });
        return { generated, pendingCount };
      });
    },

    async listRecurring(ownerId: string, status: "current" | "ACTIVE" | "PAUSED" | "ENDED" | "all") {
      const rows = await database.recurringExpenseTemplate.findMany({ where: { ownerId, ...(status === "all" ? {} : status === "current" ? { status: { in: ["ACTIVE", "PAUSED"] } } : { status }) },
        include: templateInclude, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
      const today = bogotaToday(clock());
      return { templates: rows.map(row => recurringView(row, today)) };
    },
    createRecurring(ownerId: string, input: CreateRecurringInput) {
      return mutation(ownerId, input, "RECURRING_CREATE", ownerId, async (tx, now) => {
        const today = bogotaToday(now);
        if (await tx.recurringExpenseTemplate.count({ where: { ownerId, status: { in: ["ACTIVE", "PAUSED"] } } }) >= RECURRING_QUOTA) throw new ExpenseError("RECURRING_EXPENSE_QUOTA");
        if (!allowedDueDate(input.anchorDate, today)) throw new ExpenseError("INVALID_EXPENSE_INPUT");
        const category = await activeCategory(tx, ownerId, input.categoryId);
        const created = await tx.recurringExpenseTemplate.create({ data: {
          ownerId, description: input.description, categoryId: category.id, paymentMethod: input.paymentMethod, paymentMethodNote: input.paymentMethodNote ?? null,
          supplierName: input.supplierName ?? null, estimatedAmount: input.estimatedAmount ? BigInt(input.estimatedAmount) : null, frequency: input.frequency, interval: input.interval,
          anchorDate: toDbDate(input.anchorDate), endDate: input.endDate ? toDbDate(input.endDate) : null } });
        const generated = await generate(tx, ownerId, created, today);
        const view = recurringView(await reloadTemplate(tx, ownerId, created.id), today);
        return { result: { template: view, generated }, events: [templateEvent(created.id, "CREATED", view)] };
      });
    },
    /** Decision F1b-5: edits also update PENDING occurrences due after today that were not edited by hand. */
    updateRecurring(ownerId: string, id: string, input: UpdateRecurringInput) {
      return mutation(ownerId, input, "RECURRING_UPDATE", id, async (tx, now) => {
        const today = bogotaToday(now);
        const current = await lockedTemplate(tx, ownerId, id);
        if (current.status === "ENDED") throw new ExpenseError("INVALID_RECURRING_TRANSITION");
        if (current.version !== input.expectedVersion) throw new ExpenseError("VERSION_CONFLICT");
        const method = input.paymentMethod ?? current.paymentMethod;
        const note = input.paymentMethodNote !== undefined ? input.paymentMethodNote : input.paymentMethod !== undefined && input.paymentMethod !== "OTHER" ? null : current.paymentMethodNote;
        if (!sameNoteRule(method, note)) throw new ExpenseError("INVALID_EXPENSE_INPUT");
        const anchor = input.anchorDate ?? fromDbDate(current.anchorDate);
        const end = input.endDate !== undefined ? input.endDate : current.endDate ? fromDbDate(current.endDate) : null;
        if (input.anchorDate !== undefined && !allowedDueDate(anchor, today)) throw new ExpenseError("INVALID_EXPENSE_INPUT");
        if (end && end < anchor) throw new ExpenseError("INVALID_EXPENSE_INPUT");
        const data: Prisma.RecurringExpenseTemplateUncheckedUpdateInput = {};
        if (input.categoryId !== undefined && input.categoryId !== current.categoryId) data.categoryId = (await activeCategory(tx, ownerId, input.categoryId)).id;
        if (input.description !== undefined && input.description !== current.description) data.description = input.description;
        if (method !== current.paymentMethod) data.paymentMethod = method;
        if (note !== current.paymentMethodNote) data.paymentMethodNote = note;
        if (input.supplierName !== undefined && input.supplierName !== current.supplierName) data.supplierName = input.supplierName;
        if (input.estimatedAmount !== undefined && (input.estimatedAmount === null ? null : BigInt(input.estimatedAmount)) !== current.estimatedAmount) data.estimatedAmount = input.estimatedAmount === null ? null : BigInt(input.estimatedAmount);
        if (input.frequency !== undefined && input.frequency !== current.frequency) data.frequency = input.frequency;
        if (input.interval !== undefined && input.interval !== current.interval) data.interval = input.interval;
        if (anchor !== fromDbDate(current.anchorDate)) data.anchorDate = toDbDate(anchor);
        if (end !== (current.endDate ? fromDbDate(current.endDate) : null)) data.endDate = end ? toDbDate(end) : null;
        const before = recurringView(current, today);
        if (!Object.keys(data).length) return { result: { template: before, updatedPayments: 0, cancelled: 0, generated: 0 }, events: [] };
        const scheduleChanged = ["frequency", "interval", "anchorDate", "endDate"].some(key => key in data);
        const updated = await tx.recurringExpenseTemplate.update({ where: { id_ownerId: { id, ownerId } }, data: { ...data, version: { increment: 1 } }, include: templateInclude });
        let updatedPayments = 0, cancelled = 0, generated = 0;
        if (scheduleChanged) {
          // New rule: the future uncustomized occurrences are cancelled and the dates regenerate from tomorrow.
          cancelled = await cancelFuture(tx, ownerId, id, today, "Gasto fijo modificado", now, true);
          const fresh = await tx.recurringExpenseTemplate.update({ where: { id_ownerId: { id, ownerId } }, data: { generatedThrough: toDbDate(today) } });
          generated = await generate(tx, ownerId, fresh, today);
        } else {
          ({ count: updatedPayments } = await tx.scheduledExpensePayment.updateMany({
            where: { ownerId, templateId: id, status: "PENDING", dueDate: { gt: toDbDate(today) }, customizedAt: null },
            data: { description: updated.description, categoryId: updated.categoryId, categoryNameSnapshot: updated.category?.name ?? null, paymentMethod: updated.paymentMethod,
              paymentMethodNote: updated.paymentMethodNote, supplierName: updated.supplierName, plannedAmount: updated.estimatedAmount, version: { increment: 1 } } }));
        }
        const after = recurringView(await reloadTemplate(tx, ownerId, id), today);
        return { result: { template: after, updatedPayments, cancelled, generated }, events: [templateEvent(id, "UPDATED", after, before)] };
      });
    },
    /** Pause cancels the PENDING occurrences due after today; today's and overdue ones stay. */
    setRecurringState(ownerId: string, id: string, action: "pause" | "resume" | "end", input: { operationId: string; requestId: string; expectedVersion: number }) {
      return mutation(ownerId, input, `RECURRING_${action.toUpperCase()}`, id, async (tx, now) => {
        const today = bogotaToday(now);
        const current = await lockedTemplate(tx, ownerId, id);
        if (current.version !== input.expectedVersion) throw new ExpenseError("VERSION_CONFLICT");
        const allowed = action === "pause" ? current.status === "ACTIVE" : action === "resume" ? current.status === "PAUSED" : current.status !== "ENDED";
        if (!allowed) throw new ExpenseError("INVALID_RECURRING_TRANSITION");
        let cancelled = 0, generated = 0;
        if (action === "resume") {
          // Decision 5 (v1.2): the dates of the pause are not generated.
          const resumed = await tx.recurringExpenseTemplate.update({ where: { id_ownerId: { id, ownerId } }, data: { status: "ACTIVE", generatedThrough: toDbDate(addDays(today, -1)), version: { increment: 1 } } });
          generated = await generate(tx, ownerId, resumed, today);
        } else {
          cancelled = await cancelFuture(tx, ownerId, id, today, action === "pause" ? "Gasto fijo pausado" : "Gasto fijo terminado", now, false);
          await tx.recurringExpenseTemplate.update({ where: { id_ownerId: { id, ownerId } }, data: action === "pause" ? { status: "PAUSED", version: { increment: 1 } } : { status: "ENDED", endedAt: now, version: { increment: 1 } } });
        }
        const view = recurringView(await reloadTemplate(tx, ownerId, id), today);
        return { result: { template: view, cancelled, generated }, events: [templateEvent(id, action === "pause" ? "PAUSED" : action === "resume" ? "RESUMED" : "ENDED", { status: view.status, cancelled }, { status: current.status })] };
      });
    },

    async listScheduled(ownerId: string, query: ScheduledListQuery) {
      const today = bogotaToday(clock());
      const rows = await database.scheduledExpensePayment.findMany({
        where: { ownerId, ...(query.status === "all" ? {} : { status: query.status }), ...(query.kind === "fixed" ? { templateId: { not: null } } : query.kind === "single" ? { templateId: null } : {}),
          ...(query.from || query.to ? { dueDate: { ...(query.from ? { gte: toDbDate(query.from) } : {}), ...(query.to ? { lte: toDbDate(query.to) } : {}) } } : {}) },
        include: paymentInclude, orderBy: [{ dueDate: "asc" }, { id: "asc" }], take: LIST_LIMIT + 1 });
      return { items: rows.slice(0, LIST_LIMIT).map(row => scheduledView(row, today)), truncated: rows.length > LIST_LIMIT, today };
    },
    createScheduled(ownerId: string, input: CreateScheduledInput) {
      return mutation(ownerId, input, "SCHEDULED_CREATE", ownerId, async (tx, now) => {
        const today = bogotaToday(now);
        if (await tx.scheduledExpensePayment.count({ where: { ownerId, status: "PENDING", templateId: null } }) >= SINGLE_PENDING_QUOTA) throw new ExpenseError("SCHEDULED_EXPENSE_QUOTA");
        if (!allowedDueDate(input.dueDate, today)) throw new ExpenseError("INVALID_EXPENSE_INPUT");
        const category = await activeCategory(tx, ownerId, input.categoryId);
        const row = await tx.scheduledExpensePayment.create({ data: {
          ownerId, dueDate: toDbDate(input.dueDate), plannedAmount: input.plannedAmount ? BigInt(input.plannedAmount) : null, description: input.description, categoryId: category.id,
          categoryNameSnapshot: category.name, paymentMethod: input.paymentMethod, paymentMethodNote: input.paymentMethodNote ?? null, supplierName: input.supplierName ?? null }, include: paymentInclude });
        const view = scheduledView(row, today);
        return { result: { payment: view }, events: [paymentEvent(row.id, "CREATED", view)] };
      });
    },
    /** Edit or reschedule a PENDING payment; occurrences become customized (fixed-expense edits no longer touch them). */
    updateScheduled(ownerId: string, id: string, input: UpdateScheduledInput) {
      return mutation(ownerId, input, "SCHEDULED_UPDATE", id, async (tx, now) => {
        const today = bogotaToday(now);
        const current = await lockedPayment(tx, ownerId, id);
        if (current.status !== "PENDING") throw new ExpenseError("INVALID_SCHEDULED_TRANSITION");
        if (current.version !== input.expectedVersion) throw new ExpenseError("VERSION_CONFLICT");
        const method = input.paymentMethod ?? current.paymentMethod;
        const note = input.paymentMethodNote !== undefined ? input.paymentMethodNote : input.paymentMethod !== undefined && input.paymentMethod !== "OTHER" ? null : current.paymentMethodNote;
        if (!sameNoteRule(method, note)) throw new ExpenseError("INVALID_EXPENSE_INPUT");
        if (input.dueDate !== undefined && !allowedDueDate(input.dueDate, today)) throw new ExpenseError("INVALID_EXPENSE_INPUT");
        const data: Prisma.ScheduledExpensePaymentUncheckedUpdateInput = {};
        if (input.dueDate !== undefined && input.dueDate !== fromDbDate(current.dueDate)) data.dueDate = toDbDate(input.dueDate);
        if (input.plannedAmount !== undefined && (input.plannedAmount === null ? null : BigInt(input.plannedAmount)) !== current.plannedAmount) data.plannedAmount = input.plannedAmount === null ? null : BigInt(input.plannedAmount);
        if (input.description !== undefined && input.description !== current.description) data.description = input.description;
        if (input.categoryId !== undefined && input.categoryId !== current.categoryId) { const category = await activeCategory(tx, ownerId, input.categoryId); data.categoryId = category.id; data.categoryNameSnapshot = category.name; }
        if (method !== current.paymentMethod) data.paymentMethod = method;
        if (note !== current.paymentMethodNote) data.paymentMethodNote = note;
        if (input.supplierName !== undefined && input.supplierName !== current.supplierName) data.supplierName = input.supplierName;
        const before = scheduledView(current, today);
        if (!Object.keys(data).length) return { result: { payment: before }, events: [] };
        if (current.templateId) data.customizedAt = now;
        await tx.scheduledExpensePayment.update({ where: { id_ownerId: { id, ownerId } }, data: { ...data, version: { increment: 1 } } });
        const after = scheduledView(await reloadPayment(tx, ownerId, id), today);
        return { result: { payment: after }, events: [paymentEvent(id, "dueDate" in data ? "RESCHEDULED" : "EDITED", after, before)] };
      });
    },
    /** Mark paid (contract §7): creates the CONFIRMED expense with the real amount and payment date in the same transaction. */
    payScheduled(ownerId: string, id: string, input: PayScheduledInput) {
      return mutation(ownerId, input, "SCHEDULED_PAY", id, async (tx, now) => {
        const today = bogotaToday(now);
        const current = await lockedPayment(tx, ownerId, id);
        if (current.status !== "PENDING") throw new ExpenseError("INVALID_SCHEDULED_TRANSITION");
        if (current.version !== input.expectedVersion) throw new ExpenseError("VERSION_CONFLICT");
        const expense = await insertExpense(tx, ownerId, {
          expenseDate: input.expenseDate, amount: input.amount, categoryId: input.categoryId ?? current.categoryId, paymentMethod: input.paymentMethod,
          paymentMethodNote: input.paymentMethodNote ?? null, paymentReference: input.paymentReference ?? null, description: input.description ?? current.description,
          supplierName: input.supplierName !== undefined ? input.supplierName : current.supplierName,
        }, now, undefined, id);
        await tx.scheduledExpensePayment.update({ where: { id_ownerId: { id, ownerId } }, data: { status: "PAID", paidExpenseId: expense.id, paidAt: now, version: { increment: 1 } } });
        const payment = scheduledView(await reloadPayment(tx, ownerId, id), today);
        const created = expenseView(expense, true);
        return { result: { payment, expense: created }, events: [
          paymentEvent(id, "PAID", { expenseId: expense.id, amount: input.amount, expenseDate: input.expenseDate }, { status: "PENDING" }),
          { entityKind: "EXPENSE", entityId: expense.id, eventType: "CREATED", after: created },
        ] };
      });
    },
    /** Skip (occurrence) or cancel (one-off). Terminal. */
    cancelScheduled(ownerId: string, id: string, input: { operationId: string; requestId: string; expectedVersion: number; reason?: string }) {
      return mutation(ownerId, input, "SCHEDULED_CANCEL", id, async (tx, now) => {
        const today = bogotaToday(now);
        const current = await lockedPayment(tx, ownerId, id);
        if (current.status !== "PENDING") throw new ExpenseError("INVALID_SCHEDULED_TRANSITION");
        if (current.version !== input.expectedVersion) throw new ExpenseError("VERSION_CONFLICT");
        await tx.scheduledExpensePayment.update({ where: { id_ownerId: { id, ownerId } }, data: { status: "CANCELLED", cancelledAt: now, cancelReason: input.reason ?? null, version: { increment: 1 } } });
        const payment = scheduledView(await reloadPayment(tx, ownerId, id), today);
        return { result: { payment }, events: [paymentEvent(id, "CANCELLED", { status: "CANCELLED", reason: input.reason ?? null }, { status: "PENDING" })] };
      });
    },
  };
}
export type ScheduledExpenseRepository = ReturnType<typeof makeScheduledExpenseRepository>;
