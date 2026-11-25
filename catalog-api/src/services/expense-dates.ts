// Calendar dates of Gastos are interpreted in America/Bogota (docs/expenses-contract.md §4).
const pad = (value: number) => String(value).padStart(2, "0");

/** Today in Bogotá as YYYY-MM-DD. */
export function bogotaToday(now: Date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Oldest allowed expense date: five years before today (29 Feb maps to 28 Feb). */
export function minExpenseDate(today: string) {
  const [year, month, day] = today.split("-").map(Number);
  return `${year - 5}-${pad(month)}-${pad(month === 2 && day === 29 ? 28 : day)}`;
}

/** True when the date is neither in the future nor older than five years. */
export function isAllowedExpenseDate(date: string, now: Date = new Date()) {
  const today = bogotaToday(now);
  return date <= today && date >= minExpenseDate(today);
}

export const toDbDate = (value: string) => new Date(`${value}T00:00:00.000Z`);
export const fromDbDate = (value: Date) => value.toISOString().slice(0, 10);
