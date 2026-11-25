"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { buyerName, describeFailure, displayStatus, formatCop, formatDate, itemCount, parseSaleList, SALE_STATUSES, STATUS_LABELS,
  type DisplayStatus, type Sale } from "@/lib/sales-ui.mjs";
import CreateSaleForm from "./CreateSaleForm";
import CustomerSalesHistory from "./CustomerSalesHistory";
import SaleDetail from "./SaleDetail";
import SaleStatusBadge from "./SaleStatusBadge";
import FailureNotice from "./FailureNotice";
import { selectClass } from "./CustomerPicker";

export default function SalesPanel() {
  // State is written only when a response arrives; "loading" is derived from the requested revision.
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ revision: number; sales: Sale[] | null; error: ReturnType<typeof describeFailure> | null } | null>(null);
  const [lastSales, setLastSales] = useState<Sale[] | null>(null);
  const [filter, setFilter] = useState<"all" | DisplayStatus>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const load = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => {
    let active = true;
    apiRequest<unknown>("/sales").then(parseSaleList).then(
      list => { if (active) { setResult({ revision, sales: list, error: null }); setLastSales(list); } },
      cause => { if (active) setResult({ revision, sales: null, error: describeFailure(cause) }); });
    return () => { active = false; };
  }, [revision]);
  const loading = result?.revision !== revision;
  const sales = lastSales;
  const error = !loading ? result?.error ?? null : null;

  const visible = (sales ?? []).filter(sale => filter === "all" || displayStatus(sale) === filter);
  return <main className="mx-auto max-w-6xl space-y-6 px-5 py-8 sm:px-8">
    <Link href="/dashboard/catalogos" className="inline-flex min-h-11 items-center underline">← Catálogos</Link>
    <div>
      <h1 className="text-3xl font-semibold">Ventas</h1>
      <p className="mt-2 text-sm text-[#52675b]">Ventas presenciales de tu bodega. Confirmar descuenta existencias; las correcciones se registran con cancelaciones y devoluciones.</p>
      <p className="mt-2 inline-flex rounded-lg border border-[#ecd3a3] bg-[#fdf5e6] px-3 py-1.5 text-sm font-medium text-[#7a4f0b]">Los totales no indican pagos recibidos.</p>
    </div>

    <CreateSaleForm onCreated={id => { setSelectedId(id); load(); }} />

    <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] xl:items-start">
      <section aria-labelledby="sales-list" className="space-y-4 rounded-2xl border border-[#dce4dc] bg-white p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id="sales-list" className="text-xl font-semibold">Ventas registradas</h2>
          <label htmlFor="sales-filter" className="grid gap-1 text-sm font-medium">Filtrar por estado
            <select id="sales-filter" className={selectClass} value={filter} onChange={event => setFilter(event.target.value as typeof filter)}>
              <option value="all">Todas</option>
              {SALE_STATUSES.map(status => <option key={status} value={status}>{STATUS_LABELS[status]}</option>)}
            </select>
          </label>
        </div>
        {loading && !sales && <p role="status">Cargando ventas…</p>}
        {error && <FailureNotice failure={{ ...error, action: error.action === "login" ? "login" : "reload" }} busy={loading} onReload={load} reloadLabel="Reintentar cargar ventas" />}
        {sales && <>
          <p className="text-sm text-[#52675b]">{sales.length === 1 ? "Se muestra la venta más reciente" : `Se muestran las ${sales.length} ventas más recientes`} (máximo 50).</p>
          {!visible.length && <p>{sales.length ? "No hay ventas con este estado." : "Aún no hay ventas. Crea un borrador arriba."}</p>}
          <ul aria-label="Ventas" className="space-y-2">{visible.map(sale => {
            const selected = sale.id === selectedId, buyer = buyerName(sale) ?? "Sin cliente", units = itemCount(sale);
            return <li key={sale.id}>
              <button type="button" aria-current={selected ? "true" : undefined} onClick={() => setSelectedId(sale.id)}
                aria-label={`Abrir venta ${sale.id.slice(0, 8)}, ${buyer}, ${STATUS_LABELS[displayStatus(sale)]}`}
                className={`grid w-full gap-2 rounded-xl border p-3 text-left text-sm transition hover:border-[#9fc4ae] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-emerald)] sm:grid-cols-[minmax(0,1fr)_auto] ${selected ? "border-[#2f7a52] bg-[#f2faf4]" : "border-[#e2e8e0] bg-white"}`}>
                <span className="min-w-0 space-y-0.5">
                  <span className="block break-words font-semibold text-[#263b31]">{buyer}</span>
                  <span className="block text-[#52675b]">{formatDate(sale.createdAt) ?? "Sin fecha"} · {units} artículo{units === 1 ? "" : "s"} · Venta {sale.id.slice(0, 8)}</span>
                </span>
                <span className="flex flex-wrap items-center gap-2 sm:flex-col sm:items-end">
                  <span className="text-base font-semibold text-[#263b31]">{formatCop(sale.total)}</span>
                  <SaleStatusBadge status={displayStatus(sale)} />
                </span>
              </button>
            </li>;
          })}</ul>
          <Button variant="secondary" disabled={loading} onClick={load}>Actualizar listado</Button>
        </>}
      </section>

      {selectedId ? <SaleDetail key={selectedId} saleId={selectedId} onChanged={load} onClose={() => setSelectedId(null)} />
        : <p className="hidden rounded-2xl border border-dashed border-[#dce4dc] p-5 text-sm text-[#52675b] xl:block">Selecciona una venta para ver su detalle.</p>}
    </div>

    <CustomerSalesHistory />
  </main>;
}
