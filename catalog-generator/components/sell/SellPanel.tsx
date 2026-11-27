"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, CircleCheck, CreditCard, Minus, Plus, ShieldCheck, ShoppingCart, Tag, Trash2, Zap } from "lucide-react";
import { apiRequest, ApiError } from "@/lib/api";
import { useSafeCommand } from "@/components/common/useSafeCommand";
import { Sheet, AmountInput } from "@/components/expenses/Sheet";
import { describeFailure, parseSale } from "@/lib/sales-ui.mjs";
import { addPaymentRow, amountText, applySoldLines, formatPesos, parseAmountText, parseCreditBalance, parsePosItems, payExactly, paymentsBody, totalChange, validatePayments,
  type MethodButton, type PaymentRow, type PosItem } from "@/lib/pos-ui.mjs";
import CustomerField, { focus } from "./CustomerField";
import PaymentBox from "./PaymentBox";
import ProductGrid, { ProductSearch, Thumb } from "./ProductGrid";
import VenderHeader from "./VenderHeader";
import { useSellDraft, type TicketLine } from "./useSellDraft";

type Done = { kind: "delivered" | "confirmed"; saleId: string; total: string; change: bigint; paid: string | null; balance: string | null };
const ZERO = BigInt(0);

/**
 * Vender › Nueva venta (docs/diseno/vender-escritorio.png, F2a-3a). The ticket is a server draft; its totals are the
 * server's. «Cobrar y entregar» is one idempotent call: POST /sales/:id/confirm with deliverImmediately and payments,
 * after the draft is saved (PATCH with expectedVersion). Fiado is off until F2.
 */
