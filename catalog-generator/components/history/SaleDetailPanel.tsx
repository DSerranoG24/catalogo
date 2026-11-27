"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Ban, CircleCheck, CreditCard, PackageCheck, RotateCcw, Undo2, Wallet, X } from "lucide-react";
import { apiRequest, ApiError } from "@/lib/api";
import { useSafeCommand, type SafeCommand } from "@/components/common/useSafeCommand";
import { AmountInput, panelSelect } from "@/components/expenses/Sheet";
import PaymentBox from "@/components/sell/PaymentBox";
import { focus } from "@/components/sell/CustomerField";
import { buildReturn, buyerName, describeFailure, displayStatus, formatDate, lineBalances, parseSale, type ReturnRows, type Sale } from "@/lib/sales-ui.mjs";
import { addPaymentRow, amountText, formatPesos, parseAmountText, payExactly, paymentsBody, totalChange, validatePayments, type MethodButton, type PaymentRow } from "@/lib/pos-ui.mjs";
import { cancelOutcome, changeGiven, detailActions, ledgerRows, reasonError, REFUND_METHOD_LABELS, REFUND_METHODS, refundMethod, salePayments, STAGE_LABELS,
  type SalePayments } from "@/lib/sale-detail-ui.mjs";
import StatusPill from "./StatusPill";

type Mode = null | "charge" | "pay" | "deliver" | "cancel" | "return" | "refund" | "credit" | { void: string } | { replace: string };
type ReplaceMethod = "CASH" | "NEQUI" | "DAVIPLATA" | "BANK_TRANSFER" | "CARD";
const TRANSFERS: ReplaceMethod[] = ["NEQUI", "DAVIPLATA", "BANK_TRANSFER"];
type Loaded = { sale: Sale; payments: SalePayments };
const ZERO = BigInt(0);
const REPLACE_LABELS: Record<ReplaceMethod, string> = { CASH: "Efectivo", NEQUI: "Nequi", DAVIPLATA: "Daviplata", BANK_TRANSFER: "Transferencia bancaria", CARD: "Tarjeta" };
/** A sale that does not exist (or not in this account), or an incomplete id in ?venta=. */
const MISSING = { title: "No encontramos esa venta", detail: "Revisa el enlace o búscala en la lista de Historial.", action: null };
const primary = `inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[var(--vy-blue-600)] px-4 font-semibold text-white hover:bg-[var(--vy-blue-700)] disabled:bg-[#A9B5CC] ${focus}`;
const secondary = `inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[#A9B5CC] bg-white px-3 font-semibold text-[var(--vy-text)] hover:bg-[var(--vy-surface-soft)] disabled:text-[var(--vy-text-subtle)] ${focus}`;
const danger = `inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#B42318] px-4 font-semibold text-white hover:bg-[#912018] disabled:bg-[#A9B5CC] ${focus}`;
const field = `min-h-11 w-full min-w-0 rounded-xl border border-[var(--vy-field-border)] bg-white px-3 text-[var(--vy-text)] ${focus}`;

/**
 * Detail of a sale (F2a-3b): the lines saved in the sale, its status, total, payments book, paid, balance and change,
 * and only the actions of the F2a-2b API that its state allows. Every money action keeps its operationId across
 * «Reintentar» (useSafeCommand), so a lost answer never charges, delivers or refunds twice. After each success the
 * sale is read again: every figure on screen is the server's.
 */
