import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../config/prisma";
import { bogotaToday, fromDbDate, toDbDate } from "../services/expense-dates";
import { projectedDates } from "../services/schedule-dates";

/**
 * GET /api/expenses/overview?month=YYYY-MM (docs/expenses-overview.md). Read-only aggregates for the Gastos page that
 * F1a's endpoints do not return: total per day, share per category and the previous month, all computed here.
 * - Only CONFIRMED expenses add up; VOIDED are counted apart and never add. Days are F1a's expenseDate (Bogotá dates).
 * - The current month runs up to today in Bogotá; past months are complete. Future months are rejected.
 * - percent = round(categoryTotal × 100 / monthTotal), half up, with BigInt; it may not add to exactly 100.
 * F1b (docs/expenses-f1b-contract.md §8): scheduled payments never add to total. scheduled.fixed counts the fixed-expense
 * occurrences due in the whole month (PENDING or PAID); upcoming (PENDING due today..today+7) and overdue (PENDING due before
 * today) relative to today whatever month is shown. variable = CONFIRMED expenses of the month without scheduledPaymentId.
 * Future months (up to MAX_FUTURE_MONTHS ahead): no expense can have a future date, so the figures are 0; scheduled.planned
 * adds the month's generated PENDING payments and the projected dates of ACTIVE fixed expenses not generated yet
 * (scheduled.projected), computed in memory and never stored: this read never writes nor syncs.
 */
const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
export const MAX_FUTURE_MONTHS = 12;
const pad = (n: number) => String(n).padStart(2, "0");
/** "YYYY-MM" plus `delta` months. */
export function shiftMonth(month: string, delta: number) {
  const [year, number] = month.split("-").map(Number) as [number, number], index = year * 12 + (number - 1) + delta;
  return `${Math.floor(index / 12)}-${pad(index % 12 + 1)}`;
}
export const expenseOverviewSchema = z.object({ month: z.string().regex(MONTH) }).strict()
  .refine(({ month }) => month >= "2000-01" && month <= shiftMonth(bogotaToday().slice(0, 7), MAX_FUTURE_MONTHS), { message: "MONTH_OUT_OF_RANGE" });

export function monthBounds(month: string, today: string) {
  const [year, number] = month.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(year, number, 0)).getUTCDate();
  const previous = number === 1 ? `${year - 1}-12` : `${year}-${pad(number - 1)}`;
  const end = `${month}-${pad(last)}`;
  const current = month === today.slice(0, 7), future = month > today.slice(0, 7);
  return { from: `${month}-01`, to: current ? today : end, previous, monthEnd: end, today, current, future };
}

const money = z.string().regex(/^(0|[1-9][0-9]*)$/);
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const rawSchema = z.object({
  total: money, count, voidedCount: count, previousTotal: money,
  days: z.array(z.object({ date: z.iso.date(), total: money }).strict()).max(31),
  byCategory: z.array(z.object({ categoryId: z.string(), name: z.string(), archived: z.boolean(), total: money, count }).strict()),
  fixedDue: count, fixedPaid: count, fixedPaidTotal: money, variableTotal: money, variableCount: count,
  upcomingCount: count, upcomingTotal: money, upcomingWithout: count, overdueCount: count, overdueTotal: money, overdueWithout: count,
  monthPendingCount: count, monthPendingTotal: money, monthPendingWithout: count,
}).strict();
/** A projected date of an ACTIVE fixed expense (future months only). Informative: it cannot be paid, skipped or edited. */
export type ProjectedPayment = { templateId: string; dueDate: string; description: string; plannedAmount: string | null; categoryId: string; categoryName: string | null;
  paymentMethod: string; frequency: "WEEKLY" | "MONTHLY" | "YEARLY"; interval: number };

export function percentOf(part: bigint, whole: bigint) {
  return whole === BigInt(0) ? "0" : ((part * BigInt(200) + whole) / (whole * BigInt(2))).toString();
}
export function presentOverview(raw: unknown, month: string, bounds: ReturnType<typeof monthBounds>, generatedAt: Date, projected: ProjectedPayment[] = []) {
  const data = rawSchema.parse(raw);
  const whole = BigInt(data.total);
  const projectedTotal = projected.reduce((sum, p) => sum + BigInt(p.plannedAmount ?? 0), BigInt(0));
  return {
    month, from: bounds.from, to: bounds.to, generatedAt: generatedAt.toISOString(), future: bounds.future,
    total: data.total, count: data.count, voidedCount: data.voidedCount,
    previousMonth: { month: bounds.previous, total: data.previousTotal },
    days: data.days,
    scheduled: {
      fixed: { due: data.fixedDue, paid: data.fixedPaid, paidTotal: data.fixedPaidTotal },
      upcoming: { count: data.upcomingCount, plannedTotal: data.upcomingTotal, withoutAmount: data.upcomingWithout },
      overdue: { count: data.overdueCount, plannedTotal: data.overdueTotal, withoutAmount: data.overdueWithout },
      planned: bounds.future ? { count: data.monthPendingCount + projected.length, plannedTotal: (BigInt(data.monthPendingTotal) + projectedTotal).toString(),
        withoutAmount: data.monthPendingWithout + projected.filter(p => p.plannedAmount === null).length, projectedCount: projected.length } : null,
      projected: bounds.future ? projected : [],
    },
    variable: { total: data.variableTotal, count: data.variableCount },
    byCategory: data.byCategory
      .map(c => ({ ...c, percent: percentOf(BigInt(c.total), whole) }))
      .sort((a, b) => BigInt(b.total) > BigInt(a.total) ? 1 : BigInt(b.total) < BigInt(a.total) ? -1 : a.name.localeCompare(b.name, "es")),
  };
}

