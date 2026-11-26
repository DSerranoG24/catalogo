"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ArrowDown, ArrowUp, Calendar, ChevronLeft, ChevronRight, CircleDollarSign, Home, Landmark, ListChecks, Megaphone, PieChart, Plus, Receipt,
  ReceiptText, Search, ShoppingBag, Tag, Tags, Truck, Users, Wifi, Wrench, X, Zap, type LucideIcon } from "lucide-react";
import { apiRequest } from "@/lib/api";
import FailureNotice from "@/components/sales/FailureNotice";
import { useSafeCommand } from "@/components/common/useSafeCommand";
import { Sparkline } from "@/components/dashboard/SummaryCards";
import { HomeFooter } from "@/components/dashboard/HomeBlocks";
import { compare } from "@/lib/dashboard-ui.mjs";
import { bogotaToday, CATEGORY_STYLES, DEFAULT_CATEGORY_STYLE, dayHeading, describeExpenseFailure, formatCop, formatExpenseDate, groupByDay, matchesSearch,
  monthLabel, monthName, parseCategories, parseExpenseOverview, parseExpensePage, PAYMENT_LABELS, PAYMENT_TONES, shiftMonth,
  type Expense, type ExpenseCategory, type ExpenseOverview } from "@/lib/expenses-ui.mjs";
import ExpenseForm from "./ExpenseForm";
import ExpenseDetail from "./ExpenseDetail";
import ExpenseCategories from "./ExpenseCategories";

type Failure = ReturnType<typeof describeExpenseFailure>;
type Filter = "all" | "VOIDED";
const ICONS: Record<string, LucideIcon> = { home: Home, zap: Zap, wifi: Wifi, truck: Truck, megaphone: Megaphone, wrench: Wrench, "shopping-bag": ShoppingBag, landmark: Landmark, receipt: Receipt, users: Users, tag: Tag };
// Searching loads the rest of the month's pages (25 each) so results are complete, up to this many pages.
const SEARCH_PAGE_LIMIT = 20;
const card = "min-w-0 rounded-2xl border border-[var(--vy-border)] bg-white p-5 shadow-[0_10px_30px_-24px_rgba(1,28,79,0.5)]";
const focus = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#6D28D9]";

