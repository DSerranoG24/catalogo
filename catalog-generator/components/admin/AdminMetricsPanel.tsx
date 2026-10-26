"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, apiRequest } from "@/lib/api";
import { useRouter } from "next/navigation";
import { parseAdminMetrics, type AdminMetrics } from "@/lib/admin-metrics";

const number = (value: number) => value.toLocaleString("es-CO");
const percentage = (value: number | null) => value === null ? "Sin base" : `${value.toLocaleString("es-CO", { maximumFractionDigits: 2 })} %`;
const button = "min-h-11 rounded-xl bg-[var(--brand-emerald)] px-4 py-2 text-sm font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--brand-emerald)] disabled:opacity-50";
const card = "min-w-0 rounded-2xl border border-[var(--brand-emerald)]/20 bg-white p-5";
const cell = "px-3 py-3 text-left tabular-nums";

export default function AdminMetricsPanel() {
  const router = useRouter();
  const [data, setData] = useState<AdminMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const timeout = AbortSignal.timeout(8000);
      const result = await apiRequest<{ metrics: unknown }>("/admin/metrics", { signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
      const parsed = parseAdminMetrics(result.metrics);
      if (!signal?.aborted) setData(parsed);
    } catch (requestError) {
      if (!signal?.aborted && requestError instanceof ApiError && [401, 404].includes(requestError.status)) { setData(null); router.refresh(); }
      if (!signal?.aborted) setError("No se pudieron actualizar las métricas. Reintenta; si hay datos anteriores, se conserva su fecha de corte.");
    } finally { if (!signal?.aborted) setLoading(false); }
  }, [router]);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => void load(controller.signal), 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [load]);
  function refresh() { setLoading(true); setError(""); void load(); }
  const max = data ? Math.max(1, ...data.daily.flatMap(day => [day.accountsCreated, day.ordersCreated])) : 1;
  return <section className="mt-6 min-w-0" aria-label="Métricas agregadas de la plataforma" aria-busy={loading}>
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-semibold">Métricas de la plataforma</h2><button type="button" className={button} disabled={loading} onClick={refresh}>Actualizar métricas</button></div>
    <p className="mt-3 text-sm leading-6">Incluye todas las cuentas, también ADMIN. Zona: America/Bogota. Últimos 7 días = hoy y 6 anteriores; 30 días = hoy y 29 anteriores. Hoy es parcial.</p>
    {loading && <p role="status" className="mt-4">Actualizando métricas…</p>}
    {error && <div role="alert" className="mt-4 rounded-xl border border-[#f0c8b9] bg-[#fff4ef] p-4 text-sm text-[#a5432a]"><p>{error}</p><button type="button" disabled={loading} className={`${button} mt-3`} onClick={refresh}>Reintentar</button></div>}
    {data && <>
      <p className="mt-4 text-sm">Fecha de corte: <time dateTime={data.asOf}>{new Intl.DateTimeFormat("es-CO", { dateStyle: "medium", timeStyle: "medium", timeZone: "America/Bogota" }).format(new Date(data.asOf))}</time></p>
      <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {[
          { title: "Cuentas creadas", value: data.accounts.total, detail: `7 días: ${number(data.accounts.last7Days)} · 30 días: ${number(data.accounts.last30Days)}` },
          { title: "Cuentas con productos", value: data.accounts.active, detail: `${percentage(data.accounts.activePercent)} de las cuentas. Al menos un producto existente, aunque esté inactivo.` },
          { title: "Catálogos publicados", value: data.catalogs.published, detail: `Activos, no archivados y con producto activo. Creados en el periodo que siguen publicados: 7 días ${number(data.catalogs.last7Days)} · 30 días ${number(data.catalogs.last30Days)}.` },
          { title: "Pedidos registrados", value: data.orders.total, detail: `Incluye cancelados. 7 días: ${number(data.orders.last7Days)} · 30 días: ${number(data.orders.last30Days)}` },
          { title: "Repetición histórica acumulada", value: data.repeat.repeating, detail: `${percentage(data.repeat.percent)} de ${number(data.repeat.withOrders)} cuentas con pedidos. Pedidos en dos o más semanas de lunes a domingo, aunque fueran hace un año.` },
          { title: "Correos sin verificar", value: data.accounts.unverified, detail: `${percentage(data.accounts.unverifiedPercent)} de las cuentas.` },
        ].map(item => <article key={item.title} className={card}><h3 className="font-semibold">{item.title}</h3><p className="mt-3 text-3xl font-semibold tabular-nums text-[var(--brand-forest)]">{number(item.value)}</p><p className="mt-3 text-sm leading-6">{item.detail}</p></article>)}
      </div>
      <section className={`${card} mt-5`}><h3 className="text-lg font-semibold">Embudo de pedidos por cohorte de creación</h3><p className="mt-2 text-sm leading-6">Son pedidos iniciados, no carritos abiertos. Los cancelados permanecen en el denominador. La proporción actual divide confirmados/completados actuales entre iniciados.</p>
        <div role="region" aria-label="Embudo por periodo" tabIndex={0} className="mt-4 overflow-x-auto rounded-lg focus-visible:outline-2 focus-visible:outline-[var(--brand-emerald)]"><table className="w-full text-sm"><caption className="sr-only">Estados actuales por fecha de creación del pedido</caption><thead><tr>{["Cohorte", "Iniciados", "Pendientes actuales", "Confirmados/completados actuales", "Proporción actual"].map(title => <th key={title} scope="col" className={cell}>{title}</th>)}</tr></thead><tbody>{([ ["Histórico", data.funnel.allTime], ["7 días", data.funnel.last7Days], ["30 días", data.funnel.last30Days] ] as const).map(([label, row]) => <tr key={label} className="border-t border-[var(--brand-emerald)]/15"><th scope="row" className={cell}>{label}</th><td className={cell}>{number(row.initiated)}</td><td className={cell}>{number(row.pending)}</td><td className={cell}>{number(row.confirmedCurrent)}</td><td className={cell}>{percentage(row.confirmedCurrentPercent)}</td></tr>)}</tbody></table></div>
        <h4 className="mt-5 font-semibold">Confirmaciones conocidas, aunque después se cancelen</h4><p className="mt-2 text-sm leading-6">La primera fecha de confirmación solo se registra desde este despliegue. Sin fecha, se reconocen los estados actuales CONFIRMED/COMPLETED. Los cancelados históricos sin fecha son desconocidos; no se inventa su historia. La proporción conocida es un mínimo si quedan cancelados sin historia.</p>
        <ul className="mt-3 space-y-2 text-sm">{([ ["Histórico", data.funnel.allTime], ["7 días", data.funnel.last7Days], ["30 días", data.funnel.last30Days] ] as const).map(([label, row]) => <li key={label}>{label}: {number(row.confirmedKnown)} conocidos ({percentage(row.confirmedKnownPercent)}), {number(row.confirmedDated)} con fecha registrada; {number(row.legacyCancelledUnknown)} cancelados sin historia conocida.</li>)}</ul>
      </section>
      <section className={`${card} mt-5`}><h3 className="font-semibold">Visitas a catálogos públicos</h3><p className="mt-2">Sin instrumentación</p><p className="mt-2 text-sm">No hay un recuento de visitas para 7 ni 30 días. No se presenta como cero ni se calcula conversión desde visitas.</p></section>
      <section className={`${card} mt-5`}><h3 className="text-lg font-semibold">Tendencia diaria: últimos 30 días</h3><p className="mt-2 text-sm">Cuentas en esmeralda y pedidos en coral. La tabla incluye los valores exactos y los días sin registros.</p>
        <svg role="img" aria-label="Tendencia diaria de cuentas y pedidos; valores exactos en la tabla siguiente" viewBox="0 0 600 130" className="mt-4 w-full"><title>Cuentas y pedidos diarios</title><g aria-hidden="true">{data.daily.map((day, index) => <g key={day.date}><rect x={index * 20 + 1} y={120 - day.accountsCreated / max * 110} width="8" height={day.accountsCreated / max * 110} fill="var(--brand-emerald)" /><rect x={index * 20 + 10} y={120 - day.ordersCreated / max * 110} width="8" height={day.ordersCreated / max * 110} fill="var(--brand-coral)" /></g>)}</g></svg>
        <div role="region" aria-label="Datos diarios" tabIndex={0} className="mt-4 overflow-x-auto rounded-lg focus-visible:outline-2 focus-visible:outline-[var(--brand-emerald)]"><table className="w-full text-sm"><caption className="sr-only">Días de Bogotá, incluido hoy parcial</caption><thead><tr><th scope="col" className={cell}>Fecha</th><th scope="col" className={cell}>Cuentas creadas</th><th scope="col" className={cell}>Pedidos creados</th></tr></thead><tbody>{data.daily.map(day => <tr key={day.date} className="border-t border-[var(--brand-emerald)]/15"><th scope="row" className={cell}>{day.date}</th><td className={cell}>{number(day.accountsCreated)}</td><td className={cell}>{number(day.ordersCreated)}</td></tr>)}</tbody></table></div>
      </section>
    </>}
  </section>;
}
