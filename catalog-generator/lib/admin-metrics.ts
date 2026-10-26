const record = (value: unknown): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("INVALID_METRICS");
  return value as Record<string, unknown>;
};
const count = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error("INVALID_METRICS");
  return value;
};
const percent = (value: unknown) => {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) throw new Error("INVALID_METRICS");
  return value;
};
function cohort(value: unknown) {
  const row = record(value);
  return { initiated: count(row.initiated), pending: count(row.pending), confirmedCurrent: count(row.confirmedCurrent), confirmedKnown: count(row.confirmedKnown), confirmedDated: count(row.confirmedDated), legacyCancelledUnknown: count(row.legacyCancelledUnknown), confirmedCurrentPercent: percent(row.confirmedCurrentPercent), confirmedKnownPercent: percent(row.confirmedKnownPercent) };
}
export function parseAdminMetrics(value: unknown) {
  const row = record(value), accounts = record(row.accounts), catalogs = record(row.catalogs), orders = record(row.orders), repeat = record(row.repeat), funnel = record(row.funnel), visits = record(row.visits);
  if (typeof row.asOf !== "string" || !Number.isFinite(Date.parse(row.asOf)) || row.timeZone !== "America/Bogota" || row.includesAdmin !== true || !Array.isArray(row.daily) || row.daily.length !== 30 || visits.last7Days !== null || visits.last30Days !== null) throw new Error("INVALID_METRICS");
  return {
    asOf: row.asOf,
    accounts: { total: count(accounts.total), last7Days: count(accounts.last7Days), last30Days: count(accounts.last30Days), active: count(accounts.active), activePercent: percent(accounts.activePercent), unverified: count(accounts.unverified), unverifiedPercent: percent(accounts.unverifiedPercent) },
    catalogs: { published: count(catalogs.published), last7Days: count(catalogs.last7Days), last30Days: count(catalogs.last30Days) },
    orders: { total: count(orders.total), last7Days: count(orders.last7Days), last30Days: count(orders.last30Days) },
    repeat: { withOrders: count(repeat.withOrders), repeating: count(repeat.repeating), percent: percent(repeat.percent) },
    funnel: { allTime: cohort(funnel.allTime), last7Days: cohort(funnel.last7Days), last30Days: cohort(funnel.last30Days) },
    daily: row.daily.map(value => { const day = record(value); if (typeof day.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day.date)) throw new Error("INVALID_METRICS"); return { date: day.date, accountsCreated: count(day.accountsCreated), ordersCreated: count(day.ordersCreated) }; }),
  };
}
export type AdminMetrics = ReturnType<typeof parseAdminMetrics>;
