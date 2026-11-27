"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search, User, X } from "lucide-react";
import { apiRequest, ApiError } from "@/lib/api";
import { Sheet, panelSelect } from "@/components/expenses/Sheet";
import { focus } from "@/components/sell/CustomerField";
import VenderHeader from "@/components/sell/VenderHeader";
import { buyerName, describeFailure, displayStatus, formatDate, itemCount, parseSale, parseSaleList, type Sale } from "@/lib/sales-ui.mjs";
import { parseCustomerSales, parseCustomerSearch, type HistoryCustomer } from "@/lib/customer-sales.mjs";
import { apiStatusOf, FILTER_LABELS, filterSales, HISTORY_FILTERS, rowMoney, saleIdFrom, type HistoryFilter } from "@/lib/sale-detail-ui.mjs";
import { formatPesos } from "@/lib/pos-ui.mjs";
import SaleDetailPanel from "./SaleDetailPanel";
import StatusPill from "./StatusPill";
import { useMediaQuery } from "./useMediaQuery";

type Failure = ReturnType<typeof describeFailure>;
type CustomerPages = { customer: HistoryCustomer; filter: HistoryFilter; sales: Sale[]; nextCursor: string | null };
const message = (error: unknown) => error instanceof ApiError && error.status === 401 ? "Tu sesión expiró. Inicia sesión de nuevo." : error instanceof Error ? error.message : "No se pudo consultar. Puedes reintentar.";

/** Runs `work` over `values` with at most `limit` requests at a time, keeping the order. */
async function pool<T, R>(values: T[], limit: number, work: (value: T) => Promise<R>) {
  const out: R[] = new Array(values.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => { while (next < values.length) { const index = next++; out[index] = await work(values[index]); } }));
  return out;
}

/**
 * Vender › Historial (F2a-3b). The 50 most recent sales (GET /sales, with the server's paid and balance), filtered by
 * status (including «Devuelta parcialmente») or by customer. The customer filter is the former «Ventas vinculadas a
 * un cliente»: GET /customers/:id/sales with its cursor pages, each row completed with GET /sales/:id when it is not
 * among the recent ones. The detail opens at the right like the ticket (a bottom sheet on mobile) and has its own
 * link, /dashboard/ventas/historial?venta=<id>.
 */
