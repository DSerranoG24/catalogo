"use client";

import { useEffect, useRef, useState } from "react";
import { apiRequest, ApiError } from "@/lib/api";
import { saleBuyer } from "@/lib/sale-buyer.mjs";
import { formatHistoricalMoney, parseCustomerSaleDetail, parseCustomerSales, parseCustomerSearch, saleStatuses,
  type HistoryCustomer, type HistoryPage, type HistoricalSaleDetail } from "@/lib/customer-sales.mjs";

const labels = { DRAFT: "Borrador", CONFIRMED: "Confirmada", DELIVERED: "Entregada", CANCELLED: "Cancelada", RETURNED: "Devuelta" };
const message = (error: unknown) => error instanceof ApiError && error.status === 401
  ? "Tu sesión expiró. Inicia sesión de nuevo." : error instanceof Error ? error.message : "No se pudo consultar. Puedes reintentar.";

export default function CustomerSalesHistory() {
  const [q, setQ] = useState("");
  const [search, setSearch] = useState<{ customers: HistoryCustomer[]; hasMore: boolean } | null>(null);
  const [searchPage, setSearchPage] = useState(1);
  const [searchError, setSearchError] = useState("");
  const [searching, setSearching] = useState(false);
  const [customer, setCustomer] = useState<HistoryCustomer | null>(null);
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState<HistoryPage | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState<HistoricalSaleDetail | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const searchVersion = useRef(0), listVersion = useRef(0), detailVersion = useRef(0);
  const detailHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (detail) detailHeading.current?.focus(); }, [detail]);

  function resetSales() {
    listVersion.current++; detailVersion.current++;
    setPage(null); setCursor(null); setError(""); setLoading(false);
    setDetail(null); setDetailId(null); setDetailError(""); setDetailLoading(false);
  }
  async function findCustomers(targetPage: number) {
    const version = ++searchVersion.current;
    setSearching(true); setSearchError(""); setSearch(null); setSearchPage(targetPage);
    setCustomer(null); resetSales();
    try {
      const result = parseCustomerSearch(await apiRequest<unknown>(`/customers?${new URLSearchParams({ q, status: "all", page: String(targetPage) })}`), targetPage);
      if (version === searchVersion.current) setSearch(result);
    } catch (e) { if (version === searchVersion.current) setSearchError(message(e)); }
    finally { if (version === searchVersion.current) setSearching(false); }
  }
  async function loadSales(targetCursor: string | null) {
    if (!customer) return;
    const version = ++listVersion.current;
    detailVersion.current++; setDetail(null); setDetailId(null); setDetailError(""); setDetailLoading(false);
    setLoading(true); setError(""); setPage(null); setCursor(targetCursor);
    try {
      const query = new URLSearchParams({ status }); if (targetCursor) query.set("cursor", targetCursor);
      const result = parseCustomerSales(await apiRequest<unknown>(`/customers/${customer.id}/sales?${query}`), customer.id, status, targetCursor);
      if (version === listVersion.current) setPage(result);
    } catch (e) { if (version === listVersion.current) setError(message(e)); }
    finally { if (version === listVersion.current) setLoading(false); }
  }
  async function openSale(id: string) {
    if (!customer) return;
    const version = ++detailVersion.current;
    setDetailId(id); setDetail(null); setDetailError(""); setDetailLoading(true);
    try {
      const result = parseCustomerSaleDetail(await apiRequest<unknown>(`/sales/${id}`), id, customer.id);
      if (version === detailVersion.current) setDetail(result);
    } catch (e) { if (version === detailVersion.current) setDetailError(message(e)); }
    finally { if (version === detailVersion.current) setDetailLoading(false); }
  }
  return <section aria-label="Ventas vinculadas a un cliente" className="space-y-3 rounded border p-4">
    <h2 className="text-lg font-semibold">Ventas vinculadas a un cliente</h2>
    <p>Solo aparecen ventas asociadas expresamente. Los totales registrados no indican pagos recibidos.</p>
    <form onSubmit={e => { e.preventDefault(); void findCustomers(1); }} className="flex flex-wrap gap-2">
      <label>Nombre o teléfono del cliente<input className="block rounded border p-2" maxLength={160} value={q} onChange={e => {
        setQ(e.target.value); searchVersion.current++; setSearching(false); setSearch(null); setSearchError(""); setCustomer(null); resetSales();
      }} /></label>
      <button className="min-h-11 rounded border px-3" disabled={searching}>Buscar clientes</button>
    </form>
    <div aria-live="polite">{searching && <p>Buscando clientes…</p>}{search && !search.customers.length && <p>No se encontraron clientes en esta página.</p>}</div>
    {searchError && <div role="alert"><p>{searchError}</p><button onClick={() => void findCustomers(searchPage)}>Reintentar búsqueda</button></div>}
    {search && <><label>Cliente<select className="block min-h-11 rounded border p-2" value={customer?.id ?? ""} onChange={e => { setCustomer(search.customers.find(c => c.id === e.target.value) ?? null); resetSales(); }}>
      <option value="">Selecciona un cliente</option>{search.customers.map(c => <option key={c.id} value={c.id}>{c.fullName} · {c.archivedAt ? "Archivado" : "Activo"}</option>)}
    </select></label><div className="flex gap-3">
      {searchPage > 1 && <button onClick={() => void findCustomers(searchPage - 1)}>Clientes anteriores</button>}
      {search.hasMore && <button onClick={() => void findCustomers(searchPage + 1)}>Más clientes</button>}
    </div></>}
    <label>Estado de venta<select className="ml-2 min-h-11 rounded border p-2" value={status} onChange={e => { setStatus(e.target.value); resetSales(); }}>
      <option value="all">Todos los estados</option>{saleStatuses.map(s => <option key={s} value={s}>{labels[s]}</option>)}
    </select></label>
    <button className="ml-2 min-h-11 rounded border px-3" disabled={!customer || loading} onClick={() => void loadSales(null)}>Consultar ventas</button>
    <div aria-live="polite">{loading && <p>Cargando ventas…</p>}</div>
    {error && <div role="alert"><p>{error}</p><button onClick={() => void loadSales(cursor)}>Reintentar ventas</button></div>}
    {page && <div className="space-y-3"><h3>{page.customer.fullName} · {page.customer.archivedAt ? "Archivado" : "Activo"}</h3>
      {!page.sales.length && <p>No hay ventas vinculadas en esta página.</p>}
      <ul className="space-y-2">{page.sales.map(s => <li key={s.id} className="rounded border p-2">
        <p>Venta {s.id} · {new Date(s.createdAt).toLocaleString("es-CO")} · {labels[s.status]}</p>
        <p>Comprador histórico: {s.customerNameSnapshot ?? s.customerName ?? "No registrado"}</p>
        <p>Total registrado: {formatHistoricalMoney(s.total, s.currency)}</p>
        <button className="min-h-11 underline" onClick={() => void openSale(s.id)}>Ver líneas de venta {s.id.slice(0, 8)}</button>
      </li>)}</ul>
      {page.nextCursor && <button className="min-h-11 rounded border p-2" onClick={() => void loadSales(page.nextCursor)}>Siguiente página de ventas</button>}
      {cursor && <button className="ml-2 min-h-11 rounded border p-2" onClick={() => void loadSales(null)}>Volver al inicio</button>}
    </div>}
    <div aria-live="polite">{detailLoading && <p>Cargando detalle…</p>}</div>
    {detailError && <div role="alert"><p>{detailError}</p><button onClick={() => { if (detailId) void openSale(detailId); }}>Reintentar detalle</button></div>}
    {detail && <section aria-label="Detalle histórico de venta" className="space-y-2 rounded border p-3">
      <h3 ref={detailHeading} tabIndex={-1} className="focus-visible:outline-2">Venta {detail.id} · {labels[detail.status]}</h3>
      <p>Comprador histórico: {saleBuyer(detail).name ?? "No registrado"}</p>
      <p>Teléfono histórico: {saleBuyer(detail).phone ?? "No registrado"} · Correo histórico: {saleBuyer(detail).email ?? "No registrado"}</p>
      <p>Total registrado: {formatHistoricalMoney(detail.total, detail.currency)}</p>
      <ul>{detail.lines.map(l => <li key={l.id} className="border-b py-2">{l.itemName} · SKU {l.sku} · Cantidad {l.quantity} · Precio unitario {formatHistoricalMoney(l.unitPrice, detail.currency)} · Descuento unitario {formatHistoricalMoney(l.unitDiscount, detail.currency)} · Total de línea {formatHistoricalMoney(l.lineTotal, detail.currency)}</li>)}</ul>
      {!detail.lines.length && <p>No hay líneas registradas.</p>}
    </section>}
  </section>;
}
