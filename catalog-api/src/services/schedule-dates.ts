// Fixed-expense dates (docs/expenses-f1b-contract.md §5). Calendar dates in America/Bogota, as "YYYY-MM-DD".
// WEEKLY, MONTHLY or YEARLY every `interval` (1–12). Monthly and yearly keep the anchor day and fall back to the
// last day of shorter months (31 → 28/29 Feb → 31 Mar; 29 Feb yearly → 28 Feb in common years).

export type ScheduleRule = { frequency: "WEEKLY" | "MONTHLY" | "YEARLY"; interval: number; anchorDate: string; endDate: string | null };
export const MAX_OCCURRENCES_PER_SYNC = 24;

const pad = (value: number) => String(value).padStart(2, "0");
const parse = (date: string) => date.split("-").map(Number) as [number, number, number];
const lastDay = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();
export function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`); value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
/** Last day of the month of `date`. */
export const monthEnd = (date: string) => { const [y, m] = parse(date); return `${y}-${pad(m)}-${pad(lastDay(y, m))}`; };
/** Generation horizon: the end of the current month or a week ahead, whichever is later. */
export const horizon = (today: string) => { const end = monthEnd(today), week = addDays(today, 7); return end > week ? end : week; };

/** The k-th occurrence (k ≥ 0) of a rule, ignoring endDate. */
export function nthOccurrence(rule: ScheduleRule, k: number) {
  const [year, month, day] = parse(rule.anchorDate);
  if (rule.frequency === "WEEKLY") return addDays(rule.anchorDate, 7 * rule.interval * k);
  const months = rule.frequency === "MONTHLY" ? (month - 1) + k * rule.interval : (month - 1) + 12 * k * rule.interval;
  const y = year + Math.floor(months / 12), m = (months % 12) + 1;
  return `${y}-${pad(m)}-${pad(Math.min(day, lastDay(y, m)))}`;
}

/** Occurrences in (after, through], in order, stopping at endDate. `after` null means from the anchor. */
export function occurrencesBetween(rule: ScheduleRule, after: string | null, through: string, limit = Number.MAX_SAFE_INTEGER) {
  const dates: string[] = [];
  const last = rule.endDate && rule.endDate < through ? rule.endDate : through;
  // Skip ahead roughly to `after` so long-running weekly rules do not iterate from the anchor.
  let k = 0;
  if (after && after > rule.anchorDate) {
    const span = (Date.parse(`${after}T00:00:00Z`) - Date.parse(`${rule.anchorDate}T00:00:00Z`)) / 86400000;
    const unit = rule.frequency === "WEEKLY" ? 7 * rule.interval : rule.frequency === "MONTHLY" ? 28 * rule.interval : 365 * rule.interval;
    k = Math.max(0, Math.floor(span / unit) - 2);
  }
  for (let guard = 0; guard < 100000 && dates.length < limit; guard++, k++) {
    const date = nthOccurrence(rule, k);
    if (date > last) break;
    if (!after || date > after) dates.push(date);
  }
  return dates;
}

/** Next occurrence on or after `from` (null when the rule has ended). */
export function nextOccurrence(rule: ScheduleRule, from: string) {
  return occurrencesBetween(rule, addDays(from, -1), "9999-12-31", 1)[0] ?? null;
}

/**
 * What a sync generates for one fixed expense. First time (generatedThrough null): of the dates already due only the
 * most recent (contract decision 6), plus the future ones up to the horizon. Later: every date after generatedThrough
 * up to the horizon. At most MAX_OCCURRENCES_PER_SYNC per call; `through` is the new generatedThrough.
 */
export function syncPlan(rule: ScheduleRule, generatedThrough: string | null, today: string) {
  const until = horizon(today);
  let dates: string[];
  if (generatedThrough === null) {
    const due = occurrencesBetween(rule, null, today);
    dates = [...due.slice(-1), ...occurrencesBetween(rule, today, until)];
  } else dates = occurrencesBetween(rule, generatedThrough, until);
  if (dates.length > MAX_OCCURRENCES_PER_SYNC) {
    const taken = dates.slice(0, MAX_OCCURRENCES_PER_SYNC);
    return { dates: taken, through: taken[taken.length - 1] as string };
  }
  return { dates, through: generatedThrough && generatedThrough > until ? generatedThrough : until };
}

/**
 * Read-only projection (never stored): the dates a later sync would generate inside [from, through]. Mirrors syncPlan:
 * only dates after generatedThrough (or after yesterday when the fixed expense was never generated), up to endDate.
 */
export function projectedDates(rule: ScheduleRule, generatedThrough: string | null, today: string, from: string, through: string) {
  const floor = generatedThrough ?? addDays(today, -1), before = addDays(from, -1);
  return occurrencesBetween(rule, floor > before ? floor : before, through);
}
