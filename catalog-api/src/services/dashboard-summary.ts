import { z } from "zod";

/**
 * Inicio summary (GET /api/dashboard/summary). Definitions, also in docs/dashboard-summary.md:
 *
 * - Day: calendar day in America/Bogota. Instants are stored as UTC.
 * - Sales of a day = Σ "Sale".total of sales with a confirmation (status CONFIRMED, DELIVERED or RETURNED,
 *   i.e. including those later returned) whose confirmedAt falls on that day, minus the value of the returns
 *   registered that day. CANCELLED sales never count (not even on their confirmation day). DRAFT never counts.
 * - Value of a return = Σ (unitPrice − unitDiscount) × receivedQuantity of its lines, from the sale line
 *   snapshot. Exact: a CHECK guarantees lineTotal = (unitPrice − unitDiscount) × quantity. No refund is recorded
 *   (contract: no payments), so this is the sale value given back, not money paid out.
 * - costOfSales of a period = Σ unitCost × quantity of the lines of the sales confirmed in the period
 *   − Σ unitCost × resellableQuantity of the returns registered in the period (resellable units go back to
 *   stock; damaged units keep their cost as a loss). Lines without unitCost add no cost; each sale with at least
 *   one such line counts once in salesWithoutCostCount.
 * - expensesTotal: CONFIRMED expenses of the period (F1a), by expenseDate (a Bogotá calendar date); VOIDED never count.
 * - estimatedProfit = salesTotal − costOfSales − (expensesTotal ?? 0). It can be negative.
 * - Month = from the 1st of the current Bogotá month to today (inclusive); previous month = the whole previous
 *   calendar month.
 * - lowStockCount: items with minimumStock > 0 and 0 < stock ≤ minimumStock. outOfStockCount: stock = 0.
 * - pendingOrdersCount: PENDING orders, not anonymized, of any catalog of the owner.
 * - scheduledDueSoonCount / scheduledOverdueCount (F1b): PENDING scheduled payments due between today and today + 7, and
 *   before today. Scheduled payments never add to sales, costs, expenses or profit; this read never generates them.
 * - recent: the 5 latest sales with a confirmation (any status but DRAFT), by confirmedAt.
 * Money is always a decimal string computed with BigInt; it is never converted to Number.
 */

/** Modules available in this build. expenses: F1a (migration 20261125000000_operating_expenses and /api/expenses). */
export const DASHBOARD_MODULES: Readonly<{ expenses: boolean }> = { expenses: true };
/** F1b scheduled payments (migration 20261126000000_scheduled_expense_payments): attention counts are read from it. */
export const SCHEDULED_EXPENSES_MODULE = true;

export const DASHBOARD_DAYS = [7, 30, 90] as const;
export type DashboardDays = (typeof DASHBOARD_DAYS)[number];
export class DashboardQueryError extends Error { constructor() { super("INVALID_DASHBOARD_QUERY"); } }

// Express parses repeated parameters as arrays and nested ones as objects: both fail the string enum.
export const dashboardQuerySchema = z.object({ days: z.enum(["7", "30", "90"]).optional() }).strict();
export function parseDashboardQuery(query: unknown): { days: DashboardDays } {
  const parsed = dashboardQuerySchema.safeParse(query);
  if (!parsed.success) throw new DashboardQueryError();
  return { days: Number(parsed.data.days ?? "7") as DashboardDays };
}

const money = z.string().regex(/^-?(0|[1-9][0-9]*)$/);
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const isoDay = z.iso.date();
export const rawSummarySchema = z.object({
  today: isoDay,
  todaySales: money, todayCount: count, yesterdaySales: money,
  month: z.object({ sales: money, cost: money, withoutCost: count }).strict(),
  previousMonth: z.object({ sales: money, cost: money }).strict(),
  series: z.array(z.object({ date: isoDay, total: money }).strict()).max(90),
  attention: z.object({ low: count, out: count, pending: count, dueSoon: count, overdue: count }).strict(),
  recent: z.array(z.object({ id: z.string(), status: z.enum(["CONFIRMED", "DELIVERED", "CANCELLED", "RETURNED"]), total: money, at: z.iso.datetime(), customerName: z.string().nullable() }).strict()).max(5),
  setup: z.object({ hasInventoryItems: z.boolean(), hasPublishedCatalog: z.boolean(), hasSales: z.boolean() }).strict(),
}).strict();
export const rawExpensesSchema = z.object({ month: money, previousMonth: money }).strict();
export type RawSummary = z.infer<typeof rawSummarySchema>;
export type RawExpenses = z.infer<typeof rawExpensesSchema>;

const profit = (sales: string, cost: string, expenses: string | null) => (BigInt(sales) - BigInt(cost) - BigInt(expenses ?? "0")).toString();

/** Every day of the range, oldest first, with zero on days without activity. */
export function fillSeries(today: string, days: DashboardDays, points: { date: string; total: string }[]) {
  const byDay = new Map(points.map(point => [point.date, point.total]));
  if (byDay.size !== points.length) throw new Error("DUPLICATE_DASHBOARD_DAY");
  const series = Array.from({ length: days }, (_, index) => {
    const day = new Date(`${today}T00:00:00Z`); day.setUTCDate(day.getUTCDate() - (days - 1) + index);
    const date = day.toISOString().slice(0, 10);
    return { date, total: byDay.get(date) ?? "0" };
  });
  if (points.some(point => !series.some(entry => entry.date === point.date))) throw new Error("OUT_OF_RANGE_DASHBOARD_DAY");
  return series;
}

export function presentSummary(rawData: unknown, rawExpenses: unknown | null, generatedAt: Date, days: DashboardDays) {
  const raw = rawSummarySchema.parse(rawData);
  const expenses = rawExpenses === null ? null : rawExpensesSchema.parse(rawExpenses);
  return {
    success: true as const,
    generatedAt: generatedAt.toISOString(),
    today: { date: raw.today, salesTotal: raw.todaySales, salesCount: raw.todayCount, yesterdaySalesTotal: raw.yesterdaySales },
    month: {
      salesTotal: raw.month.sales, costOfSales: raw.month.cost, salesWithoutCostCount: raw.month.withoutCost,
      expensesTotal: expenses?.month ?? null,
      estimatedProfit: profit(raw.month.sales, raw.month.cost, expenses?.month ?? null),
      previousMonth: { salesTotal: raw.previousMonth.sales, expensesTotal: expenses?.previousMonth ?? null, estimatedProfit: profit(raw.previousMonth.sales, raw.previousMonth.cost, expenses?.previousMonth ?? null) },
    },
    attention: { lowStockCount: raw.attention.low, outOfStockCount: raw.attention.out, pendingOrdersCount: raw.attention.pending,
      scheduledDueSoonCount: raw.attention.dueSoon, scheduledOverdueCount: raw.attention.overdue },
    salesSeries: fillSeries(raw.today, days, raw.series),
    recent: raw.recent.map(sale => ({ kind: "SALE" as const, ...sale })),
    setup: raw.setup,
    modules: { expenses: expenses !== null, scheduledExpenses: SCHEDULED_EXPENSES_MODULE },
  };
}
export type DashboardSummary = ReturnType<typeof presentSummary>;