/** Modal used for registering, the expense detail and categories (Radix: focus trap, Escape, focus return). */
function Sheet({ open, onOpenChange, title, description, children }: { open: boolean; onOpenChange: (open: boolean) => void; title: string; description?: string; children: ReactNode }) {
  return <Dialog.Root open={open} onOpenChange={onOpenChange}>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-50 bg-[#011C4F]/40" />
      <Dialog.Content {...(description ? {} : { "aria-describedby": undefined })} className="fixed inset-x-0 bottom-0 z-50 max-h-[92vh] overflow-y-auto rounded-t-3xl bg-white p-5 text-[var(--vy-text)] shadow-[0_-20px_60px_-30px_rgba(1,28,79,0.5)] sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-[min(42rem,calc(100vw-2rem))] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-3xl sm:p-7"
        style={{ paddingBottom: "calc(1.25rem + env(safe-area-inset-bottom))" }}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <div><Dialog.Title className="text-xl font-semibold">{title}</Dialog.Title>{description && <Dialog.Description className="mt-1 text-sm text-[var(--vy-text-muted)]">{description}</Dialog.Description>}</div>
          <Dialog.Close aria-label="Cerrar" className={`grid size-11 shrink-0 place-items-center rounded-xl hover:bg-[var(--vy-surface-soft)] ${focus}`}><X aria-hidden="true" className="size-5" /></Dialog.Close>
        </div>
        {children}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}

function CategoryTile({ category, muted }: { category?: ExpenseCategory; muted?: boolean }) {
  const style = (category?.seedKey && CATEGORY_STYLES[category.seedKey]) || DEFAULT_CATEGORY_STYLE;
  const Icon = ICONS[style.icon] ?? Tag;
  return <span aria-hidden="true" className={`grid size-12 shrink-0 place-items-center rounded-2xl ${muted ? "bg-[#F3F4F6] text-[#9CA3AF]" : style.tone}`}><Icon className="size-6" /></span>;
}

/** Gastos (F1a) with the panel design: month, figures, filters, list by day, categories, register and detail. */
export default function ExpensesPanel() {
  const [today] = useState(() => bogotaToday());
  const currentMonth = today.slice(0, 7);
  const [month, setMonth] = useState(currentMonth);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [revision, setRevision] = useState(0);
  const refresh = () => setRevision(v => v + 1);

  // Categories: the first load seeds the suggested ones (idempotent), as in F1a.
  const [catRevision, setCatRevision] = useState(0);
  const [catResult, setCatResult] = useState<{ revision: number; error: Failure | null } | null>(null);
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const seeded = useRef(false);
  useEffect(() => {
    let active = true;
    const request = seeded.current ? apiRequest<unknown>("/expense-categories?status=all")
      : apiRequest<unknown>("/expense-categories/seed", { method: "POST", body: JSON.stringify({ operationId: crypto.randomUUID(), requestId: crypto.randomUUID() }) });
    request.then(parseCategories).then(
      list => { if (active) { seeded.current = true; setCategories(list); setCatResult({ revision: catRevision, error: null }); } },
      cause => { if (active) setCatResult({ revision: catRevision, error: describeExpenseFailure(cause) }); });
    return () => { active = false; };
  }, [catRevision]);
  const catError = catResult?.revision === catRevision ? catResult.error : null;
  const categoryOf = (id: string) => categories.find(c => c.id === id);

  // Month overview (server aggregates). Late replies for another month or revision are ignored by key.
  const overviewKey = `${month}:${revision}`;
  const [overview, setOverview] = useState<{ key: string; data: ExpenseOverview | null; error: Failure | null } | null>(null);
  const [lastOverview, setLastOverview] = useState<ExpenseOverview | null>(null);
  useEffect(() => {
    let active = true;
    apiRequest<unknown>(`/expenses/overview?month=${month}`).then(value => parseExpenseOverview(value, month)).then(
      data => { if (active) { setOverview({ key: overviewKey, data, error: null }); setLastOverview(data); } },
      cause => { if (active) setOverview({ key: overviewKey, data: null, error: describeExpenseFailure(cause) }); });
    return () => { active = false; };
  }, [overviewKey, month]);
  const currentOverview = overview?.key === overviewKey ? overview : null;
  const shown = currentOverview?.data ?? (lastOverview?.month === month ? lastOverview : null);

  // List of the month (pages of 25). Searching loads the remaining pages so the result is complete.
  // The current month runs to today; a past month to its last day (day 0 of the next month).
  const to = month === currentMonth ? today : new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const listKey = `${month}:${filter}:${revision}`;
  const listQuery = (cursor?: string) => new URLSearchParams({ from: `${month}-01`, to, status: filter, ...(cursor ? { cursor } : {}) }).toString();
  const [list, setList] = useState<{ key: string; items: Expense[]; nextCursor: string | null; pages: number; error: Failure | null } | null>(null);
  useEffect(() => {
    let active = true;
    apiRequest<unknown>(`/expenses?${listQuery()}`).then(parseExpensePage).then(
      page => { if (active) setList({ key: listKey, items: page.items, nextCursor: page.nextCursor, pages: 1, error: null }); },
      cause => { if (active) setList({ key: listKey, items: [], nextCursor: null, pages: 0, error: describeExpenseFailure(cause) }); });
    return () => { active = false; };
    // listQuery depends only on month/filter, which are part of listKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listKey]);
  const current = list?.key === listKey ? list : null;
  const [loadingMore, setLoadingMore] = useState(false);
  const searching = search.trim().length > 0;
  const wantMore = Boolean(current?.nextCursor) && searching && (current?.pages ?? 0) < SEARCH_PAGE_LIMIT;
  async function more() {
    if (!current?.nextCursor) return;
    const requested = listKey; setLoadingMore(true);
    try {
      const page = parseExpensePage(await apiRequest<unknown>(`/expenses?${listQuery(current.nextCursor)}`));
      setList(prev => prev && prev.key === requested ? { ...prev, items: [...prev.items, ...page.items], nextCursor: page.nextCursor, pages: prev.pages + 1 } : prev);
    } catch (cause) { setList(prev => prev && prev.key === requested ? { ...prev, error: describeExpenseFailure(cause) } : prev); }
    finally { setLoadingMore(false); }
  }
  useEffect(() => {
    if (!wantMore || !current?.nextCursor) return;
    let active = true;
    const requested = listKey;
    apiRequest<unknown>(`/expenses?${listQuery(current.nextCursor)}`).then(parseExpensePage).then(
      page => { if (active) setList(prev => prev && prev.key === requested ? { ...prev, items: [...prev.items, ...page.items], nextCursor: page.nextCursor, pages: prev.pages + 1 } : prev); },
      cause => { if (active) setList(prev => prev && prev.key === requested ? { ...prev, error: describeExpenseFailure(cause) } : prev); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantMore, current?.nextCursor, listKey]);
  const visible = current ? current.items.filter(item => matchesSearch(item, search)) : [];

  // Register (F1a form and safe submit) and detail.
  const [registerOpen, setRegisterOpen] = useState(false);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const command = useSafeCommand(describeExpenseFailure);
  const openRegister = () => { command.clearFailure(); setMessage(""); setRegisterOpen(true); };

  const change = shown ? compare(shown.total, shown.previousMonth.total) : null;
  const previousName = monthName(shiftMonth(month, -1));
  const registerButton = (extra: string) => <button type="button" onClick={openRegister} disabled={categories.length === 0}
    className={`min-h-12 items-center gap-2 rounded-xl bg-[var(--vy-blue-600)] px-5 font-semibold text-white shadow-[0_14px_28px_-14px_rgba(4,80,229,0.9)] transition hover:bg-[var(--vy-blue-700)] disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--vy-blue-600)] ${extra}`}>
    <Plus aria-hidden="true" className="size-5" />Registrar gasto</button>;

  return <main className="mx-auto w-full max-w-6xl space-y-6 px-5 pb-28 pt-6 sm:px-8 lg:pb-8 lg:pt-4">
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-center gap-4">
        <span aria-hidden="true" className="grid size-16 place-items-center rounded-2xl bg-[linear-gradient(135deg,#F3EEFF,#E4DAFE)] text-[#6D28D9] shadow-[0_12px_24px_-16px_rgba(109,40,217,0.7)]"><ReceiptText className="size-8" /></span>
        <div><h1 className="text-3xl font-bold tracking-tight text-[var(--vy-text)] sm:text-4xl">Gastos</h1><p className="text-base text-[var(--vy-text-muted)] sm:text-lg">Lo que cuesta mantener tu negocio</p></div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <div role="group" aria-label="Mes" className="flex items-center rounded-2xl border border-[var(--vy-border)] bg-white">
          <button type="button" aria-label="Mes anterior" onClick={() => setMonth(m => shiftMonth(m, -1))} className={`grid size-11 place-items-center rounded-l-2xl hover:bg-[var(--vy-surface-soft)] ${focus}`}><ChevronLeft aria-hidden="true" className="size-5" /></button>
          <span aria-live="polite" className="flex min-w-44 items-center justify-center gap-2 px-2 font-semibold text-[var(--vy-text)]"><Calendar aria-hidden="true" className="size-5 text-[var(--vy-blue-600)]" />{monthLabel(month)}</span>
          <button type="button" aria-label="Mes siguiente" disabled={month >= currentMonth} onClick={() => setMonth(m => shiftMonth(m, 1))} className={`grid size-11 place-items-center rounded-r-2xl hover:bg-[var(--vy-surface-soft)] disabled:opacity-40 ${focus}`}><ChevronRight aria-hidden="true" className="size-5" /></button>
        </div>
        <button type="button" onClick={() => setCategoriesOpen(true)} disabled={categories.length === 0} className={`inline-flex min-h-12 items-center gap-2 rounded-xl border border-[var(--vy-border)] bg-white px-4 font-semibold text-[var(--vy-text)] hover:bg-[var(--vy-surface-soft)] disabled:opacity-60 ${focus}`}><Tags aria-hidden="true" className="size-5" />Categorías</button>
        {registerButton("hidden lg:inline-flex")}
      </div>
    </div>

    <p role="status" className="text-sm font-medium text-[#166534] empty:hidden">{message}</p>
    {catError && <FailureNotice failure={{ ...catError, action: catError.action === "login" ? "login" : "reload" }} busy={false} onReload={() => setCatRevision(v => v + 1)} reloadLabel="Reintentar cargar categorías" />}
    {!catResult && <p role="status" className="text-sm text-[var(--vy-text-muted)]">Preparando tus categorías…</p>}

    <section aria-labelledby="expense-figures" aria-busy={!currentOverview}>
      <h2 id="expense-figures" className="sr-only">Cifras de {monthName(month)}</h2>
      {currentOverview?.error && <FailureNotice failure={{ ...currentOverview.error, action: currentOverview.error.action === "login" ? "login" : "reload" }} busy={false} onReload={refresh} reloadLabel="Reintentar cifras" />}
      {shown ? <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <article className="flex flex-col gap-3 rounded-2xl border border-[#E1DAFE] bg-[linear-gradient(135deg,#F7F5FF,#EDE8FF)] p-5 shadow-[0_10px_30px_-24px_rgba(1,28,79,0.5)]">
          <div className="flex items-center gap-3"><span aria-hidden="true" className="grid size-11 place-items-center rounded-full bg-white text-[#6D28D9] shadow-sm"><CircleDollarSign className="size-5" /></span><h3 className="font-medium">Gastos del mes</h3></div>
          <div className="flex flex-1 items-end justify-between gap-3">
            <div className="min-w-0 space-y-1 self-start">
              <p className="break-words text-3xl font-bold tracking-tight text-[var(--vy-text)]" data-expense-total>{formatCop(shown.total)}</p>
              {change === null ? <p className="text-sm text-[var(--vy-text-muted)]">Sin gastos registrados en {previousName}</p>
                : change.direction === "equal" ? <p className="text-sm text-[var(--vy-text-muted)]">Igual que en {previousName}</p>
                : <p className="flex items-center gap-1 text-sm font-medium text-[#5B21B6]">{change.direction === "up" ? <ArrowUp aria-hidden="true" className="size-4" /> : <ArrowDown aria-hidden="true" className="size-4" />}{change.text} vs {previousName}</p>}
            </div>
            <Sparkline values={shown.days.map(d => d.total)} color="#6D28D9" />
          </div>
          <table className="sr-only"><caption>Gasto por día de {monthName(month)}</caption><tbody>{shown.days.filter(d => d.total !== "0").map(d => <tr key={d.date}><th scope="row">{formatExpenseDate(d.date)}</th><td>{formatCop(d.total)}</td></tr>)}</tbody></table>
        </article>
        <article className="flex flex-col gap-3 rounded-2xl border border-[#D6E2FF] bg-[linear-gradient(135deg,#F3F7FF,#E6EEFF)] p-5 shadow-[0_10px_30px_-24px_rgba(1,28,79,0.5)]">
          <div className="flex items-center gap-3"><span aria-hidden="true" className="grid size-11 place-items-center rounded-full bg-white text-[var(--vy-blue-600)] shadow-sm"><ListChecks className="size-5" /></span><h3 className="font-medium">Registros del mes</h3></div>
          <p className="text-3xl font-bold tracking-tight text-[var(--vy-text)]" data-expense-count>{shown.count}</p>
          <p className="text-sm text-[var(--vy-text-muted)]">{shown.count === 1 ? "gasto vigente" : "gastos vigentes"} · {shown.voidedCount === 0 ? "sin anulados" : `${shown.voidedCount} anulado${shown.voidedCount === 1 ? "" : "s"} (no suman)`}</p>
        </article>
      </div> : !currentOverview?.error && <div aria-hidden="true" className="grid gap-4 sm:grid-cols-2"><div className="h-40 animate-pulse rounded-2xl bg-[#EDE8FF]" /><div className="h-40 animate-pulse rounded-2xl bg-[#E6EEFF]" /></div>}
    </section>

    <div className="flex flex-wrap items-center gap-3">
      <div role="group" aria-label="Filtrar gastos" className="flex gap-2">
        {([["all", "Todos"], ["VOIDED", "Anulados"]] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}
          className={`min-h-11 rounded-xl px-5 font-semibold transition ${focus} ${filter === value ? "bg-[var(--vy-blue-600)] text-white" : "border border-[var(--vy-border)] bg-white text-[var(--vy-text)] hover:bg-[var(--vy-surface-soft)]"}`}>{label}</button>)}
      </div>
      <label className="relative min-w-[14rem] flex-1">
        <span className="sr-only">Buscar gasto, categoría o nota</span>
        <Search aria-hidden="true" className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-[var(--vy-text-muted)]" />
        <input id="expense-search" type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar gasto, categoría o nota"
          className="min-h-11 w-full rounded-xl border border-[var(--vy-field-border)] bg-white py-2 pl-12 pr-4 text-base text-[var(--vy-text)] outline-none placeholder:text-[var(--vy-text-subtle)] focus:border-[#6D28D9] focus:ring-4 focus:ring-[#6D28D9]/20" />
      </label>
    </div>

    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:items-start">
      <section aria-labelledby="expense-list" className={card}>
        <h2 id="expense-list" className="flex items-center gap-3 text-lg font-semibold"><ReceiptText aria-hidden="true" className="size-6 text-[var(--vy-blue-600)]" />{filter === "VOIDED" ? `Gastos anulados de ${monthName(month)}` : `Gastos de ${monthName(month)}`}</h2>
        {!current && <div aria-hidden="true" className="mt-4 space-y-3">{[0, 1, 2].map(i => <div key={i} className="h-16 animate-pulse rounded-xl bg-[var(--vy-surface-soft)]" />)}</div>}
        {current?.error && <div className="mt-3"><FailureNotice failure={{ ...current.error, action: current.error.action === "login" ? "login" : "reload" }} busy={false} onReload={refresh} reloadLabel="Reintentar cargar gastos" /></div>}
        {current && !current.error && <>
          {!visible.length && <p className="mt-4 text-[var(--vy-text-muted)]">{searching ? `Ningún gasto coincide con «${search.trim()}».` : filter === "VOIDED" ? "No hay gastos anulados este mes." : "No hay gastos registrados este mes."}</p>}
          {searching && current.nextCursor && !wantMore && <p className="mt-3 text-sm text-[#7a4f0b]">La búsqueda revisó los primeros {current.items.length} gastos del mes.</p>}
          <ul aria-label="Gastos" className="mt-2 space-y-3">{groupByDay(visible).map(group => <li key={group.date}>
            <h3 className="pb-1 pt-2 text-xs font-semibold tracking-wide text-[var(--vy-text-muted)]">{dayHeading(group.date, today)}</h3>
            <ul className="divide-y divide-[var(--vy-border)]">{group.items.map(e => {
              const voided = e.status === "VOIDED";
              return <li key={e.id}>
                <button type="button" onClick={() => setSelectedId(e.id)} aria-label={`Abrir gasto ${e.description}, ${e.amount ? formatCop(e.amount) : ""}${voided ? ", anulado" : ""}`}
                  className={`flex w-full items-center gap-3 rounded-xl px-1 py-3 text-left transition hover:bg-[var(--vy-surface-soft)] ${focus}`}>
                  <CategoryTile category={categoryOf(e.categoryId)} muted={voided} />
                  <span className="min-w-0 flex-1">
                    <span className={`block break-words font-semibold ${voided ? "text-[var(--vy-text-muted)] line-through" : "text-[var(--vy-text)]"}`}>{e.description}</span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-[var(--vy-text-muted)]">
                      <span>{e.categoryName ?? e.categoryNameSnapshot ?? "Categoría"}</span>
                      {voided ? <><span className="rounded-full bg-[#FDECEA] px-2 py-0.5 text-xs font-semibold text-[#B42318]">Anulado</span>{e.voidReason && <span className="break-words">· {e.voidReason}</span>}</>
                        : <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${PAYMENT_TONES[e.paymentMethod]}`}>{PAYMENT_LABELS[e.paymentMethod]}{e.paymentMethodNote ? ` · ${e.paymentMethodNote}` : ""}</span>}
                    </span>
                  </span>
                  <span className={`shrink-0 text-lg font-bold ${voided ? "text-[var(--vy-text-muted)] line-through" : "text-[var(--vy-text)]"}`}>{e.amount ? formatCop(e.amount) : "—"}</span>
                </button>
              </li>;
            })}</ul>
          </li>)}</ul>
          {current.nextCursor && !searching && <button type="button" onClick={() => void more()} disabled={loadingMore} className={`mt-3 min-h-11 rounded-xl border border-[var(--vy-border)] px-4 font-semibold hover:bg-[var(--vy-surface-soft)] disabled:opacity-60 ${focus}`}>Más gastos</button>}
        </>}
      </section>

      <section aria-labelledby="expense-categories-share" className={card}>
        <h2 id="expense-categories-share" className="flex items-center gap-3 text-lg font-semibold"><PieChart aria-hidden="true" className="size-6 text-[#6D28D9]" />¿En qué se va la plata?</h2>
        {!shown ? <div aria-hidden="true" className="mt-4 h-40 animate-pulse rounded-xl bg-[var(--vy-surface-soft)]" />
          : shown.byCategory.length ? <ul className="mt-4 space-y-4">{shown.byCategory.map(c => <li key={c.categoryId}>
            <p className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm"><span className="font-semibold text-[var(--vy-text)]">{c.name}{c.archived ? " (archivada)" : ""}</span><span className="text-[var(--vy-text-muted)]">{formatCop(c.total)} · {c.percent}%</span></p>
            <div aria-hidden="true" className="mt-1.5 h-3 rounded-full bg-[#EDE8FF]"><div className="h-3 rounded-full bg-[linear-gradient(90deg,#7C3AED,#5B21B6)]" style={{ width: `${Math.max(Number(c.percent), 1)}%` }} /></div>
          </li>)}</ul> : <p className="mt-4 text-[var(--vy-text-muted)]">Aún no hay gastos vigentes este mes.</p>}
      </section>
    </div>

    <HomeFooter generatedAt={shown?.generatedAt ?? null} connected={!currentOverview?.error && !current?.error} />

    {/* Mobile: register stays reachable above the bottom navigation. */}
    <div className="fixed inset-x-0 z-30 flex justify-end px-4 lg:hidden" style={{ bottom: "calc(4.75rem + env(safe-area-inset-bottom))" }}>{registerButton("inline-flex")}</div>

    <Sheet open={registerOpen} onOpenChange={open => { if (!open && command.busy === null) setRegisterOpen(false); }} title="Registrar gasto"
      description="Gastos operativos de contado. Las compras de mercancía se registran como entrada de inventario, no como gasto. IVA y retenciones no se gestionan: el monto es el total pagado.">
      {categories.length > 0 && <ExpenseForm idPrefix="new-expense" categories={categories} today={today} recent={current?.items ?? []} busy={command.busy !== null} submitLabel="Guardar gasto"
        onSubmit={(payload, reset) => { setMessage(""); void command.run({ action: "create", resourceId: "new", path: "/expenses", method: "POST", body: payload, withRequestId: true, label: "Registrando gasto…" },
          reply => { reset(); setRegisterOpen(false); setMessage("Gasto registrado."); refresh(); const id = (reply as { result?: { expense?: { id?: string } } })?.result?.expense?.id; if (id) setSelectedId(id); }); }} />}
      <p role="status" className="mt-2 text-sm empty:hidden">{command.busy}</p>
      {command.failure && <div className="mt-3"><FailureNotice failure={command.failure} busy={command.busy !== null} onRetry={() => void command.retry()} onReload={() => { command.clearFailure(); setCatRevision(v => v + 1); refresh(); }} reloadLabel="Recargar" /></div>}
    </Sheet>

    <Sheet open={selectedId !== null} onOpenChange={open => { if (!open) setSelectedId(null); }} title="Detalle del gasto">
      {selectedId && <ExpenseDetail key={selectedId} expenseId={selectedId} categories={categories} today={today} onChanged={refresh} onOpen={setSelectedId} onClose={() => setSelectedId(null)} />}
    </Sheet>

    <Sheet open={categoriesOpen} onOpenChange={setCategoriesOpen} title="Categorías de gastos">
      {categories.length > 0 && <ExpenseCategories categories={categories} onChanged={() => { setCatRevision(v => v + 1); refresh(); }} />}
    </Sheet>
  </main>;
}
