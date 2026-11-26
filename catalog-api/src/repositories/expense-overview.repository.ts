import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../config/prisma";
import { bogotaToday } from "../services/expense-dates";

/**
 * GET /api/expenses/overview?month=YYYY-MM (docs/expenses-overview.md). Read-only aggregates for the Gastos page that
 * F1a's endpoints do not return: total per day, share per category and the previous month, all computed here.
 * - Only CONFIRMED expenses add up; VOIDED are counted apart and never add. Days are F1a's expenseDate (Bogotá dates).
 * - The current month runs up to today in Bogotá; past months are complete. Future months are rejected.
 * - percent = round(categoryTotal × 100 / monthTotal), half up, with BigInt; it may not add to exactly 100.
 */
const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
export const expenseOverviewSchema = z.object({ month: z.string().regex(MONTH) }).strict()
  .refine(({ month }) => month >= "2000-01" && month <= bogotaToday().slice(0, 7), { message: "MONTH_OUT_OF_RANGE" });

const pad = (n: number) => String(n).padStart(2, "0");
export function monthBounds(month: string, today: string) {
  const [year, number] = month.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(year, number, 0)).getUTCDate();
  const previous = number === 1 ? `${year - 1}-12` : `${year}-${pad(number - 1)}`;
  const end = `${month}-${pad(last)}`;
  return { from: `${month}-01`, to: month === today.slice(0, 7) ? today : end, previous };
}

const money = z.string().regex(/^(0|[1-9][0-9]*)$/);
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const rawSchema = z.object({
  total: money, count, voidedCount: count, previousTotal: money,
  days: z.array(z.object({ date: z.iso.date(), total: money }).strict()).max(31),
  byCategory: z.array(z.object({ categoryId: z.string(), name: z.string(), archived: z.boolean(), total: money, count }).strict()),
}).strict();

export function percentOf(part: bigint, whole: bigint) {
  return whole === BigInt(0) ? "0" : ((part * BigInt(200) + whole) / (whole * BigInt(2))).toString();
}
export function presentOverview(raw: unknown, month: string, bounds: ReturnType<typeof monthBounds>, generatedAt: Date) {
  const data = rawSchema.parse(raw);
  const whole = BigInt(data.total);
  return {
    month, from: bounds.from, to: bounds.to, generatedAt: generatedAt.toISOString(),
    total: data.total, count: data.count, voidedCount: data.voidedCount,
    previousMonth: { month: bounds.previous, total: data.previousTotal },
    days: data.days,
    byCategory: data.byCategory
      .map(c => ({ ...c, percent: percentOf(BigInt(c.total), whole) }))
      .sort((a, b) => BigInt(b.total) > BigInt(a.total) ? 1 : BigInt(b.total) < BigInt(a.total) ? -1 : a.name.localeCompare(b.name, "es")),
  };
}

export function expenseOverviewSql(ownerId: string, bounds: ReturnType<typeof monthBounds>) {
  return Prisma.sql`
    WITH b AS (SELECT ${bounds.from}::date AS start, ${bounds.to}::date AS finish, (${bounds.from}::date - interval '1 month')::date AS previous_start),
    rows AS (
      SELECT e."expenseDate" AS day, e."categoryId", e.amount::numeric AS amount, e.status::text AS status
      FROM expenses e CROSS JOIN b
      WHERE e."ownerId" = ${ownerId} AND e.status IN ('CONFIRMED', 'VOIDED') AND e."expenseDate" >= b.previous_start AND e."expenseDate" <= b.finish
    ), current AS (SELECT r.* FROM rows r CROSS JOIN b WHERE r.day >= b.start)
    SELECT jsonb_build_object(
      'total', (SELECT coalesce(sum(amount) FILTER (WHERE status = 'CONFIRMED'), 0)::text FROM current),
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
/** One read-only snapshot: clock + one aggregate query. The owner always comes from the session. */
export async function readExpenseOverview(ownerId: string, month: string, database: Database = prisma) {
  return database.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const [clock] = await tx.$queryRaw<{ now: Date }[]>`SELECT CURRENT_TIMESTAMP AS now`;
    if (!clock) throw new Error("EXPENSE_OVERVIEW_UNAVAILABLE");
    const bounds = monthBounds(month, bogotaToday(clock.now));
    const [row] = await tx.$queryRaw<{ data: unknown }[]>(expenseOverviewSql(ownerId, bounds));
    if (!row) throw new Error("EXPENSE_OVERVIEW_UNAVAILABLE");
    return presentOverview(row.data, month, bounds, clock.now);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 2000, timeout: 5000 });
}