export default function HistoryPanel() {
  const params = useSearchParams(), router = useRouter(), pathname = usePathname();
  const selectedId = saleIdFrom(params.get("venta"));
  const desktop = useMediaQuery("(min-width: 1024px)");
  const [revision, setRevision] = useState(0);
  const [recent, setRecent] = useState<{ revision: number; sales: Sale[] | null; error: Failure | null } | null>(null);
  const [lastSales, setLastSales] = useState<Sale[] | null>(null);
  const [filter, setFilter] = useState<HistoryFilter>("all");
  const [q, setQ] = useState("");
  const [found, setFound] = useState<{ page: number; customers: HistoryCustomer[]; hasMore: boolean } | null>(null);
  const [searching, setSearching] = useState(false), [searchError, setSearchError] = useState("");
  const [customer, setCustomer] = useState<HistoryCustomer | null>(null);
  const [pages, setPages] = useState<CustomerPages | null>(null);
  const [pagesLoading, setPagesLoading] = useState(false), [pagesError, setPagesError] = useState("");
  const searchVersion = useRef(0), pagesVersion = useRef(0);
  const reloadRecent = useCallback(() => setRevision(value => value + 1), []);

  useEffect(() => {
    let active = true;
    apiRequest<unknown>("/sales").then(parseSaleList).then(
      list => { if (active) { setRecent({ revision, sales: list, error: null }); setLastSales(list); } },
      cause => { if (active) setRecent({ revision, sales: null, error: describeFailure(cause) }); });
    return () => { active = false; };
  }, [revision]);
  const recentLoading = recent?.revision !== revision;
  const recentError = recentLoading ? null : recent?.error ?? null;
  const byId = useMemo(() => new Map((lastSales ?? []).map(sale => [sale.id, sale])), [lastSales]);

  function open(id: string) { router.replace(`${pathname}?venta=${id}`, { scroll: false }); }
  function close() { router.replace(pathname, { scroll: false }); }

  async function findCustomers(page: number) {
    const version = ++searchVersion.current;
    setSearching(true); setSearchError("");
    try {
      const result = parseCustomerSearch(await apiRequest<unknown>(`/customers?${new URLSearchParams({ q: q.trim(), status: "all", page: String(page) })}`), page);
      if (version === searchVersion.current) setFound({ page, ...result });
    } catch (cause) { if (version === searchVersion.current) setSearchError(message(cause)); }
    finally { if (version === searchVersion.current) setSearching(false); }
  }
  /** One page of a customer's sales; each row is a full sale (recent list or GET /sales/:id). */
  const loadCustomerPage = useCallback(async (target: HistoryCustomer, wanted: HistoryFilter, cursor: string | null, known: Map<string, Sale>) => {
    const version = ++pagesVersion.current;
    setPagesLoading(true); setPagesError("");
    if (!cursor) setPages(null);
    try {
      const query = new URLSearchParams({ status: apiStatusOf(wanted) }); if (cursor) query.set("cursor", cursor);
      const page = parseCustomerSales(await apiRequest<unknown>(`/customers/${target.id}/sales?${query}`), target.id, apiStatusOf(wanted), cursor);
      const full = await pool(page.sales, 4, async row => known.get(row.id) ?? parseSale((await apiRequest<{ result?: unknown }>(`/sales/${row.id}`))?.result));
      if (version !== pagesVersion.current) return;
      setPages(current => ({ customer: page.customer, filter: wanted, sales: [...(cursor && current ? current.sales : []), ...full], nextCursor: page.nextCursor }));
    } catch (cause) { if (version === pagesVersion.current) setPagesError(message(cause)); }
    finally { if (version === pagesVersion.current) setPagesLoading(false); }
  }, []);
  function chooseCustomer(next: HistoryCustomer | null) {
    setCustomer(next); setFound(null); setQ(""); pagesVersion.current++; setPages(null); setPagesError(""); setPagesLoading(false);
    if (next) void loadCustomerPage(next, filter, null, byId);
  }
  function chooseFilter(next: HistoryFilter) {
    setFilter(next);
    if (customer) void loadCustomerPage(customer, next, null, byId);
  }
  /** After an action in the detail: the recent list is read again and the changed sale is replaced in the customer pages. */
  const changed = useCallback((saleId: string) => {
    reloadRecent();
    apiRequest<{ result?: unknown }>(`/sales/${saleId}`).then(reply => parseSale(reply?.result)).then(
      sale => setPages(current => current ? { ...current, sales: current.sales.map(row => row.id === sale.id ? sale : row) } : current), () => undefined);
  }, [reloadRecent]);

  const source = customer ? pages?.sales ?? null : lastSales;
  const visible = source ? filterSales(source, filter) : null;
  const listLoading = customer ? pagesLoading && !pages : recentLoading && !lastSales;
  const listError = customer ? pagesError : recentError ? `${recentError.title}. ${recentError.detail}` : "";
  const detail = selectedId ? <SaleDetailPanel key={selectedId} saleId={selectedId} onClose={close} onChanged={changed} /> : null;

  return <main className="vy-theme mx-auto w-full max-w-7xl space-y-5 px-4 pb-28 pt-5 sm:px-8 lg:pb-8 lg:pt-4">
    <VenderHeader current="history" title="Historial" subtitle="Tus ventas, sus pagos y lo que falta por cobrar o entregar" />

    <div className={`grid gap-5 lg:items-start ${selectedId ? "lg:grid-cols-[minmax(0,1fr)_24rem] xl:grid-cols-[minmax(0,1fr)_28rem]" : ""}`}>
      <section aria-labelledby="history-list-title" className="min-w-0 space-y-4 rounded-3xl bg-white p-4 shadow-[0_24px_60px_-40px_rgba(1,28,79,0.55)] sm:p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id="history-list-title" className="text-xl font-bold text-[var(--vy-text)]">{customer ? `Ventas de ${customer.fullName}` : "Ventas"}</h2>
          <label htmlFor="history-status" className="grid min-w-0 gap-1 text-sm font-medium text-[var(--vy-text)] max-sm:w-full">Estado
            <select id="history-status" value={filter} onChange={event => chooseFilter(event.target.value as HistoryFilter)} className={`${panelSelect} sm:w-56`}>
              {HISTORY_FILTERS.map(value => <option key={value} value={value}>{FILTER_LABELS[value]}</option>)}
            </select></label>
        </div>

        <div className="space-y-2" aria-label="Filtrar por cliente" role="group">
          {customer ? <div data-history-customer className="flex min-h-12 items-center gap-3 rounded-2xl border border-[var(--vy-border)] bg-[var(--vy-surface-soft)] px-3">
            <User aria-hidden="true" className="size-5 shrink-0 text-[var(--vy-blue-600)]" />
            <span className="min-w-0 flex-1 truncate text-sm"><span className="font-semibold text-[var(--vy-text)]">Cliente: {customer.fullName}</span>{customer.archivedAt ? <span className="text-[var(--vy-text-muted)]"> · Archivado</span> : null}</span>
            <button type="button" onClick={() => chooseCustomer(null)} aria-label={`Quitar el filtro de ${customer.fullName}`} className={`grid size-11 shrink-0 place-items-center rounded-xl hover:bg-white ${focus}`}><X aria-hidden="true" className="size-5" /></button>
          </div> : <form onSubmit={event => { event.preventDefault(); void findCustomers(1); }} className="flex items-center gap-2 rounded-2xl border border-[var(--vy-field-border)] bg-white pl-3 focus-within:border-[var(--vy-blue-600)] focus-within:ring-4 focus-within:ring-[#0450E5]/25">
            <User aria-hidden="true" className="size-5 shrink-0 text-[var(--vy-text-muted)]" />
            <label htmlFor="history-customer-q" className="sr-only">Filtrar por cliente: nombre o teléfono</label>
            <input id="history-customer-q" maxLength={160} value={q} autoComplete="off" placeholder="Filtrar por cliente (nombre o teléfono)"
              onChange={event => { setQ(event.target.value); searchVersion.current++; setSearching(false); setFound(null); setSearchError(""); }}
              className="min-h-12 w-full min-w-0 bg-transparent text-[var(--vy-text)] outline-none placeholder:text-[var(--vy-text-subtle)]" />
            <button type="submit" disabled={searching} aria-label="Buscar clientes" className={`mr-1 grid size-11 shrink-0 place-items-center rounded-xl text-[var(--vy-text-muted)] hover:bg-[var(--vy-surface-soft)] ${focus}`}><Search aria-hidden="true" className="size-5" /></button>
          </form>}
          {searching && <p role="status" className="text-sm text-[var(--vy-text-muted)]">Buscando clientes…</p>}
          {searchError && <p role="alert" className="text-sm text-[#B42318]">{searchError} <button type="button" onClick={() => void findCustomers(found?.page ?? 1)} className={`ml-1 font-semibold underline ${focus}`}>Reintentar búsqueda</button></p>}
          {found && !customer && <div role="group" aria-label="Clientes encontrados" className="rounded-2xl border border-[var(--vy-border)] bg-white p-1">
            {found.customers.length === 0 ? <p role="status" className="px-3 py-2 text-sm text-[var(--vy-text-muted)]">No se encontraron clientes{found.page > 1 ? " en esta página" : ""}.</p>
              : found.customers.map(c => <button key={c.id} type="button" onClick={() => chooseCustomer(c)} className={`flex min-h-11 w-full items-center justify-between gap-3 rounded-xl px-3 text-left text-sm hover:bg-[var(--vy-surface-soft)] ${focus}`}>
                <span className="truncate font-semibold text-[var(--vy-text)]">{c.fullName}</span>{c.archivedAt && <span className="shrink-0 text-[var(--vy-text-muted)]">Archivado</span>}</button>)}
            {(found.page > 1 || found.hasMore) && <div className="flex gap-2 p-1">
              {found.page > 1 && <button type="button" onClick={() => void findCustomers(found.page - 1)} className={`min-h-11 rounded-xl px-3 text-sm font-semibold text-[var(--vy-blue-600)] ${focus}`}>Clientes anteriores</button>}
              {found.hasMore && <button type="button" onClick={() => void findCustomers(found.page + 1)} className={`min-h-11 rounded-xl px-3 text-sm font-semibold text-[var(--vy-blue-600)] ${focus}`}>Más clientes</button>}
            </div>}
          </div>}
        </div>

        <p className="text-sm text-[var(--vy-text-muted)]">{customer ? "Solo aparecen las ventas vinculadas a este cliente." : lastSales ? `${lastSales.length === 1 ? "La venta más reciente" : `Las ${lastSales.length} ventas más recientes`} (máximo 50). Para ver más de un cliente, fíltralo.` : ""}</p>
        {listLoading && <p role="status" className="text-sm text-[var(--vy-text-muted)]">Cargando ventas…</p>}
        {listError && <div role="alert" className="space-y-2 rounded-2xl border border-[#F4C7C2] bg-[#FEF3F2] p-4 text-sm text-[#7A271A]"><p>{listError}</p>
          <button type="button" onClick={() => customer ? void loadCustomerPage(customer, filter, null, byId) : reloadRecent()} className={`min-h-11 rounded-xl border border-[#A9B5CC] bg-white px-3 font-semibold text-[var(--vy-text)] ${focus}`}>Reintentar</button></div>}
        {visible && visible.length === 0 && !listLoading && <p className="text-sm text-[var(--vy-text-muted)]">{source?.length ? "No hay ventas con este estado." : customer ? "Este cliente no tiene ventas vinculadas." : <>Aún no hay ventas. Registra la primera en <Link href="/dashboard/ventas" className={`font-semibold text-[var(--vy-blue-600)] underline ${focus}`}>Nueva venta</Link>.</>}</p>}
        {visible && visible.length > 0 && <ul aria-label="Ventas" className="space-y-2">{visible.map(sale => {
          const money = rowMoney(sale), selected = sale.id === selectedId, units = itemCount(sale), buyer = buyerName(sale) ?? "Sin cliente";
          return <li key={sale.id}>
            <button type="button" data-sale-row={sale.id} aria-current={selected ? "true" : undefined} onClick={() => open(sale.id)}
              className={`grid w-full gap-1.5 rounded-2xl border p-3 text-left text-sm transition hover:border-[var(--vy-blue-600)] ${selected ? "border-2 border-[var(--vy-blue-600)] bg-[#F5F8FF]" : "border-[var(--vy-border)] bg-white"} ${focus}`}>
              <span className="flex items-start justify-between gap-3"><span className="min-w-0 break-words font-semibold text-[var(--vy-text)]">{buyer}</span><span className="shrink-0 text-base font-bold text-[var(--vy-text)]">{formatPesos(sale.total)}</span></span>
              <span className="text-[var(--vy-text-muted)]">{formatDate(sale.createdAt) ?? "Sin fecha"} · {units} artículo{units === 1 ? "" : "s"}</span>
              <span className="flex flex-wrap items-center justify-between gap-2">
                {money ? <span data-row-money className="flex flex-wrap gap-x-3 text-[var(--vy-text)]"><span>Pagado <strong>{formatPesos(money.paid)}</strong></span>
                  {money.refundDue !== "0" ? <span className="text-[#B42318]">Por devolver <strong>{formatPesos(money.refundDue)}</strong></span>
                    : <span className={money.balance !== "0" ? "text-[#B93815]" : undefined}>Saldo <strong>{formatPesos(money.balance)}</strong></span>}</span>
                  : <span data-row-legacy className="rounded-full bg-[var(--vy-surface-soft)] px-2 py-0.5 text-xs text-[var(--vy-text-muted)]">sin registro de pagos</span>}
                <StatusPill status={displayStatus(sale)} />
              </span>
            </button>
          </li>;
        })}</ul>}
        {customer && pages?.nextCursor && <button type="button" disabled={pagesLoading} onClick={() => void loadCustomerPage(customer, filter, pages.nextCursor, byId)} className={`min-h-11 rounded-xl border border-[#A9B5CC] bg-white px-4 font-semibold text-[var(--vy-text)] ${focus}`}>{pagesLoading ? "Cargando…" : "Más ventas de este cliente"}</button>}
      </section>

      {detail && desktop && <aside aria-label="Detalle de la venta" data-detail-panel className="rounded-3xl bg-white p-5 shadow-[0_24px_60px_-40px_rgba(1,28,79,0.55)] lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto">{detail}</aside>}
    </div>
    <Sheet open={Boolean(detail) && !desktop} onOpenChange={value => { if (!value) close(); }} title="Detalle de la venta">{!desktop && detail}</Sheet>
  </main>;
}