export default function SaleDetailPanel({ saleId, onClose, onChanged, inSheet = false }: { saleId: string; onClose: () => void; onChanged: (saleId: string) => void; inSheet?: boolean }) {
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{ revision: number; loaded: Loaded | null; error: ReturnType<typeof describeFailure> | null } | null>(null);
  const [modeState, setModeState] = useState<Mode>(null);
  const [message, setMessage] = useState("");
  const [rows, setRows] = useState<PaymentRow[]>([]);
  const [reason, setReason] = useState("");
  const [refundNow, setRefundNow] = useState<"now" | "later">("later");
  const [method, setMethod] = useState("CASH"), [methodNote, setMethodNote] = useState("");
  const [amount, setAmount] = useState("");
  const [returnRows, setReturnRows] = useState<ReturnRows>({});
  const [formError, setFormError] = useState<string[]>([]);
  const [replaceMethod, setReplaceMethod] = useState<ReplaceMethod>("CASH"), [replaceReceived, setReplaceReceived] = useState("");
  const command = useSafeCommand(describeFailure);
  const heading = useRef<HTMLHeadingElement>(null), formHeading = useRef<HTMLHeadingElement>(null);
  const rowKey = useRef(0);

  useEffect(() => {
    let active = true;
    apiRequest<{ result?: unknown }>(`/sales/${saleId}`).then(reply => { const sale = parseSale(reply?.result); return { sale, payments: salePayments(sale) }; }).then(
      loaded => { if (active) setState({ revision, loaded, error: null }); },
      cause => { if (active) setState(current => ({ revision, loaded: current?.loaded ?? null, error: cause instanceof ApiError && cause.status === 404 ? MISSING : describeFailure(cause) })); });
    return () => { active = false; };
  }, [saleId, revision]);
  const reload = useCallback(() => setRevision(value => value + 1), []);
  const loaded = state?.loaded ?? null, loading = state?.revision !== revision;
  const shownId = loaded?.sale.id;
  useEffect(() => { if (shownId) heading.current?.focus(); }, [shownId]);
  useEffect(() => { if (modeState) formHeading.current?.focus(); }, [modeState]);

  function setMode(next: Mode) {
    setModeState(next); setRows([]); setReason(""); setRefundNow("later"); setMethod("CASH"); setMethodNote(""); setFormError([]); setReturnRows({}); command.clearFailure(); setMessage("");
    setReplaceMethod("CASH"); setReplaceReceived("");
    if (next === "refund" && loaded?.payments.mode === "TRACKED") setAmount(amountText(loaded.payments.refundDue));
    else if (next === "credit" && loaded?.payments.customerCredit) setAmount(amountText(loaded.payments.customerCredit));
    else setAmount("");
  }
  async function send(next: Omit<SafeCommand, "withRequestId">, done: string) {
    setMessage("");
    await command.run({ ...next, withRequestId: true }, () => {
      setModeState(null); setRows([]); setReason(""); setFormError([]); setReturnRows({});
      setMessage(done); reload(); onChanged(saleId);
    });
  }

  if (!loaded) return <section aria-label="Detalle de la venta" className="space-y-3 p-1">
    {state?.error ? <Notice title={state.error.title} detail={state.error.detail}><button type="button" onClick={reload} className={secondary}>Reintentar cargar la venta</button></Notice>
      : <p role="status" className="text-sm text-[var(--vy-text-muted)]">Cargando venta…</p>}
    <button type="button" onClick={onClose} className={secondary}>Cerrar detalle</button>
  </section>;

  const { sale, payments } = loaded;
  const tracked = payments.mode === "TRACKED" ? payments : null;
  const actions = detailActions(sale, payments);
  // A form whose action no longer applies to the sale read again (delivered elsewhere, payment voided…) closes itself.
  const allowed = (value: Mode) => value === null ? true : typeof value === "object" ? ("void" in value ? actions.voidable.includes(value.void) : actions.replaceable.includes(value.replace))
    : { charge: actions.chargeAndDeliver, pay: actions.registerPayment, deliver: actions.deliver, cancel: actions.cancel, return: actions.registerReturn, refund: actions.refundMoney, credit: actions.refundCredit }[value];
  const mode = allowed(modeState) ? modeState : null;
  const status = displayStatus(sale), buyer = buyerName(sale);
  const busy = command.busy !== null;
  const balance = tracked?.balance ?? "0";
  const credit = sale.customerId && payments.customerCredit && BigInt(payments.customerCredit) > ZERO ? payments.customerCredit : null;
  const check = mode === "charge" || mode === "pay" ? validatePayments(balance, rows, credit) : null;
  const balances = lineBalances(sale);
  const ledger = tracked ? ledgerRows(tracked.entries) : [];
  const change = tracked ? changeGiven(tracked.entries) : ZERO;
  const outcome = cancelOutcome(sale, payments);
  const voidId = mode && typeof mode === "object" && "void" in mode ? mode.void : null;
  const voidRow = voidId ? ledger.find(row => row.id === voidId) : null;
  const replaceId = mode && typeof mode === "object" && "replace" in mode ? mode.replace : null;
  const replaceRow = replaceId ? ledger.find(row => row.id === replaceId) : null;
  const replaceChange = replaceRow && replaceMethod === "CASH" ? (() => { const received = parseAmountText(replaceReceived), amount = BigInt(replaceRow.amount); return received !== null && received >= amount ? received - amount : null; })() : null;
  const base = { resourceId: sale.id, method: "POST" as const };

  function addRow(button: MethodButton) { setRows(current => addPaymentRow(current, button, balance, credit, `d${++rowKey.current}`)); }
  const refundInput = () => { const chosen = refundMethod(method, methodNote); return chosen; };

  function submitCharge(deliver: boolean) {
    if (!check || (deliver ? !check.canDeliver : !check.canConfirmLater || check.status.paid <= ZERO)) return;
    const body = { expectedVersion: sale.version, ...paymentsBody(rows) }, cash = totalChange(rows);
    void send(deliver ? { ...base, action: "detailChargeAndDeliver", path: `/sales/${sale.id}/deliver`, body, label: "Cobrando y entregando…" }
      : { ...base, action: "detailAdvance", path: `/sales/${sale.id}/payments`, body, label: "Registrando pago…" },
    deliver ? `Venta cobrada y entregada.${cash > ZERO ? ` Cambio ${formatPesos(cash)}.` : ""}` : `Pago registrado.${cash > ZERO ? ` Cambio ${formatPesos(cash)}.` : ""}`);
  }
  function submitCancel() {
    const errors = [reasonError(reason)].filter((e): e is string => Boolean(e));
    let refund: { method: string; methodNote?: string } | undefined;
    if (outcome.kind === "refund" && refundNow === "now") { const chosen = refundInput(); if (chosen.error) errors.push(chosen.error); else refund = chosen.value; }
    if (errors.length) { setFormError(errors); return; }
    void send({ ...base, action: "detailCancel", path: `/sales/${sale.id}/cancel`, body: { expectedVersion: sale.version, reason: reason.trim(), ...(refund ? { refundNow: refund } : {}) }, label: "Cancelando venta…" },
      outcome.kind === "credit" ? "Venta cancelada. Las unidades volvieron al inventario y lo pagado quedó como saldo a favor del cliente."
        : outcome.kind === "refund" ? (refund ? "Venta cancelada. Las unidades volvieron al inventario y el dinero quedó devuelto." : "Venta cancelada. Las unidades volvieron al inventario; el dinero queda por devolver.")
          : "Venta cancelada. Las unidades volvieron al inventario.");
  }
  function submitReturn() {
    const built = buildReturn(sale, returnRows, reason), errors = [...built.errors];
    let refund: { method: string; methodNote?: string } | undefined;
    if (tracked && !sale.customerId && refundNow === "now") { const chosen = refundInput(); if (chosen.error) errors.push(chosen.error); else refund = chosen.value; }
    if (errors.length) { setFormError(errors); return; }
    void send({ ...base, action: "detailReturn", path: `/sales/${sale.id}/returns`, body: { expectedVersion: sale.version, reason: built.reason, lines: built.lines, ...(refund ? { refundNow: refund } : {}) }, label: "Registrando devolución…" },
      "Devolución registrada. Lo revendible volvió al inventario.");
  }
  function submitRefund(kind: "refund" | "credit") {
    const value = parseAmountText(amount), limit = BigInt(kind === "refund" ? tracked?.refundDue ?? "0" : credit ?? "0"), errors: string[] = [];
    if (value === null || value < BigInt(1)) errors.push("Escribe el importe que devolviste.");
    else if (value > limit) errors.push(`Como máximo ${formatPesos(limit)}.`);
    const chosen = refundInput(); if (chosen.error) errors.push(chosen.error);
    const why = reasonError(reason); if (why) errors.push(why);
    if (errors.length || !chosen.value || value === null) { setFormError(errors); return; }
    const body = { amount: value.toString(), ...chosen.value, reason: reason.trim() };
    if (kind === "refund") void send({ ...base, action: "detailRefund", path: `/sales/${sale.id}/refunds`, body: { expectedVersion: sale.version, ...body }, label: "Registrando devolución de dinero…" }, `Devolución de dinero registrada: ${formatPesos(value)}.`);
    else void send({ ...base, resourceId: sale.customerId!, action: "creditRefund", path: `/customers/${sale.customerId}/credit/refunds`, body, label: "Devolviendo saldo a favor…" }, `Saldo a favor devuelto: ${formatPesos(value)}.`);
  }
  /** «Anular y reemplazar» (F2a-3c): the voided payment and the right one, for the same amount, in one operation. */
  function submitReplace() {
    if (!replaceRow || !replaceId) return;
    const errors = [reasonError(reason)].filter((e): e is string => Boolean(e));
    const received = replaceMethod === "CASH" && replaceReceived.trim() ? parseAmountText(replaceReceived) : null;
    if (replaceMethod === "CASH" && replaceReceived.trim() && (received === null || received < BigInt(replaceRow.amount))) errors.push("El efectivo recibido no alcanza para el pago.");
    if (errors.length) { setFormError(errors); return; }
    const payment = { method: replaceMethod, amount: replaceRow.amount, ...(received !== null ? { cashReceived: received.toString() } : {}) };
    void send({ ...base, resourceId: replaceId, action: "detailReplace", path: `/sales/${sale.id}/payments/${replaceId}/replace`, body: { expectedVersion: sale.version, reason: reason.trim(), payment }, label: "Anulando y reemplazando…" },
      `Pago reemplazado: ${REPLACE_LABELS[replaceMethod]} por ${formatPesos(replaceRow.amount)}.${replaceChange !== null && replaceChange > ZERO ? ` Cambio ${formatPesos(replaceChange)}.` : ""}`);
  }
  function submitVoid() {
    const why = reasonError(reason);
    if (why || !voidId) { setFormError(why ? [why] : []); return; }
    void send({ ...base, resourceId: voidId, action: "detailVoid", path: `/sales/${sale.id}/payments/${voidId}/void`, body: { expectedVersion: sale.version, reason: reason.trim() }, label: "Anulando…" }, "Movimiento anulado. Queda en el historial, tachado, con su motivo.");
  }

  const failure = command.failure;
  const methodFields = (idPrefix: string) => <div className="grid gap-2">
    <label htmlFor={`${idPrefix}-method`} className="grid gap-1 text-sm font-medium">Cómo lo devolviste
      <select id={`${idPrefix}-method`} value={method} onChange={event => setMethod(event.target.value)} className={panelSelect}>
        {REFUND_METHODS.map(value => <option key={value} value={value}>{REFUND_METHOD_LABELS[value]}</option>)}
      </select></label>
    {method === "OTHER" && <label htmlFor={`${idPrefix}-note`} className="grid gap-1 text-sm font-medium">¿Cuál? (sin números de tarjeta ni documentos)
      <input id={`${idPrefix}-note`} maxLength={80} value={methodNote} onChange={event => setMethodNote(event.target.value)} className={field} /></label>}
  </div>;
  const reasonField = (idPrefix: string, label: string) => <label htmlFor={`${idPrefix}-reason`} className="grid gap-1 text-sm font-medium">{label} (obligatorio)
    <textarea id={`${idPrefix}-reason`} maxLength={300} rows={2} value={reason} onChange={event => { setReason(event.target.value); setFormError([]); }} className={`${field} py-2`} /></label>;
  const form = (title: string, children: ReactNode) => <section aria-labelledby="sale-form-title" data-detail-form className="min-w-0 space-y-3 rounded-2xl border border-[var(--vy-border)] bg-[var(--vy-surface-soft)] p-3 sm:p-4">
    <div className="flex items-start justify-between gap-2">
      <h3 id="sale-form-title" ref={formHeading} tabIndex={-1} className="text-base font-bold focus-visible:outline-none">{title}</h3>
      <button type="button" disabled={busy} onClick={() => setMode(null)} className={`${secondary} min-h-10 px-2 text-sm`}>Volver</button>
    </div>
    {children}
    {formError.length > 0 && <ul role="alert" className="space-y-1 text-sm text-[#B42318]">{formError.map(error => <li key={error}>{error}</li>)}</ul>}
  </section>;

  return <section aria-labelledby="sale-detail-title" data-sale-detail={sale.id} data-sale-version={sale.version} className="min-w-0 space-y-5">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 space-y-1">
        <h2 id="sale-detail-title" ref={heading} tabIndex={-1} className="break-words text-xl font-bold text-[var(--vy-text)] focus-visible:outline-none">Venta {sale.id.slice(0, 8)}</h2>
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill status={status} />
          {tracked?.stage && <span data-payment-stage={tracked.stage} className="text-sm font-semibold text-[var(--vy-text-muted)]">{STAGE_LABELS[tracked.stage]}</span>}
        </div>
        <p className="break-words text-sm text-[var(--vy-text-muted)]">{buyer ?? "Sin cliente"} · {formatDate(sale.createdAt) ?? "Sin fecha"}</p>
      </div>
      {!inSheet && <button type="button" onClick={onClose} aria-label="Cerrar detalle" className={`grid size-11 shrink-0 place-items-center rounded-xl hover:bg-[var(--vy-surface-soft)] ${focus}`}><X aria-hidden="true" className="size-5" /></button>}
    </div>

    <p role="status" data-detail-message className="text-sm font-semibold text-[#067647] empty:hidden">{message}</p>
    {loading && <p role="status" className="text-sm text-[var(--vy-text-muted)]">Actualizando…</p>}
    {state?.error && !loading && <Notice title={state.error.title} detail={state.error.detail}><button type="button" onClick={reload} className={secondary}>Reintentar</button></Notice>}

    <section aria-labelledby="sale-lines-title" className="space-y-2">
      <h3 id="sale-lines-title" className="text-sm font-bold uppercase tracking-wide text-[var(--vy-text-muted)]">Artículos</h3>
      <ul className="divide-y divide-[var(--vy-border)] rounded-2xl border border-[var(--vy-border)] bg-white">
        {sale.lines.map(line => { const b = balances.get(line.id)!; return <li key={line.id} data-detail-line={line.sku} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 p-3 text-sm">
          <span className="min-w-0 break-words font-semibold text-[var(--vy-text)]">{line.itemName}</span>
          <span className="text-right font-bold text-[var(--vy-text)]">{formatPesos(line.lineTotal)}</span>
          <span className="text-[var(--vy-text-muted)]">{line.quantity} × {formatPesos(line.unitPrice)}{line.unitDiscount !== "0" ? ` · desc. ${formatPesos(line.unitDiscount)} c/u` : ""} · SKU {line.sku}</span>
          {b.returned > 0 && <span className="col-span-2 text-xs font-semibold text-[#B93815]">Devueltas {b.returned} de {b.sold}</span>}
        </li>; })}
      </ul>
    </section>

    <dl data-detail-money className="space-y-1.5 rounded-2xl bg-white p-3 text-sm ring-1 ring-[var(--vy-border)]">
      <Row label="Total" value={formatPesos(sale.total)} strong />
      {tracked && tracked.returnedValue !== "0" && <><Row label="Valor devuelto" value={`− ${formatPesos(tracked.returnedValue)}`} /><Row label="Total vigente" value={formatPesos(tracked.effectiveTotal)} /></>}
      {tracked ? <>
        <Row label="Pagado" value={formatPesos(tracked.paid)} data="paid" />
        {tracked.refundDue !== "0" ? <Row label="Por devolver" value={formatPesos(tracked.refundDue)} tone="text-[#B42318]" data="refund-due" />
          : <Row label="Saldo" value={formatPesos(tracked.balance)} tone={tracked.balance !== "0" ? "text-[#B93815]" : undefined} data="balance" />}
        {change > ZERO && <Row label="Cambio entregado" value={formatPesos(change)} data="change" />}
      </> : <p data-legacy className="text-[var(--vy-text-muted)]">Pago no registrado (venta anterior al registro de pagos).</p>}
      {credit && <p data-customer-credit className="pt-1 text-[#6D28D9]">Saldo a favor de {buyer ?? "el cliente"}: <strong>{formatPesos(credit)}</strong></p>}
    </dl>

    {tracked && <section aria-labelledby="sale-ledger-title" className="space-y-2">
      <h3 id="sale-ledger-title" className="text-sm font-bold uppercase tracking-wide text-[var(--vy-text-muted)]">Pagos</h3>
      {ledger.length === 0 ? <p className="text-sm text-[var(--vy-text-muted)]">Sin pagos registrados.</p>
        : <ol aria-label="Libro de pagos" className="space-y-2">{ledger.map(row => <li key={row.id} data-ledger-entry={row.kind} data-voided={row.voided || undefined} className="rounded-2xl border border-[var(--vy-border)] bg-white p-3 text-sm">
          <div className="flex items-start justify-between gap-3">
            <span className={`min-w-0 break-words font-semibold ${row.voided ? "text-[var(--vy-text-subtle)] line-through" : "text-[var(--vy-text)]"}`}>{row.label}</span>
            <span className={`shrink-0 font-bold ${row.voided ? "text-[var(--vy-text-subtle)] line-through" : row.sign < 0 ? "text-[#B42318]" : "text-[var(--vy-text)]"}`}>{row.sign < 0 ? "− " : ""}{formatPesos(row.amount)}</span>
          </div>
          <p className="text-xs text-[var(--vy-text-muted)]">{formatDate(row.createdAt)}{row.change ? ` · Cambio ${formatPesos(row.change)}` : ""}{row.reason ? ` · Motivo: ${row.reason}` : ""}</p>
          {row.voided && <p data-void-reason className="mt-1 text-xs font-semibold text-[#B42318]">Anulado{row.voidedAt ? ` el ${formatDate(row.voidedAt)}` : ""}{row.voidReason ? ` · Motivo: ${row.voidReason}` : ""}</p>}
          {actions.replaceable.includes(row.id) && !mode && <button type="button" disabled={busy} onClick={() => setMode({ replace: row.id })} aria-label={`Anular y reemplazar ${row.label} de ${formatPesos(row.amount)}`}
            className={`mt-2 min-h-10 rounded-lg px-2 text-sm font-semibold text-[#B42318] hover:bg-[#FEF3F2] ${focus}`}>Anular y reemplazar</button>}
          {actions.voidable.includes(row.id) && !mode && <button type="button" disabled={busy} onClick={() => setMode({ void: row.id })} aria-label={`Anular ${row.label} de ${formatPesos(row.amount)}`}
            className={`mt-2 min-h-10 rounded-lg px-2 text-sm font-semibold text-[#B42318] hover:bg-[#FEF3F2] ${focus}`}>Anular</button>}
        </li>)}</ol>}
    </section>}

    {sale.returns.length > 0 && <section aria-labelledby="sale-returns-title" className="space-y-2">
      <h3 id="sale-returns-title" className="text-sm font-bold uppercase tracking-wide text-[var(--vy-text-muted)]">Devoluciones</h3>
      <ol className="space-y-2">{sale.returns.map((ret, index) => <li key={ret.id} className="rounded-2xl border border-[var(--vy-border)] bg-white p-3 text-sm">
        <p className="font-semibold">Devolución {index + 1}{ret.createdAt ? ` · ${formatDate(ret.createdAt)}` : ""}</p>
        <p className="break-words text-[var(--vy-text-muted)]">Motivo: {ret.reason}</p>
        <ul className="mt-1 list-disc pl-5">{ret.lines.map(line => <li key={line.saleLineId}>{sale.lines.find(l => l.id === line.saleLineId)?.itemName ?? "Artículo"}: {line.resellableQuantity} revendible{line.resellableQuantity === 1 ? "" : "s"}, {line.damagedQuantity} dañada{line.damagedQuantity === 1 ? "" : "s"}</li>)}</ul>
      </li>)}</ol>
    </section>}

    {failure && <Notice title={failure.title} detail={failure.detail}>
      {failure.action === "retry" && <button type="button" onClick={() => void command.retry()} className={`${secondary} border-[var(--vy-blue-600)] text-[var(--vy-blue-700)]`}>Reintentar</button>}
      {failure.action === "reload" && <button type="button" onClick={() => { command.clearFailure(); reload(); }} className={secondary}>Recargar la venta</button>}
      {failure.action === "login" && <Link href="/login" className={secondary}>Iniciar sesión</Link>}
      {failure.action !== "retry" && failure.action !== "login" && <button type="button" onClick={() => command.clearFailure()} className={secondary}>Entendido</button>}
    </Notice>}
    {command.busy && <p role="status" className="text-sm font-semibold text-[var(--vy-blue-700)]">{command.busy}</p>}

    {(mode === "charge" || mode === "pay") && form(mode === "charge" ? `Cobrar ${formatPesos(balance)} y entregar` : "Registrar pago", <>
      <p className="text-sm text-[var(--vy-text-muted)]">Falta {formatPesos(balance)}. {mode === "charge" ? "Se registra el pago y se entrega en una sola operación."
        : sale.status === "DELIVERED" ? "Esta venta entregada quedó con saldo por una anulación anterior. Registra lo que falta, como máximo el saldo." : "El pago queda como anticipo; la venta sigue sin entregar."}</p>
      <PaymentBox idPrefix="detail" rows={rows} status={check?.status ?? null} credit={credit} disabled={busy} legend="¿Cómo pagó el resto?"
        onAdd={addRow} onChange={(key, patch) => setRows(current => current.map(row => row.key === key ? { ...row, ...patch } : row))} onRemove={key => setRows(current => current.filter(row => row.key !== key))}
        onPayTotal={() => setRows(current => payExactly(current, balance))} />
      {check && check.errors.length > 0 && <ul role="alert" className="space-y-1 text-sm text-[#B42318]">{check.errors.map(error => <li key={error}>{error}</li>)}</ul>}
      {mode === "charge" ? <button type="button" data-detail-charge disabled={busy || !check?.canDeliver} onClick={() => submitCharge(true)} className={primary}><CreditCard aria-hidden="true" className="size-5" />Cobrar y entregar · {formatPesos(balance)}</button>
        : <button type="button" data-detail-pay disabled={busy || !check?.canConfirmLater || !check || check.status.paid <= ZERO} onClick={() => submitCharge(false)} className={primary}><Wallet aria-hidden="true" className="size-5" />Registrar pago{check && check.status.paid > ZERO ? ` · ${formatPesos(check.status.paid)}` : ""}</button>}
      {mode === "charge" && check && !check.canDeliver && check.errors.length === 0 && <p className="text-center text-sm text-[var(--vy-text-muted)]">Falta {formatPesos(check.status.remaining)} para entregar.</p>}
    </>)}

    {mode === "deliver" && form("¿Entregar la venta?", <>
      <p className="text-sm text-[var(--vy-text-muted)]">No cambia las existencias (se descontaron al confirmar). Después solo se corrige con devoluciones.</p>
      <button type="button" data-detail-deliver disabled={busy} onClick={() => void send({ ...base, action: "detailDeliver", path: `/sales/${sale.id}/deliver`, body: { expectedVersion: sale.version }, label: "Entregando venta…" }, "Venta entregada.")} className={primary}>
        <PackageCheck aria-hidden="true" className="size-5" />Sí, entregar</button>
    </>)}

    {mode === "cancel" && form("Cancelar venta", <>
      <p className="text-sm text-[var(--vy-text-muted)]">Las unidades vuelven al inventario. No se puede deshacer.</p>
      {outcome.kind === "credit" && <p data-cancel-outcome="credit" className="rounded-xl bg-[#F4F3FF] p-3 text-sm text-[#5925DC]">Lo pagado ({formatPesos(outcome.amount)}) queda como <strong>saldo a favor</strong> de {buyer ?? "el cliente"}.</p>}
      {outcome.kind === "refund" && <fieldset className="space-y-2 text-sm">
        <legend className="font-semibold">Ya pagó {formatPesos(outcome.amount)} y la venta no tiene cliente</legend>
        <label className="flex min-h-11 items-center gap-2"><input type="radio" name="cancel-refund" checked={refundNow === "now"} onChange={() => setRefundNow("now")} />Devolver ahora</label>
        <label className="flex min-h-11 items-center gap-2"><input type="radio" name="cancel-refund" checked={refundNow === "later"} onChange={() => setRefundNow("later")} />Dejarlo por devolver (queda como aviso)</label>
        {refundNow === "now" && methodFields("cancel")}
      </fieldset>}
      {reasonField("cancel", "Motivo de la cancelación")}
      <button type="button" data-detail-cancel disabled={busy} onClick={submitCancel} className={danger}><Ban aria-hidden="true" className="size-5" />Sí, cancelar la venta</button>
    </>)}

    {mode === "return" && form("Registrar devolución", <>
      <p className="text-sm text-[var(--vy-text-muted)]">Indica lo recibido por línea, como máximo lo pendiente. Lo revendible vuelve al inventario; lo dañado queda registrado.</p>
      {sale.lines.filter(line => balances.get(line.id)!.pending > 0).map(line => {
        const row = returnRows[line.id] ?? { resellable: "0", damaged: "0" }, pending = balances.get(line.id)!.pending;
        const set = (patch: Partial<typeof row>) => { setReturnRows(current => ({ ...current, [line.id]: { ...row, ...patch } })); setFormError([]); };
        return <div key={line.id} className="grid min-w-0 gap-2">
          <p className="text-sm"><span className="break-words font-semibold">{line.itemName}</span> · pendiente {pending}</p>
          <div className="grid grid-cols-2 gap-2">
            <label className="grid min-w-0 gap-1 text-sm font-medium">Revendibles<input inputMode="numeric" value={row.resellable} aria-label={`Revendibles de ${line.itemName}`} onChange={event => set({ resellable: event.target.value })} className={field} /></label>
            <label className="grid min-w-0 gap-1 text-sm font-medium">Dañadas<input inputMode="numeric" value={row.damaged} aria-label={`Dañadas de ${line.itemName}`} onChange={event => set({ damaged: event.target.value })} className={field} /></label>
          </div>
        </div>;
      })}
      {tracked && sale.customerId && <p className="rounded-xl bg-[#F4F3FF] p-3 text-sm text-[#5925DC]">Si lo pagado supera el nuevo total, el exceso queda como saldo a favor de {buyer ?? "el cliente"}.</p>}
      {tracked && !sale.customerId && BigInt(tracked.paid) > ZERO && <fieldset className="space-y-2 text-sm">
        <legend className="font-semibold">Si sobra dinero (la venta no tiene cliente)</legend>
        <label className="flex min-h-11 items-center gap-2"><input type="radio" name="return-refund" checked={refundNow === "now"} onChange={() => setRefundNow("now")} />Devolver ahora</label>
        <label className="flex min-h-11 items-center gap-2"><input type="radio" name="return-refund" checked={refundNow === "later"} onChange={() => setRefundNow("later")} />Dejarlo por devolver</label>
        {refundNow === "now" && methodFields("return")}
      </fieldset>}
      {reasonField("return", "Motivo de la devolución")}
      <button type="button" data-detail-return disabled={busy} onClick={submitReturn} className={primary}><RotateCcw aria-hidden="true" className="size-5" />Registrar devolución</button>
    </>)}

    {(mode === "refund" || mode === "credit") && form(mode === "refund" ? "Devolver dinero" : "Devolver saldo a favor", <>
      <p className="text-sm text-[var(--vy-text-muted)]">{mode === "refund" ? `Por devolver: ${formatPesos(tracked?.refundDue ?? "0")}.` : `Saldo a favor de ${buyer ?? "el cliente"}: ${formatPesos(credit ?? "0")}.`}</p>
      <label htmlFor={`${mode}-amount`} className="grid gap-1 text-sm font-medium">Importe devuelto<AmountInput id={`${mode}-amount`} value={amount} onChange={setAmount} placeholder="0" /></label>
      {methodFields(mode)}
      {reasonField(mode, "Motivo")}
      <button type="button" data-detail-refund disabled={busy} onClick={() => submitRefund(mode)} className={primary}><Undo2 aria-hidden="true" className="size-5" />Registrar devolución de dinero</button>
    </>)}

    {replaceRow && form(`Anular y reemplazar ${replaceRow.label} de ${formatPesos(replaceRow.amount)}`, <>
      <p className="text-sm text-[var(--vy-text-muted)]">La venta ya se entregó: el pago anulado queda tachado con su motivo y en la misma operación se registra el pago correcto por el mismo monto. El saldo no cambia.</p>
      {reasonField("replace", "Motivo de la anulación")}
      <fieldset className="@container min-w-0 space-y-2">
        <legend className="text-sm font-semibold">¿Cómo se pagó en realidad?</legend>
        <div role="radiogroup" aria-label="Medio del pago correcto" className="grid grid-cols-3 gap-2">
          {(["CASH", "TRANSFER", "CARD"] as const).map(kind => { const active = kind === "TRANSFER" ? TRANSFERS.includes(replaceMethod) : replaceMethod === kind;
            return <button key={kind} type="button" role="radio" aria-checked={active} onClick={() => { setReplaceMethod(kind === "TRANSFER" ? "NEQUI" : kind); setFormError([]); }}
              className={`min-h-11 min-w-0 rounded-xl border px-1 text-sm font-semibold ${active ? "border-[var(--vy-blue-600)] bg-[#E8EFFE] text-[var(--vy-blue-700)]" : "border-[var(--vy-border)] bg-white text-[var(--vy-text)]"} ${focus}`}>
              {kind === "CASH" ? "Efectivo" : kind === "CARD" ? "Tarjeta" : "Transferencia"}</button>; })}
        </div>
        {TRANSFERS.includes(replaceMethod) && <div role="radiogroup" aria-label="Medio de la transferencia" className="flex flex-wrap gap-2">
          {TRANSFERS.map(value => <button key={value} type="button" role="radio" aria-checked={replaceMethod === value} onClick={() => setReplaceMethod(value)}
            className={`min-h-11 rounded-xl border px-3 text-sm font-semibold ${replaceMethod === value ? "border-[var(--vy-blue-600)] bg-[#E8EFFE] text-[var(--vy-blue-700)]" : "border-[var(--vy-border)] bg-white text-[var(--vy-text)]"} ${focus}`}>
            {value === "BANK_TRANSFER" ? "Banco" : REPLACE_LABELS[value]}</button>)}
        </div>}
        <p className="flex items-baseline justify-between gap-3 rounded-xl bg-white px-3 py-2 text-sm ring-1 ring-[var(--vy-border)]"><span className="text-[var(--vy-text-muted)]">Monto (igual al anulado)</span><strong data-replace-amount className="text-base">{formatPesos(replaceRow.amount)}</strong></p>
        {replaceMethod === "CASH" && <div className="grid grid-cols-2 items-end gap-2">
          <label htmlFor="replace-received" className="grid min-w-0 gap-1 text-sm font-medium">Recibido (opcional)<AmountInput id="replace-received" value={replaceReceived} onChange={setReplaceReceived} placeholder="0" /></label>
          <p className="grid min-w-0 gap-1 text-sm font-medium">Cambio<output htmlFor="replace-received" data-replace-change className="flex min-h-12 min-w-0 items-center overflow-hidden rounded-2xl bg-[#ECFDF3] px-4 text-xl font-bold text-[#067647]">{replaceChange === null ? "—" : formatPesos(replaceChange)}</output></p>
        </div>}
      </fieldset>
      <button type="button" data-detail-replace disabled={busy} onClick={submitReplace} className={danger}>Anular y registrar {REPLACE_LABELS[replaceMethod]}</button>
    </>)}

    {voidRow && form(`Anular ${voidRow.label} de ${formatPesos(voidRow.amount)}`, <>
      <p className="text-sm text-[var(--vy-text-muted)]">No se borra: queda tachado en el historial con su motivo y se recalcula el saldo.</p>
      {reasonField("void", "Motivo de la anulación")}
      <button type="button" data-detail-void disabled={busy} onClick={submitVoid} className={danger}>Sí, anular</button>
    </>)}

    {!mode && <div data-detail-actions className="space-y-2">
      {actions.chargeAndDeliver && <button type="button" disabled={busy} onClick={() => setMode("charge")} className={primary}><CreditCard aria-hidden="true" className="size-5" />Cobrar y entregar · {formatPesos(balance)}</button>}
      {actions.deliver && <button type="button" disabled={busy} onClick={() => setMode("deliver")} className={primary}><PackageCheck aria-hidden="true" className="size-5" />Entregar</button>}
      <div className="grid gap-2 sm:grid-cols-2">
        {actions.registerPayment && <button type="button" disabled={busy} onClick={() => setMode("pay")} className={secondary}><Wallet aria-hidden="true" className="size-4" />Registrar pago</button>}
        {actions.registerReturn && <button type="button" disabled={busy} onClick={() => setMode("return")} className={secondary}><RotateCcw aria-hidden="true" className="size-4" />Registrar devolución</button>}
        {actions.refundMoney && <button type="button" disabled={busy} onClick={() => setMode("refund")} className={secondary}><Undo2 aria-hidden="true" className="size-4" />Devolver dinero</button>}
        {actions.refundCredit && <button type="button" disabled={busy} onClick={() => setMode("credit")} className={secondary}><Undo2 aria-hidden="true" className="size-4" />Devolver saldo a favor</button>}
        {actions.cancel && <button type="button" disabled={busy} onClick={() => setMode("cancel")} className={`${secondary} text-[#B42318]`}><Ban aria-hidden="true" className="size-4" />Cancelar venta</button>}
      </div>
      {actions.continueDraft && <Link href={`/dashboard/ventas?borrador=${sale.id}`} className={primary}><CircleCheck aria-hidden="true" className="size-5" />Continuar en Vender</Link>}
      {!actions.chargeAndDeliver && !actions.deliver && !actions.registerPayment && !actions.registerReturn && !actions.refundMoney && !actions.refundCredit && !actions.cancel && !actions.continueDraft && actions.voidable.length === 0 && actions.replaceable.length === 0
        && <p className="text-sm text-[var(--vy-text-muted)]">Esta venta ya no tiene acciones pendientes.</p>}
    </div>}
  </section>;
}

