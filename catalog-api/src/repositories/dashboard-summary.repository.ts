import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "../config/prisma";
import { DASHBOARD_MODULES, presentSummary, type DashboardDays } from "../services/dashboard-summary";

// Definitions: src/services/dashboard-summary.ts. DateTime columns are timestamp(3) holding UTC wall time, so the
// Bogotá day of an instant is (column AT TIME ZONE 'UTC' AT TIME ZONE 'America/Bogota')::date, and day bounds are
// converted back to UTC wall time so the raw columns can be compared (and indexed) directly.
// Money is aggregated as numeric and returned as text: jsonb numbers would lose precision in JSON.parse.
export function dashboardSummarySql(ownerId: string, asOf: Date, days: DashboardDays) {
  return Prisma.sql`
    WITH bounds AS (
      SELECT d.today, d.today - 1 AS yesterday, d.today - (${days}::int - 1) AS series_start,
        date_trunc('month', d.today)::date AS month_start,
        (date_trunc('month', d.today) - interval '1 month')::date AS previous_start
      FROM (SELECT (${asOf}::timestamptz AT TIME ZONE 'America/Bogota')::date AS today) d
    ), win AS (
      SELECT b.*,
        (least(b.series_start, b.previous_start, b.yesterday)::timestamp AT TIME ZONE 'America/Bogota') AT TIME ZONE 'UTC' AS from_utc,
        ((b.today + 1)::timestamp AT TIME ZONE 'America/Bogota') AT TIME ZONE 'UTC' AS until_utc
      FROM bounds b
    ), sales AS (
      SELECT s.id, s.total::numeric AS amount, (s."confirmedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Bogota')::date AS day
      FROM "Sale" s CROSS JOIN win w
      WHERE s."userId" = ${ownerId} AND s.status IN ('CONFIRMED', 'DELIVERED', 'RETURNED')
        AND s."confirmedAt" >= w.from_utc AND s."confirmedAt" < w.until_utc
    ), sale_costs AS (
      SELECT l."saleId" AS id, coalesce(sum(l."unitCost"::numeric * l.quantity), 0) AS cost, bool_or(l."unitCost" IS NULL) AS missing
      FROM "SaleLine" l JOIN sales s ON s.id = l."saleId"
      GROUP BY l."saleId"
    ), returned AS (
      SELECT (r."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Bogota')::date AS day,
        sum((l."unitPrice" - l."unitDiscount")::numeric * rl."receivedQuantity") AS amount,
        sum(coalesce(l."unitCost", 0)::numeric * rl."resellableQuantity") AS cost
      FROM "SaleReturn" r
        JOIN "SaleReturnLine" rl ON rl."returnId" = r.id
        JOIN "SaleLine" l ON l.id = rl."saleLineId"
        JOIN "Sale" s ON s.id = l."saleId" AND s."userId" = ${ownerId}
        CROSS JOIN win w
      WHERE r."userId" = ${ownerId} AND s.status IN ('DELIVERED', 'RETURNED')
        AND r."createdAt" >= w.from_utc AND r."createdAt" < w.until_utc
      GROUP BY 1
    ), daily AS (
      SELECT e.day, sum(e.sales) AS sales, sum(e.returns) AS returns, sum(e.cost) AS cost, sum(e.cost_back) AS cost_back,
        sum(e.n) AS n, sum(e.missing) AS missing
      FROM (
        SELECT s.day, s.amount AS sales, 0::numeric AS returns, coalesce(c.cost, 0) AS cost, 0::numeric AS cost_back, 1 AS n,
          CASE WHEN c.missing THEN 1 ELSE 0 END AS missing
        FROM sales s LEFT JOIN sale_costs c ON c.id = s.id
        UNION ALL
        SELECT r.day, 0, r.amount, 0, r.cost, 0, 0 FROM returned r
      ) e
      GROUP BY e.day
    ), periods AS (
      SELECT
        coalesce(sum(d.sales - d.returns) FILTER (WHERE d.day = b.today), 0) AS today_sales,
        coalesce(sum(d.n) FILTER (WHERE d.day = b.today), 0) AS today_count,
        coalesce(sum(d.sales - d.returns) FILTER (WHERE d.day = b.yesterday), 0) AS yesterday_sales,
        coalesce(sum(d.sales - d.returns) FILTER (WHERE d.day >= b.month_start AND d.day <= b.today), 0) AS month_sales,
        coalesce(sum(d.cost - d.cost_back) FILTER (WHERE d.day >= b.month_start AND d.day <= b.today), 0) AS month_cost,
        coalesce(sum(d.missing) FILTER (WHERE d.day >= b.month_start AND d.day <= b.today), 0) AS month_missing,
        coalesce(sum(d.sales - d.returns) FILTER (WHERE d.day >= b.previous_start AND d.day < b.month_start), 0) AS previous_sales,
        coalesce(sum(d.cost - d.cost_back) FILTER (WHERE d.day >= b.previous_start AND d.day < b.month_start), 0) AS previous_cost
      FROM bounds b LEFT JOIN daily d ON true
    ), stock AS (
      SELECT count(*) FILTER (WHERE i."minimumStock" > 0 AND i.stock > 0 AND i.stock <= i."minimumStock") AS low,
        count(*) FILTER (WHERE i.stock = 0) AS out, count(*) AS total
      FROM inventory_items i WHERE i."userId" = ${ownerId}
    ), recent AS (
      SELECT s.id, s.status::text AS status, s.total::text AS total,
        to_char(s."confirmedAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at,
        coalesce(s."customerNameSnapshot", s."customerName") AS customer_name
      FROM "Sale" s
      WHERE s."userId" = ${ownerId} AND s.status IN ('CONFIRMED', 'DELIVERED', 'CANCELLED', 'RETURNED') AND s."confirmedAt" IS NOT NULL
      ORDER BY s."confirmedAt" DESC, s.id DESC
      LIMIT 5
    )
    SELECT jsonb_build_object(
      'today', (SELECT today::text FROM bounds),
      'todaySales', p.today_sales::text, 'todayCount', p.today_count, 'yesterdaySales', p.yesterday_sales::text,
      'month', jsonb_build_object('sales', p.month_sales::text, 'cost', p.month_cost::text, 'withoutCost', p.month_missing),
      'previousMonth', jsonb_build_object('sales', p.previous_sales::text, 'cost', p.previous_cost::text),
      'series', (SELECT coalesce(jsonb_agg(jsonb_build_object('date', d.day::text, 'total', (d.sales - d.returns)::text) ORDER BY d.day), '[]'::jsonb)
        FROM daily d CROSS JOIN bounds b WHERE d.day >= b.series_start AND d.day <= b.today),
      'attention', (SELECT jsonb_build_object('low', st.low, 'out', st.out, 'pending', (
        SELECT count(*) FROM orders o JOIN catalogs c ON c.id = o."catalogId"
        WHERE c."userId" = ${ownerId} AND o.status = 'PENDING' AND o."anonymizedAt" IS NULL)) FROM stock st),
      'recent', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'status', r.status, 'total', r.total, 'at', r.at, 'customerName', r.customer_name)
        ORDER BY r.at DESC, r.id DESC), '[]'::jsonb) FROM recent r),
      'setup', jsonb_build_object(
        'hasInventoryItems', (SELECT total > 0 FROM stock),
        'hasPublishedCatalog', EXISTS (SELECT 1 FROM catalogs c WHERE c."userId" = ${ownerId} AND c.active AND c."archivedAt" IS NULL
          AND EXISTS (SELECT 1 FROM products pr WHERE pr."catalogId" = c.id AND pr.active)),
        -- IN (not <> 'DRAFT') so the ("userId", status, "createdAt") index applies even for accounts without sales.
        'hasSales', EXISTS (SELECT 1 FROM "Sale" s WHERE s."userId" = ${ownerId} AND s.status IN ('CONFIRMED', 'DELIVERED', 'CANCELLED', 'RETURNED')))
    ) AS data
    FROM periods p`;
}

