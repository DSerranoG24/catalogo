import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowDown, ArrowUp, BarChart3, ShoppingCart, Wallet } from "lucide-react";
import { compare, formatCopCompact, isNegative, plural, type DashboardSummary } from "@/lib/dashboard-ui.mjs";
import { isEnabled } from "@/lib/panel-navigation";

// BigInt() instead of literals: the TypeScript target is lower than ES2020.
const ZERO = BigInt(0), THOUSAND = BigInt(1000);

const TINTS = {
  blue: { card: "border-[#D6E2FF] bg-[linear-gradient(135deg,#F3F7FF,#E6EEFF)]", icon: "text-[var(--vy-blue-600)]", line: "#0450E5" },
  green: { card: "border-[#CDEBD8] bg-[linear-gradient(135deg,#F2FBF5,#E2F4E9)]", icon: "text-[#15803D]", line: "#15803D" },
  violet: { card: "border-[#E1DAFE] bg-[linear-gradient(135deg,#F7F5FF,#EDE8FF)]", icon: "text-[#6D28D9]", line: "#6D28D9" },
} as const;

/** Change line: «+12% vs ayer», «Igual que ayer» or «Sin datos del periodo anterior». */
function Change({ current, previous, against, equal }: { current: string; previous: string; against: string; equal: string }) {
  const change = compare(current, previous);
  if (!change) return <p className="text-sm text-[var(--vy-text-muted)]">Sin datos del periodo anterior</p>;
  if (change.direction === "equal") return <p className="text-sm text-[var(--vy-text-muted)]">{equal}</p>;
  const up = change.direction === "up";
  return <p className={`flex items-center gap-1 text-sm font-medium ${up ? "text-[#166534]" : "text-[#B42318]"}`}>
    {up ? <ArrowUp aria-hidden="true" className="size-4" /> : <ArrowDown aria-hidden="true" className="size-4" />}{change.text} {against}
  </p>;
}

/** Decorative trend line from the daily series; the chart section carries the accessible data. */
export function Sparkline({ values, color }: { values: string[]; color: string }) {
  if (values.length < 2) return null;
  const numbers = values.map(v => BigInt(v));
  const min = numbers.reduce((a, b) => b < a ? b : a), max = numbers.reduce((a, b) => b > a ? b : a), span = max - min;
  // Geometry only: positions are scaled with BigInt into 0..1000 before becoming pixels.
  const y = (v: bigint) => span === ZERO ? 20 : 38 - Number(((v - min) * THOUSAND) / span) * 0.034;
  const points = numbers.map((v, i) => `${(i * 100) / (numbers.length - 1)},${y(v).toFixed(1)}`).join(" ");
  return <svg aria-hidden="true" focusable="false" viewBox="0 0 100 40" preserveAspectRatio="none" className="h-12 w-28 shrink-0 self-end">
    <polyline points={points} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
  </svg>;
}

function Card({ tint, icon, title, value, children, spark }: { tint: keyof typeof TINTS; icon: ReactNode; title: string; value: string; children: ReactNode; spark?: string[] }) {
  const tone = TINTS[tint];
  return <article className={`flex min-w-0 flex-col gap-3 rounded-2xl border p-5 shadow-[0_10px_30px_-24px_rgba(1,28,79,0.5)] ${tone.card}`}>
    <div className="flex items-center gap-3">
      <span aria-hidden="true" className={`grid size-11 shrink-0 place-items-center rounded-full bg-white shadow-sm ${tone.icon}`}>{icon}</span>
      <h3 className="font-medium text-[var(--vy-text)]">{title}</h3>
    </div>
    <div className="flex flex-1 items-end justify-between gap-3">
      <div className="min-w-0 space-y-1 self-start">
        <p className={`break-words text-3xl font-bold tracking-tight ${isNegative(value) ? "text-[#B42318]" : "text-[var(--vy-text)]"}`} data-figure={title}>{formatCopCompact(value)}</p>
        {children}
      </div>
      {spark && <Sparkline values={spark} color={tone.line} />}
    </div>
  </article>;
}

/** Figure cards. «Te deben» is not shown: Cartera does not exist. Gastos only with its module. */
export default function SummaryCards({ data }: { data: DashboardSummary }) {
  const expenses = data.modules.expenses && isEnabled("gastos") && data.month.expensesTotal !== null;
  const { month } = data;
  return <section aria-labelledby="figures-title">
    <h2 id="figures-title" className="sr-only">Cifras</h2>
    <div className={`grid gap-4 sm:grid-cols-2 ${expenses ? "xl:grid-cols-3" : ""}`}>
      <Card tint="blue" icon={<ShoppingCart className="size-5" />} title="Ventas hoy" value={data.today.salesTotal} spark={data.salesSeries.map(p => p.total)}>
        <Change current={data.today.salesTotal} previous={data.today.yesterdaySalesTotal} against="vs ayer" equal="Igual que ayer" />
      </Card>
      <Card tint="green" icon={<BarChart3 className="size-5" />} title="Utilidad del mes" value={month.estimatedProfit}>
        <Change current={month.estimatedProfit} previous={month.previousMonth.estimatedProfit} against="vs mes anterior" equal="Igual que el mes anterior" />
        <p className="text-xs text-[var(--vy-text-muted)]">Utilidad estimada con el costo registrado</p>
        {month.salesWithoutCostCount > 0 && isEnabled("inventario") && <Link href="/dashboard/inventario"
          className="inline-flex min-h-11 items-center text-sm font-semibold text-[#7a4f0b] underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--vy-blue-600)]">
          {plural(month.salesWithoutCostCount, "venta sin costo", "ventas sin costo")}: revisa el costo en Inventario
        </Link>}
      </Card>
      {expenses && month.expensesTotal !== null && month.previousMonth.expensesTotal !== null && <Card tint="violet" icon={<Wallet className="size-5" />} title="Gastos del mes" value={month.expensesTotal}>
        <Change current={month.expensesTotal} previous={month.previousMonth.expensesTotal} against="vs mes anterior" equal="Igual que el mes anterior" />
      </Card>}
    </div>
  </section>;
}
