"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { apiRequest } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { selectClass } from "@/components/sales/CustomerPicker";
import FailureNotice from "@/components/sales/FailureNotice";
import { useSafeCommand } from "@/components/common/useSafeCommand";
import { bogotaToday, describeExpenseFailure, EXPENSE_STATUS_LABELS, EXPENSE_STATUS_TONES, formatCop, formatExpenseDate, monthRange, parseCategories, parseExpensePage,
  parseSummary, PAYMENT_LABELS, PAYMENT_METHODS, previousMonthRange, validRange, yearRange, type Expense, type ExpenseCategory, type ExpenseSummary } from "@/lib/expenses-ui.mjs";
import ExpenseForm from "./ExpenseForm";
import ExpenseDetail from "./ExpenseDetail";
import ExpenseCategories from "./ExpenseCategories";

type Filters = { from: string; to: string; categoryId: string; paymentMethod: string; status: string };
type Failure = ReturnType<typeof describeExpenseFailure>;
const query = (f: Filters, extra: Record<string, string> = {}) => new URLSearchParams({ from: f.from, to: f.to, ...(f.categoryId ? { categoryId: f.categoryId } : {}), ...(f.paymentMethod ? { paymentMethod: f.paymentMethod } : {}), ...extra }).toString();

export default function ExpensesPanel() {
  const [today] = useState(() => bogotaToday());
  // Categories: the first load seeds the suggested ones (the only write when opening Gastos).
  const [catRevision, setCatRevision] = useState(0);
  const [catResult, setCatResult] = useState<{ revision: number; categories: ExpenseCategory[] | null; error: Failure | null } | null>(null);
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const seeded = useRef(false);
  useEffect(() => {
    let active = true;
    const request = seeded.current ? apiRequest<unknown>("/expense-categories?status=all")
      : apiRequest<unknown>("/expense-categories/seed", { method: "POST", body: JSON.stringify({ operationId: crypto.randomUUID(), requestId: crypto.randomUUID() }) });
    request.then(parseCategories).then(
      list => { if (active) { seeded.current = true; setCategories(list); setCatResult({ revision: catRevision, categories: list, error: null }); } },
      cause => { if (active) setCatResult({ revision: catRevision, categories: null, error: describeExpenseFailure(cause) }); });
    return () => { active = false; };
  }, [catRevision]);
  const catError = catResult?.revision === catRevision ? catResult.error : null;

  const [filters, setFilters] = useState<Filters>(() => ({ ...monthRange(today), categoryId: "", paymentMethod: "", status: "CONFIRMED" }));
  const [listRevision, setListRevision] = useState(0);
  const key = JSON.stringify({ filters, listRevision });
  const rangeOk = validRange(filters.from, filters.to);
  // Late replies for an older filter/revision are ignored: they carry a different key.
  const [list, setList] = useState<{ key: string; items: Expense[]; nextCursor: string | null; error: Failure | null } | null>(null);
  const [summary, setSummary] = useState<{ key: string; data: ExpenseSummary | null; error: Failure | null } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  useEffect(() => {
    if (!rangeOk) return;
    let active = true;
    apiRequest<unknown>(`/expenses?${query(filters, { status: filters.status })}`).then(parseExpensePage).then(
      page => { if (active) setList({ key, items: page.items, nextCursor: page.nextCursor, error: null }); },
      cause => { if (active) setList({ key, items: [], nextCursor: null, error: describeExpenseFailure(cause) }); });
    apiRequest<unknown>(`/expenses/summary?${query(filters)}`).then(parseSummary).then(
      data => { if (active) setSummary({ key, data, error: null }); },
      cause => { if (active) setSummary({ key, data: null, error: describeExpenseFailure(cause) }); });
    return () => { active = false; };
  }, [key, filters, rangeOk]);
  const current = list?.key === key ? list : null, currentSummary = summary?.key === key ? summary : null;
  async function more() {
    if (!current?.nextCursor) return;
    const requested = key; setLoadingMore(true);
    try {
      const page = parseExpensePage(await apiRequest<unknown>(`/expenses?${query(filters, { status: filters.status, cursor: current.nextCursor })}`));
      setList(prev => prev && prev.key === requested ? { ...prev, items: [...prev.items, ...page.items], nextCursor: page.nextCursor } : prev);
    } catch (cause) { setList(prev => prev && prev.key === requested ? { ...prev, error: describeExpenseFailure(cause) } : prev); }
    finally { setLoadingMore(false); }
  }

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const command = useSafeCommand(describeExpenseFailure);
  const refresh = () => setListRevision(v => v + 1);
  const setFilter = (patch: Partial<Filters>) => setFilters(f => ({ ...f, ...patch }));
  const categoryName = (id: string) => categories.find(c => c.id === id)?.name ?? "Categoría";

  return <main className="mx-auto max-w-6xl space-y-6 px-5 py-8 sm:px-8">
    <Link href="/dashboard" className="inline-flex min-h-11 items-center underline">← Catálogos</Link>
    <div>
      <h1 className="text-3xl font-semibold">Gastos</h1>
      <p className="mt-2 text-sm text-[#52675b]">Gastos operativos de contado: arriendo, servicios, transporte, publicidad, nómina y similares. Un gasto confirmado se corrige anulándolo y registrando el correcto.</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <p className="inline-flex rounded-lg border border-[#ecd3a3] bg-[#fdf5e6] px-3 py-1.5 text-sm font-medium text-[#7a4f0b]">Las compras de mercancía se registran como entrada de inventario, no como gasto.</p>
        <p className="inline-flex rounded-lg border border-[#dce4dc] bg-white px-3 py-1.5 text-sm text-[#52675b]">IVA y retenciones no se gestionan: el monto es el total pagado.</p>
      </div>
    </div>

    {catError && <FailureNotice failure={{ ...catError, action: catError.action === "login" ? "login" : "reload" }} busy={false} onReload={() => setCatRevision(v => v + 1)} reloadLabel="Reintentar cargar categorías" />}
    {!catResult && <p role="status">Preparando tus categorías…</p>}

    <section aria-labelledby="new-expense" className="space-y-3 rounded-2xl border border-[#dce4dc] bg-white p-5">
      <h2 id="new-expense" className="text-xl font-semibold">Registrar gasto</h2>
      {categories.length > 0 && <ExpenseForm idPrefix="new-expense" categories={categories} today={today} recent={current?.items ?? []} busy={command.busy !== null} submitLabel="Registrar gasto"
        onSubmit={(payload, reset) => { setMessage(""); void command.run({ action: "create", resourceId: "new", path: "/expenses", method: "POST", body: payload, withRequestId: true, label: "Registrando gasto…" },
          reply => { reset(); setMessage("Gasto registrado."); refresh(); const id = (reply as { result?: { expense?: { id?: string } } })?.result?.expense?.id; if (id) setSelectedId(id); }); }} />}
      <p role="status" className="text-sm">{command.busy ?? message}</p>
      {command.failure && <FailureNotice failure={command.failure} busy={command.busy !== null} onRetry={() => void command.retry()} onReload={() => { command.clearFailure(); setCatRevision(v => v + 1); refresh(); }} reloadLabel="Recargar" />}
    </section>

    <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] xl:items-start">
      <section aria-labelledby="expense-list" className="space-y-4 rounded-2xl border border-[#dce4dc] bg-white p-5">
        <h2 id="expense-list" className="text-xl font-semibold">Gastos del periodo</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label htmlFor="filter-from" className="grid gap-1 text-sm font-medium">Desde<Input id="filter-from" type="date" value={filters.from} max={today} onChange={e => setFilter({ from: e.target.value })} /></label>
          <label htmlFor="filter-to" className="grid gap-1 text-sm font-medium">Hasta<Input id="filter-to" type="date" value={filters.to} max={today} onChange={e => setFilter({ to: e.target.value })} /></label>
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <Button size="sm" variant="secondary" onClick={() => setFilter(monthRange(today))}>Este mes</Button>
            <Button size="sm" variant="secondary" onClick={() => setFilter(previousMonthRange(today))}>Mes anterior</Button>
            <Button size="sm" variant="secondary" onClick={() => setFilter(yearRange(today))}>Este año</Button>
          </div>
          <label htmlFor="filter-category" className="grid gap-1 text-sm font-medium">Categoría<select id="filter-category" className={selectClass} value={filters.categoryId} onChange={e => setFilter({ categoryId: e.target.value })}>
            <option value="">Todas</option>{categories.map(c => <option key={c.id} value={c.id}>{c.name}{c.archivedAt ? " (archivada)" : ""}</option>)}</select></label>
          <label htmlFor="filter-method" className="grid gap-1 text-sm font-medium">Medio de pago<select id="filter-method" className={selectClass} value={filters.paymentMethod} onChange={e => setFilter({ paymentMethod: e.target.value })}>
            <option value="">Todos</option>{PAYMENT_METHODS.map(m => <option key={m} value={m}>{PAYMENT_LABELS[m]}</option>)}</select></label>
          <label htmlFor="filter-status" className="grid gap-1 text-sm font-medium sm:col-span-2">Estado<select id="filter-status" className={selectClass} value={filters.status} onChange={e => setFilter({ status: e.target.value })}>
            <option value="CONFIRMED">Confirmados</option><option value="VOIDED">Anulados</option><option value="all">Todos</option></select></label>
        </div>
        {!rangeOk && <p role="alert" className="text-sm text-[#8a2b20]">Elige un periodo válido de hasta 366 días.</p>}

        {rangeOk && <div aria-live="polite" className="rounded-xl border border-[#e2e8e0] bg-[#fafcf9] p-4 text-sm">
          {!currentSummary && <p role="status">Calculando totales…</p>}
          {currentSummary?.error && <FailureNotice failure={{ ...currentSummary.error, action: currentSummary.error.action === "login" ? "login" : "reload" }} busy={false} onReload={refresh} reloadLabel="Reintentar totales" />}
          {currentSummary?.data && <>
            <p className="font-medium">Total confirmado del periodo con los filtros aplicados</p>
            <p className="text-2xl font-semibold text-[#263b31]" data-expense-total>{formatCop(currentSummary.data.confirmedTotal)}</p>
            <p className="text-[#52675b]">{currentSummary.data.confirmedCount} gasto{currentSummary.data.confirmedCount === 1 ? "" : "s"} confirmado{currentSummary.data.confirmedCount === 1 ? "" : "s"} · {currentSummary.data.voidedCount} anulado{currentSummary.data.voidedCount === 1 ? "" : "s"} (no suman)</p>
            {currentSummary.data.byCategory.length > 0 && <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div><p className="font-medium">Por categoría</p><ul>{currentSummary.data.byCategory.map(c => <li key={c.categoryId} className="flex justify-between gap-2"><span className="min-w-0 break-words">{c.name ?? categoryName(c.categoryId)}{c.archived ? " (archivada)" : ""}</span><span className="whitespace-nowrap">{formatCop(c.total)}</span></li>)}</ul></div>
              <div><p className="font-medium">Por medio de pago</p><ul>{currentSummary.data.byPaymentMethod.map(m => <li key={m.paymentMethod} className="flex justify-between gap-2"><span>{PAYMENT_LABELS[m.paymentMethod]}</span><span className="whitespace-nowrap">{formatCop(m.total)}</span></li>)}</ul></div>
            </div>}
          </>}
        </div>}

        {rangeOk && !current && <p role="status">Cargando gastos…</p>}
        {current?.error && <FailureNotice failure={{ ...current.error, action: current.error.action === "login" ? "login" : "reload" }} busy={false} onReload={refresh} reloadLabel="Reintentar cargar gastos" />}
        {current && !current.error && <>
          {!current.items.length && <p>{filters.status === "CONFIRMED" ? "No hay gastos confirmados en este periodo." : "No hay gastos con estos filtros."}</p>}
          <ul aria-label="Gastos" className="space-y-2">{current.items.map(e => <li key={e.id}>
            <button type="button" aria-current={e.id === selectedId ? "true" : undefined} onClick={() => setSelectedId(e.id)} aria-label={`Abrir gasto ${e.description}, ${e.amount ? formatCop(e.amount) : ""}`}
              className={`grid w-full gap-1 rounded-xl border p-3 text-left text-sm transition hover:border-[#9fc4ae] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-emerald)] sm:grid-cols-[minmax(0,1fr)_auto] ${e.id === selectedId ? "border-[#2f7a52] bg-[#f2faf4]" : "border-[#e2e8e0] bg-white"}`}>
              <span className="min-w-0"><span className="block break-words font-semibold text-[#263b31]">{e.description}</span>
                <span className="block text-[#52675b]">{formatExpenseDate(e.expenseDate)} · {e.categoryName ?? categoryName(e.categoryId)} · {PAYMENT_LABELS[e.paymentMethod]}</span></span>
              <span className="flex flex-wrap items-center gap-2 sm:flex-col sm:items-end">
                <span className={`text-base font-semibold ${e.status === "VOIDED" ? "text-[#68756e] line-through" : "text-[#263b31]"}`}>{e.amount ? formatCop(e.amount) : "—"}</span>
                {e.status !== "CONFIRMED" && <span className={`inline-flex min-h-7 items-center rounded-full border px-2.5 text-xs font-semibold ${EXPENSE_STATUS_TONES[e.status]}`}>{EXPENSE_STATUS_LABELS[e.status]}</span>}
              </span>
            </button>
          </li>)}</ul>
          {current.nextCursor && <Button variant="secondary" loading={loadingMore} disabled={loadingMore} onClick={() => void more()}>Más gastos</Button>}
        </>}
      </section>

      {selectedId ? <ExpenseDetail key={selectedId} expenseId={selectedId} categories={categories} today={today} onChanged={refresh} onOpen={setSelectedId} onClose={() => setSelectedId(null)} />
        : <p className="hidden rounded-2xl border border-dashed border-[#dce4dc] p-5 text-sm text-[#52675b] xl:block">Selecciona un gasto para ver su detalle.</p>}
    </div>

    {categories.length > 0 && <ExpenseCategories categories={categories} onChanged={() => setCatRevision(v => v + 1)} />}
  </main>;
}
