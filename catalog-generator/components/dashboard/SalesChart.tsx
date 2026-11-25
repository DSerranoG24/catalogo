"use client";

import { useState, type KeyboardEvent } from "react";
import { BarChart3 } from "lucide-react";
import { formatAxis, formatCop, longDay, weekday, type DashboardDays } from "@/lib/dashboard-ui.mjs";

// BigInt() instead of literals: the TypeScript target is lower than ES2020.
const ZERO = BigInt(0), THOUSAND = BigInt(1000);

const RANGES: DashboardDays[] = [7, 30, 90];
// Bar geometry is scaled with BigInt into 0..1000 before becoming a percentage: amounts are never Numbers.
const share = (value: bigint, max: bigint) => max === ZERO ? 0 : Number((value * THOUSAND) / max) / 10;

/** Daily bars (SVG-free CSS), range selector and a visually hidden table as the accessible alternative. */
export default function SalesChart({ series, days, loading, onDays }: { series: { date: string; total: string }[] | null; days: DashboardDays; loading: boolean; onDays: (days: DashboardDays) => void }) {
  const [active, setActive] = useState<number | null>(null);
  const title = days === 7 ? "Ventas de la semana" : `Ventas de los últimos ${days} días`;
  const values = series?.map(p => BigInt(p.total)) ?? [];
  const maxPositive = values.reduce((m, v) => v > m ? v : m, ZERO), maxNegative = values.reduce((m, v) => -v > m ? -v : m, ZERO);
  const total = maxPositive + maxNegative, upShare = total === ZERO ? 100 : share(maxPositive, total);
  const labels = days === 7;
  const current = series && active !== null ? series[Math.min(active, series.length - 1)] : null;
  function onKey(event: KeyboardEvent<HTMLDivElement>) {
    if (!series) return;
    const last = series.length - 1, index = active ?? last;
    const next = event.key === "ArrowLeft" ? Math.max(0, index - 1) : event.key === "ArrowRight" ? Math.min(last, index + 1) : event.key === "Home" ? 0 : event.key === "End" ? last : null;
    if (next === null) return;
    event.preventDefault(); setActive(next);
  }
  return <section aria-labelledby="chart-title" aria-busy={loading} className="rounded-2xl border border-[var(--vy-border)] bg-white p-5 shadow-[0_10px_30px_-24px_rgba(1,28,79,0.5)]">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 id="chart-title" className="flex items-center gap-3 text-lg font-semibold text-[var(--vy-text)]"><BarChart3 aria-hidden="true" className="size-6 text-[var(--vy-blue-600)]" />{title}</h2>
      <div role="group" aria-label="Rango de la gráfica" className="flex rounded-full bg-[var(--vy-surface-soft)] p-1">
        {RANGES.map(range => <button key={range} type="button" aria-pressed={range === days} onClick={() => { setActive(null); onDays(range); }}
          className={`min-h-11 rounded-full px-4 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--vy-blue-600)] ${range === days ? "bg-[var(--vy-blue-600)] text-white" : "text-[var(--vy-text-muted)] hover:text-[var(--vy-text)]"}`}>{range} días</button>)}
      </div>
    </div>

    {!series ? <div aria-hidden="true" className="mt-5 h-56 animate-pulse rounded-xl bg-[var(--vy-surface-soft)]" /> : <>
      <div tabIndex={0} role="group" aria-roledescription="gráfica" aria-label={`${title}. Usa las flechas izquierda y derecha para recorrer los días.`} aria-describedby="chart-current" onKeyDown={onKey} onBlur={() => setActive(null)}
        className={`mt-5 rounded-xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--vy-blue-600)] ${loading ? "opacity-60" : ""}`}>
        <div aria-hidden="true" className="flex h-56 items-stretch gap-[2px] sm:gap-1" onMouseLeave={() => setActive(null)}>
          {series.map((point, index) => {
            const value = values[index] ?? ZERO, last = index === series.length - 1, highlighted = active === index;
            const up = value > ZERO ? share(value, maxPositive) : 0, down = value < ZERO ? share(-value, maxNegative) : 0;
            return <div key={point.date} onMouseEnter={() => setActive(index)} className="flex min-w-0 flex-1 flex-col">
              <div className="flex flex-col justify-end" style={{ height: `${upShare}%` }}>
                {labels && value !== ZERO && <span className="mb-1 text-center text-[11px] font-semibold text-[var(--vy-text)] sm:text-xs">{formatAxis(point.total)}</span>}
                <div className={`mx-auto w-full max-w-14 rounded-t-md ${last ? "bg-[var(--vy-navy-700)]" : highlighted ? "bg-[var(--vy-blue-600)]" : "bg-[#7DB4FF]"}`} style={{ height: `${up}%`, minHeight: value > ZERO ? 2 : 0 }} />
              </div>
              <div className="border-t border-[var(--vy-border)]" />
              <div className="flex flex-col" style={{ height: `${100 - upShare}%` }}>
                <div className="mx-auto w-full max-w-14 rounded-b-md bg-[#F4A29A]" style={{ height: `${down}%` }} />
              </div>
            </div>;
          })}
        </div>
        <div aria-hidden="true" className="mt-2 flex gap-[2px] text-xs text-[var(--vy-text-muted)] sm:gap-1">
          {labels ? series.map(point => <span key={point.date} className="min-w-0 flex-1 text-center">{weekday(point.date)}</span>)
            : <><span className="flex-1">{longDay(series[0]!.date)}</span><span className="flex-1 text-right">{longDay(series.at(-1)!.date)}</span></>}
        </div>
      </div>
      <p id="chart-current" aria-live="polite" className="mt-3 min-h-6 text-sm text-[var(--vy-text)]">
        {current ? <><span className="font-semibold">{longDay(current.date)}:</span> {formatCop(current.total)}</> : <span className="text-[var(--vy-text-muted)]">{total === ZERO ? "Sin ventas en este periodo." : labels ? "Pasa el cursor o usa las flechas para ver cada día." : "Pasa el cursor o usa las flechas para ver el valor de cada día."}</span>}
      </p>
      <table className="sr-only">
        <caption>{title}: total vendido por día</caption>
        <thead><tr><th scope="col">Día</th><th scope="col">Total</th></tr></thead>
        <tbody>{series.map(point => <tr key={point.date}><th scope="row">{longDay(point.date)}</th><td>{formatCop(point.total)}</td></tr>)}</tbody>
      </table>
    </>}
  </section>;
}