function Row({ label, value, strong, tone, data }: { label: string; value: string; strong?: boolean; tone?: string; data?: string }) {
  return <div className="flex items-baseline justify-between gap-3" data-money-row={data}>
    <dt className="text-[var(--vy-text-muted)]">{label}</dt>
    <dd className={`text-right ${strong ? "text-lg font-bold text-[var(--vy-text)]" : "font-semibold"} ${tone ?? "text-[var(--vy-text)]"}`}>{value}</dd>
  </div>;
}
function Notice({ title, detail, children }: { title: string; detail: string; children?: ReactNode }) {
  return <div role="alert" className="space-y-2 rounded-2xl border border-[#F4C7C2] bg-[#FEF3F2] p-4 text-sm text-[#7A271A]">
    <p className="font-semibold text-[#B42318]">{title}</p><p>{detail}</p>
    {children && <div className="flex flex-wrap gap-2">{children}</div>}
  </div>;
}

/** ?venta= with an id that is not a sale id (incomplete or malformed): said plainly instead of opening nothing. */
export function MissingSale({ onClose, inSheet = false }: { onClose: () => void; inSheet?: boolean }) {
  return <section aria-labelledby="sale-missing-title" data-sale-missing className="space-y-3">
    <div className="flex items-start justify-between gap-3">
      <h2 id="sale-missing-title" className="text-xl font-bold text-[var(--vy-text)]">{MISSING.title}</h2>
      {!inSheet && <button type="button" onClick={onClose} aria-label="Cerrar detalle" className={`grid size-11 shrink-0 place-items-center rounded-xl hover:bg-[var(--vy-surface-soft)] ${focus}`}><X aria-hidden="true" className="size-5" /></button>}
    </div>
    <p role="status" className="text-sm text-[var(--vy-text-muted)]">{MISSING.detail}</p>
  </section>;
}
