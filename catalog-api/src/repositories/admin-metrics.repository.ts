import { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma";
import { presentMetrics } from "../services/admin-metrics";

export function adminMetricsSql(asOf: Date) {
  return Prisma.sql`
    WITH bounds AS (
      SELECT ${asOf}::timestamptz AT TIME ZONE 'UTC' AS cut,
        date_trunc('day', ${asOf}::timestamptz AT TIME ZONE 'America/Bogota') AS today
    ), limits AS (
      SELECT *, (today - interval '6 days') AT TIME ZONE 'America/Bogota' AT TIME ZONE 'UTC' AS start7,
        (today - interval '29 days') AT TIME ZONE 'America/Bogota' AT TIME ZONE 'UTC' AS start30 FROM bounds
    ), accounts AS (
      SELECT count(*) AS total,
        count(*) FILTER (WHERE u."createdAt" >= b.start7 AND u."createdAt" <= b.cut) AS d7,
        count(*) FILTER (WHERE u."createdAt" >= b.start30 AND u."createdAt" <= b.cut) AS d30,
        count(*) FILTER (WHERE u."emailVerifiedAt" IS NULL) AS unverified,
        count(*) FILTER (WHERE EXISTS (SELECT 1 FROM catalogs c JOIN products p ON p."catalogId" = c.id WHERE c."userId" = u.id)) AS active
      FROM users u CROSS JOIN limits b
    ), catalogs_now AS (
      SELECT count(*) AS published,
        count(*) FILTER (WHERE c."createdAt" >= b.start7 AND c."createdAt" <= b.cut) AS d7,
        count(*) FILTER (WHERE c."createdAt" >= b.start30 AND c."createdAt" <= b.cut) AS d30
      FROM catalogs c CROSS JOIN limits b WHERE c.active AND c."archivedAt" IS NULL
        AND EXISTS (SELECT 1 FROM products p WHERE p."catalogId" = c.id AND p.active)
    ), orders_count AS (
      SELECT count(*) AS total,
        count(*) FILTER (WHERE o."createdAt" >= b.start7 AND o."createdAt" <= b.cut) AS d7,
        count(*) FILTER (WHERE o."createdAt" >= b.start30 AND o."createdAt" <= b.cut) AS d30
      FROM orders o CROSS JOIN limits b
    ), order_accounts AS (
      SELECT c."userId", min(o."createdAt") AS first_order, max(o."createdAt") AS last_order
      FROM orders o JOIN catalogs c ON c.id = o."catalogId" GROUP BY c."userId"
    ), repeats AS (
      SELECT count(*) AS with_orders, count(*) FILTER (WHERE
        date_trunc('week', first_order AT TIME ZONE 'UTC' AT TIME ZONE 'America/Bogota') <>
        date_trunc('week', last_order AT TIME ZONE 'UTC' AT TIME ZONE 'America/Bogota')) AS repeating FROM order_accounts
    ), cohorts AS (
      SELECT label, jsonb_build_object('initiated', count(o.id),
        'pending', count(o.id) FILTER (WHERE o.status = 'PENDING'),
        'confirmedCurrent', count(o.id) FILTER (WHERE o.status IN ('CONFIRMED', 'COMPLETED')),
        'confirmedKnown', count(o.id) FILTER (WHERE (o."firstConfirmedAt" IS NOT NULL AND o."firstConfirmedAt" <= b.cut)
          OR (o."firstConfirmedAt" IS NULL AND o.status IN ('CONFIRMED', 'COMPLETED'))),
        'confirmedDated', count(o.id) FILTER (WHERE o."firstConfirmedAt" IS NOT NULL AND o."firstConfirmedAt" <= b.cut),
        'legacyCancelledUnknown', count(o.id) FILTER (WHERE o.status = 'CANCELLED' AND o."firstConfirmedAt" IS NULL)) AS data
      FROM limits b CROSS JOIN (VALUES ('allTime'), ('last7Days'), ('last30Days')) AS periods(label)
      LEFT JOIN orders o ON o."createdAt" <= b.cut AND
        (label = 'allTime' OR (label = 'last7Days' AND o."createdAt" >= b.start7) OR (label = 'last30Days' AND o."createdAt" >= b.start30))
      GROUP BY label
    ), daily_accounts AS (
      SELECT (u."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Bogota')::date AS day, count(*) AS n
      FROM users u CROSS JOIN limits b WHERE u."createdAt" >= b.start30 AND u."createdAt" <= b.cut GROUP BY 1
    ), daily_orders AS (
      SELECT (o."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Bogota')::date AS day, count(*) AS n
      FROM orders o CROSS JOIN limits b WHERE o."createdAt" >= b.start30 AND o."createdAt" <= b.cut GROUP BY 1
    )
    SELECT jsonb_build_object(
      'accounts', (SELECT jsonb_build_object('total', total, 'last7Days', d7, 'last30Days', d30, 'active', active, 'unverified', unverified) FROM accounts),
      'catalogs', (SELECT jsonb_build_object('published', published, 'last7Days', d7, 'last30Days', d30) FROM catalogs_now),
      'orders', (SELECT jsonb_build_object('total', total, 'last7Days', d7, 'last30Days', d30) FROM orders_count),
      'repeat', (SELECT jsonb_build_object('withOrders', with_orders, 'repeating', repeating) FROM repeats),
      'funnel', (SELECT jsonb_object_agg(label, data) FROM cohorts),
      'daily', (SELECT coalesce(jsonb_agg(jsonb_build_object('date', coalesce(a.day, o.day), 'accountsCreated', coalesce(a.n, 0), 'ordersCreated', coalesce(o.n, 0)) ORDER BY coalesce(a.day, o.day)), '[]'::jsonb)
        FROM daily_accounts a FULL JOIN daily_orders o ON o.day = a.day)
    ) AS data`;
}

export async function readAdminMetrics(database = prisma) {
  return database.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    await tx.$executeRaw`SET LOCAL statement_timeout = '2500ms'`;
    const [clock] = await tx.$queryRaw<{ asOf: Date }[]>`SELECT CURRENT_TIMESTAMP AS "asOf"`;
    if (!clock) throw new Error("METRICS_UNAVAILABLE");
    const [result] = await tx.$queryRaw<{ data: unknown }[]>(adminMetricsSql(clock.asOf));
    if (!result) throw new Error("METRICS_UNAVAILABLE");
    return presentMetrics(result.data, clock.asOf);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 1000, timeout: 4000 });
}
