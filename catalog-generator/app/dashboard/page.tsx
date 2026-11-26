"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CircleDollarSign, Package, Plus, RefreshCw } from "lucide-react";
import { apiRequest, type Catalog, useStoredSession } from "@/lib/api";
import { isEnabled } from "@/lib/panel-navigation";
import { bogotaTime, parseDashboardSummary, type DashboardDays, type DashboardSummary } from "@/lib/dashboard-ui.mjs";
import SummaryCards from "@/components/dashboard/SummaryCards";
import AttentionCard from "@/components/dashboard/AttentionCard";
import SalesChart from "@/components/dashboard/SalesChart";
import { FirstSteps, HomeFooter, RecentSales } from "@/components/dashboard/HomeBlocks";

/** Long date in Spanish for Bogotá, e.g. «Miércoles 25 de noviembre de 2026». */
function longBogotaDate(now = new Date()) {
  const text = new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(now).replace(",", "");
  return text.charAt(0).toLocaleUpperCase("es-CO") + text.slice(1);
}
const REFRESH_ON_FOCUS_MS = 60_000;
const message = (cause: unknown) => cause instanceof Error && cause.message ? cause.message : "No se pudo cargar el resumen.";

/** Inicio: greeting, quick actions and the server-computed summary (GET /api/dashboard/summary). */
export default function HomePage() {
  const session = useStoredSession();
  const firstName = session?.user.name?.trim().split(/\s+/)[0];
  const actions = [
    ...(isEnabled("gastos") ? [{ href: "/dashboard/gastos", label: "Registrar gasto", Icon: CircleDollarSign }] : []),
    { href: "/dashboard/inventario", label: "Agregar producto", Icon: Package },
  ];

  // A request is identified by range + revision; replies for an older key are ignored (late responses).
  const [days, setDays] = useState<DashboardDays>(7);
  const [revision, setRevision] = useState(0);
  const key = `${days}:${revision}`;
  const [reply, setReply] = useState<{ key: string; error: string | null } | null>(null);
  const [data, setData] = useState<DashboardSummary | null>(null);
  const lastRequest = useRef(0);
  // F1b (correction A): the summary is read only. With Gastos enabled, due fixed-expense dates are generated first by
  // POST /expenses/scheduled/sync (idempotent). If it fails, the summary still loads with a discreet notice (correction C).
  const scheduling = isEnabled("gastos");
  const [sync, setSync] = useState<"running" | "ok" | "failed">(scheduling ? "running" : "ok");
  useEffect(() => {
    if (!scheduling) return;
    let active = true;
    apiRequest<unknown>("/expenses/scheduled/sync", { method: "POST" }).then(() => { if (active) setSync("ok"); }, () => { if (active) setSync("failed"); });
    return () => { active = false; };
  }, [scheduling]);
  const ready = sync !== "running";
  useEffect(() => {
    if (!ready) return;
    let active = true;
    lastRequest.current = Date.now();
    apiRequest<unknown>(`/dashboard/summary?days=${days}`).then(value => parseDashboardSummary(value, days)).then(
      summary => { if (active) { setData(summary); setReply({ key, error: null }); } },
      cause => { if (active) setReply({ key, error: message(cause) }); });
    return () => { active = false; };
  }, [key, days, ready]);
  // Refresh when the tab regains focus, at most once a minute.
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible" && Date.now() - lastRequest.current >= REFRESH_ON_FOCUS_MS) setRevision(v => v + 1); };
    window.addEventListener("focus", refresh); document.addEventListener("visibilitychange", refresh);
    return () => { window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, []);
  const settled = reply?.key === key ? reply : null;
  const loading = !settled;
  const error = settled?.error ?? null;
  const retry = () => setRevision(v => v + 1);

  // «Revisar» goes to the only catalog, or to the list when there are several (or before knowing).
  const pending = (data?.attention.pendingOrdersCount ?? 0) > 0;
  const [catalogs, setCatalogs] = useState<Catalog[] | null>(null);
  useEffect(() => {
    if (!pending) return;
    let active = true;
    apiRequest<{ catalogs: Catalog[] }>("/catalogs").then(result => { if (active && Array.isArray(result.catalogs)) setCatalogs(result.catalogs); }, () => undefined);
    return () => { active = false; };
  }, [pending]);
  const ordersHref = catalogs?.length === 1 && catalogs[0] ? `/dashboard/catalogos/${catalogs[0].id}` : "/dashboard/catalogos";

  const seriesForRange = data && data.salesSeries.length === days ? data.salesSeries : null;
  return (
    <main className="mx-auto w-full max-w-6xl space-y-6 px-5 py-6 sm:px-8 lg:py-4">
      <div className="flex flex-wrap items-center justify-between gap-5">
        <div className="flex items-center gap-4">
          <span aria-hidden="true" className="text-4xl sm:text-5xl">👋</span>
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-[var(--vy-text)] sm:text-4xl">{firstName ? `Hola, ${firstName}` : "Hola"}</h1>
            <p className="mt-1 text-base text-[var(--vy-text-muted)] sm:text-lg">{longBogotaDate()}</p>
          </div>
        </div>
        <Link href="/dashboard/ventas" className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-[var(--vy-blue-600)] px-5 text-base font-semibold text-white shadow-[0_14px_28px_-14px_rgba(4,80,229,0.9)] transition hover:bg-[var(--vy-blue-700)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--vy-blue-600)]">
          <Plus aria-hidden="true" className="size-5" />Nueva venta
        </Link>
      </div>
      <section aria-labelledby="quick-actions">
        <h2 id="quick-actions" className="sr-only">Acciones rápidas</h2>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {actions.map(({ href, label, Icon }) => (
            <li key={href}>
              <Link href={href} className="flex min-h-14 items-center gap-3 rounded-2xl border border-[var(--vy-border)] bg-white px-5 font-semibold text-[var(--vy-text)] shadow-[0_8px_24px_-18px_rgba(1,28,79,0.5)] transition hover:border-[var(--vy-blue-600)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--vy-blue-600)]">
                <Icon aria-hidden="true" className="size-6 text-[var(--vy-blue-600)]" />{label}
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <p role="status" className="sr-only">{data && !loading && !error ? `Resumen actualizado a las ${bogotaTime(data.generatedAt)}` : ""}</p>
      {error && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#F4C7C2] bg-[#FEF3F2] px-5 py-4 text-[#B42318]">
        <p><span className="font-semibold">No se pudo actualizar el resumen.</span> {data ? "Mostramos las últimas cifras cargadas." : error}</p>
        <button type="button" onClick={retry} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[#B42318] bg-white px-4 font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#B42318]"><RefreshCw aria-hidden="true" className="size-4" />Reintentar</button>
      </div>}

      {sync === "failed" && <p role="status" data-sync-notice className="rounded-xl border border-[#F5D9B8] bg-[#FFF8EF] px-4 py-2 text-sm text-[#8A3B0C]">No pudimos actualizar los gastos fijos; los avisos de pagos pueden estar incompletos.</p>}
      {data ? <>
        <FirstSteps setup={data.setup} />
        <SummaryCards data={data} />
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] xl:items-start">
          <AttentionCard attention={data.attention} ordersHref={ordersHref} scheduled={data.modules.scheduledExpenses === true} />
          <SalesChart series={seriesForRange} days={days} loading={loading} onDays={setDays} />
        </div>
        <RecentSales recent={data.recent} today={data.today.date} />
      </> : !error && <div aria-busy="true" aria-label="Cargando el resumen" className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2">{[0, 1].map(i => <div key={i} className="h-44 animate-pulse rounded-2xl bg-[#E6EEFF]" />)}</div>
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]"><div className="h-64 animate-pulse rounded-2xl bg-white" /><div className="h-80 animate-pulse rounded-2xl bg-white" /></div>
        <div className="h-48 animate-pulse rounded-2xl bg-white" />
      </div>}
      <HomeFooter generatedAt={data?.generatedAt ?? null} connected={!error} />
    </main>
  );
}