/** F1a expenses (table "expenses"): CONFIRMED only, by the Bogotá calendar date stored in "expenseDate". */
export function dashboardExpensesSql(ownerId: string, asOf: Date) {
  return Prisma.sql`
    WITH b AS (
      SELECT d.today, date_trunc('month', d.today)::date AS month_start, (date_trunc('month', d.today) - interval '1 month')::date AS previous_start
      FROM (SELECT (${asOf}::timestamptz AT TIME ZONE 'America/Bogota')::date AS today) d
    )
    SELECT jsonb_build_object(
      'month', coalesce(sum(e.amount::numeric) FILTER (WHERE e."expenseDate" >= b.month_start AND e."expenseDate" <= b.today), 0)::text,
      'previousMonth', coalesce(sum(e.amount::numeric) FILTER (WHERE e."expenseDate" >= b.previous_start AND e."expenseDate" < b.month_start), 0)::text
    ) AS data
    FROM b LEFT JOIN expenses e ON e."ownerId" = ${ownerId} AND e.status = 'CONFIRMED'
      AND e."expenseDate" >= b.previous_start AND e."expenseDate" <= b.today`;
}

type Database = Pick<PrismaClient, "$transaction">;
/**
 * Fixed number of statements per request: SET TRANSACTION, statement_timeout, clock, summary and, only with the
 * expenses module, one more. Read-only snapshot so every figure comes from the same instant.
 */
export async function readDashboardSummary(ownerId: string, days: DashboardDays, { database = prisma as Database, expenses = DASHBOARD_MODULES.expenses } = {}) {
  return database.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    await tx.$executeRaw`SET LOCAL statement_timeout = '3000ms'`;
    const [clock] = await tx.$queryRaw<{ asOf: Date }[]>`SELECT CURRENT_TIMESTAMP AS "asOf"`;
    if (!clock) throw new Error("DASHBOARD_UNAVAILABLE");
    const [summary] = await tx.$queryRaw<{ data: unknown }[]>(dashboardSummarySql(ownerId, clock.asOf, days));
    if (!summary) throw new Error("DASHBOARD_UNAVAILABLE");
    let expenseData: unknown | null = null;
    if (expenses) {
      const [row] = await tx.$queryRaw<{ data: unknown }[]>(dashboardExpensesSql(ownerId, clock.asOf));
      if (!row) throw new Error("DASHBOARD_UNAVAILABLE");
      expenseData = row.data;
    }
    return presentSummary(summary.data, expenseData, clock.asOf, days);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 2000, timeout: 5000 });
}