export function expenseOverviewSql(ownerId: string, bounds: ReturnType<typeof monthBounds>) {
  return Prisma.sql`
    WITH b AS (SELECT ${bounds.from}::date AS start, ${bounds.to}::date AS finish, (${bounds.from}::date - interval '1 month')::date AS previous_start,
      ${bounds.monthEnd}::date AS month_end, ${bounds.today}::date AS today),
    pending AS (
      SELECT s."dueDate" AS due, s."plannedAmount"::numeric AS planned FROM scheduled_expense_payments s
      WHERE s."ownerId" = ${ownerId} AND s.status = 'PENDING'
    ), fixed AS (
      SELECT s.status::text AS status, e.amount::numeric AS paid FROM scheduled_expense_payments s CROSS JOIN b
        LEFT JOIN expenses e ON e.id = s."paidExpenseId" AND e."ownerId" = s."ownerId"
      WHERE s."ownerId" = ${ownerId} AND s."templateId" IS NOT NULL AND s.status IN ('PENDING', 'PAID') AND s."dueDate" >= b.start AND s."dueDate" <= b.month_end
    ),
    rows AS (
      SELECT e."expenseDate" AS day, e."categoryId", e.amount::numeric AS amount, e.status::text AS status
      FROM expenses e CROSS JOIN b
      WHERE e."ownerId" = ${ownerId} AND e.status IN ('CONFIRMED', 'VOIDED') AND e."expenseDate" >= b.previous_start AND e."expenseDate" <= b.finish
    ), current AS (SELECT r.* FROM rows r CROSS JOIN b WHERE r.day >= b.start)
    SELECT jsonb_build_object(
      'total', (SELECT coalesce(sum(amount) FILTER (WHERE status = 'CONFIRMED'), 0)::text FROM current),
      'fixedDue', (SELECT count(*) FROM fixed), 'fixedPaid', (SELECT count(*) FILTER (WHERE status = 'PAID') FROM fixed),
      'fixedPaidTotal', (SELECT coalesce(sum(paid) FILTER (WHERE status = 'PAID'), 0)::text FROM fixed),
      'variableTotal', (SELECT coalesce(sum(e.amount::numeric), 0)::text FROM expenses e CROSS JOIN b WHERE e."ownerId" = ${ownerId} AND e.status = 'CONFIRMED'
        AND e."scheduledPaymentId" IS NULL AND e."expenseDate" >= b.start AND e."expenseDate" <= b.finish),
      'variableCount', (SELECT count(*) FROM expenses e CROSS JOIN b WHERE e."ownerId" = ${ownerId} AND e.status = 'CONFIRMED'
        AND e."scheduledPaymentId" IS NULL AND e."expenseDate" >= b.start AND e."expenseDate" <= b.finish),
      'upcomingCount', (SELECT count(*) FROM pending CROSS JOIN b WHERE due >= b.today AND due <= b.today + 7),
      'upcomingTotal', (SELECT coalesce(sum(planned), 0)::text FROM pending CROSS JOIN b WHERE due >= b.today AND due <= b.today + 7),
      'upcomingWithout', (SELECT count(*) FROM pending CROSS JOIN b WHERE due >= b.today AND due <= b.today + 7 AND planned IS NULL),
      'overdueCount', (SELECT count(*) FROM pending CROSS JOIN b WHERE due < b.today),
      'overdueTotal', (SELECT coalesce(sum(planned), 0)::text FROM pending CROSS JOIN b WHERE due < b.today),
      'overdueWithout', (SELECT count(*) FROM pending CROSS JOIN b WHERE due < b.today AND planned IS NULL),
      'monthPendingCount', (SELECT count(*) FROM pending CROSS JOIN b WHERE due >= b.start AND due <= b.month_end),
      'monthPendingTotal', (SELECT coalesce(sum(planned), 0)::text FROM pending CROSS JOIN b WHERE due >= b.start AND due <= b.month_end),
      'monthPendingWithout', (SELECT count(*) FROM pending CROSS JOIN b WHERE due >= b.start AND due <= b.month_end AND planned IS NULL),
      'count', (SELECT count(*) FILTER (WHERE status = 'CONFIRMED') FROM current),
      'voidedCount', (SELECT count(*) FILTER (WHERE status = 'VOIDED') FROM current),
      'previousTotal', (SELECT coalesce(sum(r.amount) FILTER (WHERE r.status = 'CONFIRMED'), 0)::text FROM rows r CROSS JOIN b WHERE r.day < b.start),
      'days', (SELECT jsonb_agg(jsonb_build_object('date', d.day::date::text, 'total', coalesce(t.total, 0)::text) ORDER BY d.day)
        FROM b CROSS JOIN generate_series(b.start, b.finish, interval '1 day') AS d(day)
        LEFT JOIN (SELECT day, sum(amount) AS total FROM current WHERE status = 'CONFIRMED' GROUP BY day) t ON t.day = d.day::date),
      'byCategory', (SELECT coalesce(jsonb_agg(jsonb_build_object('categoryId', c.id, 'name', c.name, 'archived', c."archivedAt" IS NOT NULL, 'total', t.total::text, 'count', t.n)), '[]'::jsonb)
        FROM (SELECT "categoryId", sum(amount) AS total, count(*) AS n FROM current WHERE status = 'CONFIRMED' GROUP BY "categoryId") t
        JOIN expense_categories c ON c.id = t."categoryId" AND c."ownerId" = ${ownerId})
    ) AS data`;
}

