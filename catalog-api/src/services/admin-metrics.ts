import { z } from "zod";

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const cohort = z.object({ initiated: count, pending: count, confirmedCurrent: count, confirmedKnown: count, confirmedDated: count, legacyCancelledUnknown: count }).strict();
export const metricsCountsSchema = z.object({
  accounts: z.object({ total: count, last7Days: count, last30Days: count, active: count, unverified: count }).strict(),
  catalogs: z.object({ published: count, last7Days: count, last30Days: count }).strict(),
  orders: z.object({ total: count, last7Days: count, last30Days: count }).strict(),
  repeat: z.object({ withOrders: count, repeating: count }).strict(),
  funnel: z.object({ allTime: cohort, last7Days: cohort, last30Days: cohort }).strict(),
  daily: z.array(z.object({ date: z.iso.date(), accountsCreated: count, ordersCreated: count }).strict()).max(30),
}).strict();
export type MetricsCounts = z.infer<typeof metricsCountsSchema>;
export const percentage = (numerator: number, denominator: number) => denominator === 0 ? null : Math.round(numerator / denominator * 10_000) / 100;
export function presentMetrics(data: unknown, asOf: Date) {
  const counts = metricsCountsSchema.parse(data);
  const parts = new Intl.DateTimeFormat("en", { timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(asOf);
  const part = (type: Intl.DateTimeFormatPartTypes) => { const value = parts.find(p => p.type === type)?.value; if (!value) throw new Error("INVALID_METRICS_DATE"); return value; };
  const today = new Date(`${part("year")}-${part("month")}-${part("day")}T00:00:00Z`);
  const byDay = new Map(counts.daily.map(day => [day.date, day]));
  if (byDay.size !== counts.daily.length) throw new Error("DUPLICATE_METRICS_DAY");
  const daily = Array.from({ length: 30 }, (_, index) => {
    const day = new Date(today); day.setUTCDate(day.getUTCDate() - 29 + index);
    const date = day.toISOString().slice(0, 10);
    return byDay.get(date) ?? { date, accountsCreated: 0, ordersCreated: 0 };
  });
  if (counts.daily.some(day => !daily.some(entry => entry.date === day.date))) throw new Error("OUT_OF_RANGE_METRICS_DAY");
  const decorate = (value: z.infer<typeof cohort>) => ({ ...value, confirmedCurrentPercent: percentage(value.confirmedCurrent, value.initiated), confirmedKnownPercent: percentage(value.confirmedKnown, value.initiated) });
  return {
    asOf: asOf.toISOString(), timeZone: "America/Bogota" as const, includesAdmin: true as const,
    ...counts,
    daily,
    accounts: { ...counts.accounts, activePercent: percentage(counts.accounts.active, counts.accounts.total), unverifiedPercent: percentage(counts.accounts.unverified, counts.accounts.total) },
    repeat: { ...counts.repeat, percent: percentage(counts.repeat.repeating, counts.repeat.withOrders) },
    funnel: { allTime: decorate(counts.funnel.allTime), last7Days: decorate(counts.funnel.last7Days), last30Days: decorate(counts.funnel.last30Days) },
    visits: { last7Days: null, last30Days: null },
  };
}