export default function SellPanel() {
  const draft = useSellDraft();
  const { lines, setLines, customer, setCustomer, sale, synced } = draft;
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<PosItem[] | null>(null);
  const [itemsError, setItemsError] = useState("");
  const [itemsRevision, setItemsRevision] = useState(0);
  const [creditOf, setCreditOf] = useState<{ customerId: string; balance: string } | null>(null);
  const [rows, setRows] = useState<PaymentRow[]>([]);
  const [done, setDone] = useState<Done | null>(null);
  const [message, setMessage] = useState("");
  const [todaySales, setTodaySales] = useState<string | null>(null);
  const [online, setOnline] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const command = useSafeCommand(describeFailure);
  const search = useRef<HTMLInputElement>(null), newSale = useRef<HTMLButtonElement>(null);
  const rowKey = useRef(0);

  // Products: the first 24 matches of GET /inventory/items (name or SKU), reloaded after each sale (stock changes).
  // Each read carries a sequence number: only the newest answer is shown, so a slow read started before a sale can
  // never put the stock from before the sale back on the cards.
  const itemsSeq = useRef(0), querySeq = useRef(query);
  useEffect(() => { querySeq.current = query; }, [query]);
  const fetchItems = useCallback(async (term: string) => {
    const seq = ++itemsSeq.current;
    try {
      const found = parsePosItems(await apiRequest<unknown>(`/inventory/items?page=1&q=${encodeURIComponent(term.trim())}`));
      if (seq === itemsSeq.current) { setItems(found); setItemsError(""); setOnline(true); }
    } catch (cause) {
      if (seq === itemsSeq.current) { setItemsError(cause instanceof Error ? cause.message : "No se pudieron cargar los productos."); setOnline(cause instanceof ApiError); }
    }
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => { void fetchItems(query); }, query ? 250 : 0);
    return () => clearTimeout(timer);
  }, [query, itemsRevision, fetchItems]);
  const reloadItems = useCallback(() => setItemsRevision(value => value + 1), []);

  const todaySeq = useRef(0);
  const loadToday = useCallback(() => {
    const seq = ++todaySeq.current;
    return apiRequest<{ today?: { salesTotal?: unknown } }>("/dashboard/summary?days=7").then(
      summary => { const total = summary.today?.salesTotal; if (seq === todaySeq.current) { setTodaySales(typeof total === "string" && /^-?[0-9]+$/.test(total) ? total : null); setOnline(true); } },
      cause => { if (seq === todaySeq.current) setOnline(cause instanceof ApiError); });
  }, []);
  useEffect(() => { void loadToday(); }, [loadToday]);

  // Credit balance of the ticket's customer («Saldo a favor» only shows when there is some), kept with its customer id.
  useEffect(() => {
    let active = true;
    if (!customer) return;
    apiRequest<unknown>(`/customers/${customer.id}/credit`).then(parseCreditBalance).then(balance => { if (active) setCreditOf({ customerId: customer.id, balance }); }, () => undefined);
    return () => { active = false; };
  }, [customer]);
  const credit = customer && creditOf?.customerId === customer.id ? creditOf.balance : null;

  // F1 focuses the product search (the browser's help is suppressed on this page only).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "F1") { event.preventDefault(); search.current?.focus(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // After a sale, the focus goes to «Nueva venta» once the summary is on screen.
  useEffect(() => { if (done) newSale.current?.focus(); }, [done]);

  const quantities = useMemo(() => new Map(lines.map(line => [line.itemId, line.quantity])), [lines]);
  const stockOf = useMemo(() => new Map((items ?? []).map(item => [item.id, item.stock])), [items]);
  const busy = command.busy !== null;
  const total = synced && sale ? sale.total : null;
  const check = total === null ? null : validatePayments(total, rows, credit);
  const units = lines.reduce((sum, line) => sum + line.quantity, 0);

  function edit(next: (current: TicketLine[]) => TicketLine[]) { setDone(null); setMessage(""); command.clearFailure(); setLines(next); }
  function addItem(item: PosItem) {
    if (item.price === null) return;
    edit(current => current.some(line => line.itemId === item.id) ? current.map(line => line.itemId === item.id ? { ...line, quantity: line.quantity + 1 } : line)
      : [...current, { itemId: item.id, name: item.name, sku: item.sku, price: item.price!, quantity: 1, unitDiscount: "0" }]);
  }
  const step = (itemId: string, delta: number) => edit(current => current.flatMap(line => line.itemId !== itemId ? [line] : line.quantity + delta <= 0 ? [] : [{ ...line, quantity: line.quantity + delta }]));
  const remove = (itemId: string) => edit(current => current.filter(line => line.itemId !== itemId));
  const addRow = (button: MethodButton) => { if (total !== null) setRows(current => addPaymentRow(current, button, total, credit, `p${++rowKey.current}`)); };
  const changeRow = (key: string, patch: Partial<PaymentRow>) => setRows(current => current.map(row => row.key === key ? { ...row, ...patch } : row));
  const removeRow = (key: string) => setRows(current => current.filter(row => row.key !== key));
  const payTotal = () => { if (total !== null) setRows(current => payExactly(current, total)); };

  /** Saves the draft, then one confirm call (with payments, and delivery for «Cobrar y entregar»). */
  async function charge(deliver: boolean) {
    setMessage("");
    let saved;
    try { saved = await draft.flush(); } catch { return; }
    if (!saved || !draft.lines.length) return;
    const checked = validatePayments(saved.total, rows, credit);
    if (deliver ? !checked.canDeliver : !checked.canConfirmLater) return;
    const change = totalChange(rows), body = { expectedVersion: saved.version, deliverImmediately: deliver, ...paymentsBody(rows) };
    await command.run({ action: deliver ? "chargeAndDeliver" : "confirmLater", resourceId: saved.id, path: `/sales/${saved.id}/confirm`, method: "POST", body, withRequestId: true,
      label: deliver ? "Cobrando y entregando…" : "Confirmando venta…" }, reply => {
      const result = (reply as { result?: { payments?: { paid?: string; balance?: string } } } | null)?.result;
      const confirmed = parseSale(result);
      setDone({ kind: deliver ? "delivered" : "confirmed", saleId: confirmed.id, total: confirmed.total, change, paid: result?.payments?.paid ?? null, balance: result?.payments?.balance ?? null });
      draft.reset(); setRows([]);
      // The cards and «Ventas hoy» change now, without a reload: the confirmed lines are applied to the stock on
      // screen at once, then the product list and the summary are read again (newest answer wins).
      itemsSeq.current++; setItems(current => current ? applySoldLines(current, confirmed.lines) : current);
      if (confirmed.status !== "DRAFT") setTodaySales(current => current === null ? current : (BigInt(current) + BigInt(confirmed.total)).toString());
      todaySeq.current++;
      void fetchItems(querySeq.current); void loadToday();
    });
  }
  async function saveDraft() {
    try { await draft.flush(); } catch { return; }
    draft.reset(); setRows([]); setMessage("Borrador guardado. Lo encuentras en Historial.");
  }
  function startNew() { setDone(null); setMessage(""); command.clearFailure(); setSheetOpen(false); search.current?.focus(); void fetchItems(querySeq.current); }
  function recover() {
    const code = command.failure?.code;
    command.clearFailure(); reloadItems();
    if (code === "VERSION_CONFLICT" || code === "PAYMENT_EXCEEDS_BALANCE") void draft.flush().catch(() => undefined);
  }

  const failure = command.failure ?? (draft.state === "error" ? draft.failure : null);
  const blocked = !lines.length ? "Agrega productos al ticket." : !synced ? "Guardando el ticket para tener el total del servidor…" : check?.deliverBlockedReason ?? null;
  const ticket = (prefix: string) => <div className="space-y-4">
    <div className={`flex items-center gap-3 ${prefix === "sheet" ? "-mt-3 justify-end" : "justify-between"}`}>
      {prefix !== "sheet" && <h2 className="flex items-center gap-2 text-xl font-bold text-[var(--vy-text)]"><Tag aria-hidden="true" className="size-5 text-[var(--vy-blue-600)]" />Ticket</h2>}
      <span role="status" data-draft-state={draft.state} className="flex items-center gap-1.5 text-sm font-semibold text-[var(--vy-text-muted)]">
        {draft.state === "saved" && <><ShieldCheck aria-hidden="true" className="size-4 text-[#067647]" />Borrador guardado</>}
        {draft.state === "saving" && "Guardando…"}
        {draft.state === "error" && <span className="text-[#B42318]">No se guardó</span>}
      </span>
    </div>
    {done ? <div className="space-y-4 rounded-3xl bg-[#ECFDF3] p-5 text-center" data-sale-done={done.kind}>
      <CircleCheck aria-hidden="true" className="mx-auto size-10 text-[#067647]" />
      <p role="status" className="text-lg font-bold text-[var(--vy-text)]">{done.kind === "delivered" ? "Venta entregada" : "Venta confirmada"} · {formatPesos(done.total)}{done.change > ZERO ? ` · Cambio ${formatPesos(done.change)}` : ""}</p>
      {done.kind === "confirmed" && <p className="text-sm text-[var(--vy-text-muted)]">Pagado {formatPesos(done.paid ?? "0")} · Falta {formatPesos(done.balance ?? "0")} para entregar. Cóbrala y entrégala desde{" "}
        <Link href={`/dashboard/ventas/historial?venta=${done.saleId}`} className={`font-semibold text-[var(--vy-blue-600)] underline ${focus}`}>Historial</Link>.</p>}
      <button ref={newSale} type="button" onClick={startNew} className={`inline-flex min-h-12 items-center gap-2 rounded-2xl bg-[var(--vy-blue-600)] px-6 font-semibold text-white hover:bg-[var(--vy-blue-700)] ${focus}`}><Plus aria-hidden="true" className="size-5" />Nueva venta</button>
    </div> : <>
      <CustomerField idPrefix={prefix} value={customer} disabled={busy} onChange={next => { setDone(null); setRows(current => current.filter(row => row.method !== "CREDIT")); setCustomer(next); }} />
      {credit !== null && BigInt(credit) > ZERO && <p data-customer-credit className="-mt-2 text-sm text-[#6D28D9]">Saldo a favor del cliente: <strong>{formatPesos(credit)}</strong></p>}
      {lines.length === 0 ? <p className="rounded-2xl border border-dashed border-[var(--vy-border)] px-4 py-6 text-center text-sm text-[var(--vy-text-muted)]">El ticket está vacío. Toca + en un producto para agregarlo.</p>
        : <ul aria-label="Líneas del ticket" className="divide-y divide-[var(--vy-border)]">
          {lines.map(line => {
            const saved = synced ? sale?.lines.find(row => row.inventoryItemId === line.itemId) : null, stock = stockOf.get(line.itemId);
            return <li key={line.itemId} data-ticket-line={line.sku} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2 py-3">
              <Thumb name={line.name} size="sm" />
              <div className="min-w-0">
                <p className="break-words font-semibold text-[var(--vy-text)]">{line.name}</p>
                <p className="text-xs text-[var(--vy-text-muted)]">{formatPesos(line.price)} c/u · descuento {formatPesos(line.unitDiscount)}</p>
                {stock !== undefined && line.quantity > stock && <p data-line-short className="text-xs font-semibold text-[#B42318]">{stock === 0 ? "Agotado" : `Solo quedan ${stock}`}: ajusta la cantidad o quita el producto.</p>}
                <details className="mt-1 text-xs"><summary className={`min-h-6 cursor-pointer font-semibold text-[var(--vy-blue-600)] ${focus}`}>Descuento por unidad</summary>
                  <label htmlFor={`${prefix}-discount-${line.itemId}`} className="sr-only">Descuento por unidad de {line.name}</label>
                  <div className="mt-1 max-w-40"><AmountInput id={`${prefix}-discount-${line.itemId}`} value={line.unitDiscount === "0" ? "" : amountText(line.unitDiscount)} placeholder="0"
                    onChange={value => { const parsed = value ? parseAmountText(value) : ZERO; if (parsed !== null) edit(current => current.map(row => row.itemId === line.itemId ? { ...row, unitDiscount: parsed.toString() } : row)); }} /></div>
                </details>
              </div>
              <button type="button" disabled={busy} onClick={() => remove(line.itemId)} aria-label={`Quitar ${line.name} del ticket`} className={`grid size-11 place-items-center rounded-xl text-[var(--vy-text-muted)] hover:bg-[var(--vy-surface-soft)] ${focus}`}><Trash2 aria-hidden="true" className="size-5" /></button>
              <span className="col-start-2 flex items-center gap-1">
                <button type="button" disabled={busy} onClick={() => step(line.itemId, -1)} aria-label={`Quitar una unidad de ${line.name}`} className={`grid size-10 place-items-center rounded-full border border-[var(--vy-border)] hover:bg-[var(--vy-surface-soft)] ${focus}`}><Minus aria-hidden="true" className="size-4" /></button>
                <span className="min-w-6 text-center font-semibold" aria-label={`Cantidad: ${line.quantity}`}>{line.quantity}</span>
                <button type="button" disabled={busy || (stock !== undefined && line.quantity >= stock)} onClick={() => step(line.itemId, 1)} aria-label={`Agregar una unidad de ${line.name}`} className={`grid size-10 place-items-center rounded-full border border-[var(--vy-border)] hover:bg-[var(--vy-surface-soft)] disabled:opacity-40 ${focus}`}><Plus aria-hidden="true" className="size-4" /></button>
              </span>
              <span className="self-center text-right font-bold text-[var(--vy-text)]" data-line-total>{saved ? formatPesos(saved.lineTotal) : "…"}</span>
            </li>;
          })}
        </ul>}
      <div className="flex items-end justify-between gap-3 border-t border-[var(--vy-border)] pt-4">
        <span className="text-2xl font-bold text-[var(--vy-text)]">Total</span>
        <span data-ticket-total className="text-3xl font-bold tracking-tight text-[var(--vy-blue-600)] sm:text-4xl">{total !== null ? formatPesos(total) : lines.length ? "Calculando…" : formatPesos(0)}</span>
      </div>
      {sale && synced && sale.discountTotal !== "0" && <p className="-mt-2 text-right text-sm text-[var(--vy-text-muted)]">Subtotal {formatPesos(sale.subtotal)} · Descuento {formatPesos(sale.discountTotal)}</p>}
      {lines.length > 0 && <PaymentBox idPrefix={prefix} rows={rows} status={check?.status ?? null} credit={credit} disabled={busy || total === null} onAdd={addRow} onChange={changeRow} onRemove={removeRow} onPayTotal={payTotal} />}
      {check && check.errors.length > 0 && <ul role="alert" className="space-y-1 text-sm text-[#B42318]">{check.errors.map(error => <li key={error}>{error}</li>)}</ul>}
      {failure && <div role="alert" className="space-y-2 rounded-2xl border border-[#F4C7C2] bg-[#FEF3F2] p-4 text-sm text-[#7A271A]">
        <p className="font-semibold text-[#B42318]">{failure.title}</p><p>{failure.detail}</p>
        <div className="flex flex-wrap gap-2">
          {command.failure?.action === "retry" && <button type="button" onClick={() => void command.retry()} className={`min-h-11 rounded-xl bg-[var(--vy-blue-600)] px-4 font-semibold text-white ${focus}`}>Reintentar</button>}
          {draft.state === "error" && !command.failure && <button type="button" onClick={() => void draft.flush().catch(() => undefined)} className={`min-h-11 rounded-xl bg-[var(--vy-blue-600)] px-4 font-semibold text-white ${focus}`}>Reintentar guardar</button>}
          {command.failure && command.failure.action !== "retry" && <button type="button" onClick={recover} className={`min-h-11 rounded-xl border border-[#A9B5CC] bg-white px-4 font-semibold text-[var(--vy-text)] ${focus}`}>Entendido</button>}
        </div>
      </div>}
      <div className="space-y-2">
        <button type="button" data-charge disabled={busy || !check?.canDeliver || !lines.length} aria-describedby={blocked ? `${prefix}-charge-why` : undefined} onClick={() => void charge(true)}
          className={`flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-[linear-gradient(90deg,#0450E5,#0341BD)] px-3 text-base font-semibold xl:text-lg text-white shadow-[0_16px_30px_-18px_rgba(4,80,229,0.9)] disabled:bg-none disabled:bg-[#A9B5CC] disabled:shadow-none ${focus}`}>
          <CreditCard aria-hidden="true" className="size-5" />{command.busy ?? `Cobrar y entregar${total !== null ? ` · ${formatPesos(total)}` : ""}`}<ArrowRight aria-hidden="true" className="hidden size-5 xl:block" /></button>
        {blocked && <p id={`${prefix}-charge-why`} className="text-center text-sm text-[var(--vy-text-muted)]">{blocked}</p>}
        <div className="grid grid-cols-2 gap-2 text-sm">
          <button type="button" disabled={busy || !lines.length} onClick={() => void saveDraft()} className={`flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-[var(--vy-border)] bg-white px-2 font-semibold text-[var(--vy-blue-600)] hover:bg-[var(--vy-surface-soft)] disabled:text-[var(--vy-text-subtle)] ${focus}`}><ShieldCheck aria-hidden="true" className="size-4 shrink-0" />Guardar borrador</button>
          <button type="button" disabled={busy || !lines.length || !check?.canConfirmLater} onClick={() => void charge(false)} className={`min-h-11 rounded-xl border border-[var(--vy-border)] bg-white px-2 font-semibold leading-tight text-[var(--vy-blue-600)] hover:bg-[var(--vy-surface-soft)] disabled:text-[var(--vy-text-subtle)] ${focus}`}>Confirmar, entregar después</button>
        </div>
      </div>
    </>}
  </div>;

  return <main className="vy-theme mx-auto w-full max-w-7xl space-y-5 px-4 pb-44 pt-5 sm:px-8 lg:pb-8 lg:pt-4">
    <VenderHeader current="new" title="Vender" subtitle="Selecciona productos y arma tu venta" />
    <p role="status" className="text-sm font-medium text-[var(--vy-blue-700)] empty:hidden">{message}</p>

    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem] xl:grid-cols-[minmax(0,1fr)_27rem] lg:items-start">
      <section aria-labelledby="sell-products" className="min-w-0 space-y-4 rounded-3xl bg-white/70 p-3 sm:p-5">
        <h2 id="sell-products" className="sr-only">Productos</h2>
        <ProductSearch ref={search} value={query} onChange={setQuery} />
        {itemsError && <p role="alert" className="rounded-2xl bg-[#FEF3F2] px-4 py-3 text-sm text-[#B42318]">{itemsError} <button type="button" onClick={reloadItems} className={`ml-2 font-semibold underline ${focus}`}>Reintentar</button></p>}
        {!items && !itemsError && <p role="status" className="text-sm text-[var(--vy-text-muted)]">Cargando productos…</p>}
        {items && items.length === 0 && <p className="text-sm text-[var(--vy-text-muted)]">{query.trim() ? "Ningún producto coincide con la búsqueda." : "Aún no tienes productos en el inventario."}</p>}
        {items && <ProductGrid items={items} quantities={quantities} disabled={busy || Boolean(done)} onAdd={addItem} onStep={(item, delta) => delta > 0 ? addItem(item) : step(item.id, -1)} />}
      </section>
      <aside aria-label="Ticket de la venta" className="hidden rounded-3xl bg-white p-5 shadow-[0_24px_60px_-40px_rgba(1,28,79,0.55)] lg:sticky lg:top-4 lg:block">{ticket("desk")}</aside>
    </div>

    <footer className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-2xl bg-white px-4 py-3 text-sm text-[var(--vy-text-muted)]">
      <span className="flex items-center gap-2"><span aria-hidden="true" className={`size-2.5 rounded-full ${online ? "bg-[#12B76A]" : "bg-[#B42318]"}`} />{online ? "Sistema en línea" : "Sin conexión"}</span>
      <span>Ventas hoy: <strong className="text-[var(--vy-text)]" data-today-sales>{todaySales === null ? "—" : formatPesos(todaySales)}</strong></span>
      <span className="ml-auto hidden items-center gap-1.5 rounded-xl bg-[#E8EFFE] px-3 py-1.5 font-medium text-[var(--vy-blue-700)] lg:flex"><Zap aria-hidden="true" className="size-4" />Atajo: F1 para buscar</span>
    </footer>

    {/* Mobile: the ticket is a bottom sheet; its total stays fixed above the bottom navigation. */}
    <div className="fixed inset-x-0 z-30 px-3 lg:hidden" style={{ bottom: "calc(4.5rem + env(safe-area-inset-bottom))" }}>
      <button type="button" data-open-ticket onClick={() => setSheetOpen(true)} className={`flex min-h-14 w-full items-center justify-between gap-3 rounded-2xl bg-[var(--vy-blue-600)] px-4 text-white shadow-[0_16px_30px_-14px_rgba(1,28,79,0.8)] ${focus}`}>
        <span className="flex min-w-0 items-center gap-2 font-semibold"><ShoppingCart aria-hidden="true" className="size-5 shrink-0" /><span className="truncate">{done ? "Venta lista" : `Ticket · ${units} ${units === 1 ? "producto" : "productos"}`}</span></span>
        <span className="shrink-0 text-lg font-bold">{total !== null ? formatPesos(total) : lines.length ? "Calculando…" : formatPesos(0)}</span>
      </button>
    </div>
    <Sheet open={sheetOpen} onOpenChange={setSheetOpen} title="Ticket de la venta">{ticket("sheet")}</Sheet>
  </main>;
}