type Database = Pick<PrismaClient, "$transaction">;
type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];
/**
 * Future months: dates of the owner's ACTIVE fixed expenses inside the month that a later sync would generate, minus the
 * occurrences that already exist (not cancelled), as the partial unique index would. Paused and ended ones are not projected.
 */
export async function projectMonth(tx: Pick<Tx, "recurringExpenseTemplate" | "scheduledExpensePayment">, ownerId: string, bounds: ReturnType<typeof monthBounds>): Promise<ProjectedPayment[]> {
  const templates = await tx.recurringExpenseTemplate.findMany({ where: { ownerId, status: "ACTIVE" }, include: { category: { select: { name: true } } }, orderBy: { id: "asc" } });
  if (!templates.length) return [];
  const existing = await tx.scheduledExpensePayment.findMany({ where: { ownerId, templateId: { in: templates.map(t => t.id) }, status: { not: "CANCELLED" },
    occurrenceDate: { gte: toDbDate(bounds.from), lte: toDbDate(bounds.monthEnd) } }, select: { templateId: true, occurrenceDate: true } });
  const taken = new Set(existing.map(e => `${e.templateId}:${e.occurrenceDate ? fromDbDate(e.occurrenceDate) : ""}`));
  return templates.flatMap(t => projectedDates({ frequency: t.frequency, interval: t.interval, anchorDate: fromDbDate(t.anchorDate), endDate: t.endDate ? fromDbDate(t.endDate) : null },
    t.generatedThrough ? fromDbDate(t.generatedThrough) : null, bounds.today, bounds.from, bounds.monthEnd)
    .filter(date => !taken.has(`${t.id}:${date}`))
    .map(dueDate => ({ templateId: t.id, dueDate, description: t.description, plannedAmount: t.estimatedAmount?.toString() ?? null, categoryId: t.categoryId,
      categoryName: t.category?.name ?? null, paymentMethod: t.paymentMethod, frequency: t.frequency, interval: t.interval })))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.description.localeCompare(b.description, "es") || a.templateId.localeCompare(b.templateId));
}

/** One read-only snapshot: clock, one aggregate query and, for a future month, the in-memory projection. Owner from the session. */
export async function readExpenseOverview(ownerId: string, month: string, database: Database = prisma) {
  return database.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const [clock] = await tx.$queryRaw<{ now: Date }[]>`SELECT CURRENT_TIMESTAMP AS now`;
    if (!clock) throw new Error("EXPENSE_OVERVIEW_UNAVAILABLE");
    const bounds = monthBounds(month, bogotaToday(clock.now));
    const [row] = await tx.$queryRaw<{ data: unknown }[]>(expenseOverviewSql(ownerId, bounds));
    if (!row) throw new Error("EXPENSE_OVERVIEW_UNAVAILABLE");
    const projected = bounds.future ? await projectMonth(tx, ownerId, bounds) : [];
    return presentOverview(row.data, month, bounds, clock.now, projected);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 2000, timeout: 5000 });
}
