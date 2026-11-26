"use client";

import { useState } from "react";
import { CalendarClock, CalendarRange, Check, ChevronRight, Repeat, Tag } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Input";
import FailureNotice from "@/components/sales/FailureNotice";
import { useSafeCommand } from "@/components/common/useSafeCommand";
import { addDays, CATEGORY_STYLES, DEFAULT_CATEGORY_STYLE, describeExpenseFailure, formatAmountInput, formatCop, formatExpenseDate, MAX_SCHEDULE_DAYS_AHEAD, minExpenseDate,
  PAYMENT_LABELS, PAYMENT_METHODS, scheduledState, validatePayForm, amountDigits, frequencyLabel, type ExpenseCategory, type PayForm, type ProjectedPayment, type ScheduledFigures,
  type ScheduledPayment } from "@/lib/expenses-ui.mjs";
import { AmountInput, focusRing, panelSelect, Sheet } from "./Sheet";
import { CATEGORY_ICONS } from "./icons";

type Failure = ReturnType<typeof describeExpenseFailure>;
const card = "min-w-0 rounded-2xl border border-[var(--vy-border)] bg-white p-5 shadow-[0_10px_30px_-24px_rgba(1,28,79,0.5)]";

/** «Día 28 · $ 110.000» inside the shown month; the full date otherwise (overdue from an earlier month). */
function dueText(p: ScheduledPayment, month: string) {
  const day = p.dueDate.startsWith(month) ? `Día ${Number(p.dueDate.slice(8))}` : formatExpenseDate(p.dueDate);
  const amount = p.status === "PAID" && p.paidAmount ? formatCop(p.paidAmount) : p.plannedAmount ? formatCop(p.plannedAmount) : "monto por definir";
  return `${day} · ${amount}`;
}

/** «Marcar pagado»: amount preloaded (editable, thousands separators), payment date today by default and never future, method. */
function PayForm({ payment, today, busy, onSubmit }: { payment: ScheduledPayment; today: string; busy: boolean; onSubmit: (payload: Record<string, unknown>) => void }) {
  const [form, setForm] = useState<PayForm>(() => ({ amount: payment.plannedAmount ? formatAmountInput(payment.plannedAmount, 0).value : "", expenseDate: today,
    paymentMethod: payment.paymentMethod, paymentMethodNote: payment.paymentMethodNote ?? "", paymentReference: "" }));
  const [errors, setErrors] = useState<string[]>([]);
  const set = (patch: Partial<PayForm>) => { setForm(current => ({ ...current, ...patch })); setErrors([]); };
  const id = (name: string) => `pay-${name}`;
  const planned = payment.plannedAmount, typed = amountDigits(form.amount);
  function submit() {
    const { errors: problems, payload } = validatePayForm(form, today);
    setErrors(problems);
    if (!problems.length) onSubmit(payload);
  }
  return <form noValidate className="space-y-3" onSubmit={event => { event.preventDefault(); submit(); }}>
    <fieldset disabled={busy} className="grid gap-3 sm:grid-cols-2">
      <legend className="sr-only">Datos del pago</legend>
      <label htmlFor={id("amount")} className="grid gap-1 text-sm font-medium sm:col-span-2">Monto pagado
        <AmountInput id={id("amount")} large value={form.amount} onChange={amount => set({ amount })} /></label>
      {planned && typed && typed !== planned && <p className="text-sm text-[var(--vy-text-muted)] sm:col-span-2">El monto previsto era {formatCop(planned)}. Se registrará el monto que escribiste.</p>}
      <label htmlFor={id("date")} className="grid gap-1 text-sm font-medium">Fecha de pago
        <Input id={id("date")} type="date" min={minExpenseDate(today)} max={today} value={form.expenseDate} onChange={e => set({ expenseDate: e.target.value })} /></label>
      <label htmlFor={id("method")} className="grid gap-1 text-sm font-medium">Medio de pago
        <select id={id("method")} className={panelSelect} value={form.paymentMethod} onChange={e => set({ paymentMethod: e.target.value as PayForm["paymentMethod"] })}>
          {PAYMENT_METHODS.map(m => <option key={m} value={m}>{PAYMENT_LABELS[m]}</option>)}
        </select></label>
      {form.paymentMethod === "OTHER" && <label htmlFor={id("note")} className="grid gap-1 text-sm font-medium sm:col-span-2">¿Qué medio de pago? (obligatorio con «Otro»)
        <Input id={id("note")} maxLength={80} value={form.paymentMethodNote} onChange={e => set({ paymentMethodNote: e.target.value })} /></label>}
      <label htmlFor={id("reference")} className="grid gap-1 text-sm font-medium sm:col-span-2">Referencia de pago (opcional, privada)
        <Input id={id("reference")} maxLength={100} placeholder="Nº de transacción" value={form.paymentReference} onChange={e => set({ paymentReference: e.target.value })} /></label>
    </fieldset>
    <p className="text-xs text-[var(--vy-text-muted)]">Se registrará un gasto con esta fecha y este monto en «{payment.categoryName ?? "su categoría"}». Si te equivocas, anula ese gasto: el pago volverá a quedar pendiente.</p>
    {errors.length > 0 && <ul role="alert" className="list-disc space-y-1 rounded-xl border border-[#efc2bd] bg-[#fdf0ee] p-4 pl-8 text-sm text-[#5e1f17]">{errors.map(e => <li key={e}>{e}</li>)}</ul>}
    <Button type="submit" loading={busy} disabled={busy}>Confirmar pago</Button>
  </form>;
}

type Mode = "menu" | "pay" | "reschedule" | "omit";

/**
 * Right-column card «Gastos fijos» (design: gastos.png): this month's fixed-expense occurrences, single scheduled payments
 * and every overdue one, with their state and «Marcar pagado». Nothing here adds to any total until it is paid.
 */
export default function ScheduledPayments({ month, today, items, projected = [], planned = null, truncated, error, categories, onReload, onChanged, onManage, onSchedule, onOpenExpense }: {
  month: string; today: string; items: ScheduledPayment[] | null; projected?: ProjectedPayment[]; planned?: ScheduledFigures["planned"]; truncated: boolean; error: Failure | null; categories: ExpenseCategory[];
  onReload: () => void; onChanged: (message: string) => void; onManage: () => void; onSchedule: () => void; onOpenExpense: (id: string) => void;
}) {
  const [selected, setSelected] = useState<{ payment: ScheduledPayment; mode: Mode } | null>(null);
  const [draft, setDraft] = useState({ dueDate: "", plannedAmount: "", reason: "" });
  const command = useSafeCommand(describeExpenseFailure);
  const busy = command.busy !== null;
  const categoryOf = (id: string) => categories.find(c => c.id === id);
  const open = (payment: ScheduledPayment, mode: Mode) => {
    command.clearFailure();
    setDraft({ dueDate: payment.dueDate < today ? today : payment.dueDate, plannedAmount: payment.plannedAmount ? formatAmountInput(payment.plannedAmount, 0).value : "", reason: "" });
    setSelected({ payment, mode });
  };
  const finish = (text: string) => { setSelected(null); onChanged(text); };

  function pay(payment: ScheduledPayment, payload: Record<string, unknown>) {
    void command.run({ action: "pay", resourceId: payment.id, path: `/expenses/scheduled/${payment.id}/pay`, method: "POST", body: { expectedVersion: payment.version, ...payload },
      withRequestId: true, label: "Registrando el pago…" }, () => finish(`«${payment.description}» quedó pagado y se registró como gasto.`));
  }
  const rescheduleErrors = (() => {
    if (!selected || selected.mode !== "reschedule") return [];
    const list: string[] = [];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.dueDate) || draft.dueDate < today || draft.dueDate > addDays(today, MAX_SCHEDULE_DAYS_AHEAD)) list.push("Elige una fecha de hoy en adelante, como máximo a un año.");
    if (draft.plannedAmount.trim() && !amountDigits(draft.plannedAmount)) list.push("El monto previsto debe estar entre $ 1 y $ 1.000.000.000.000.");
    return list;
  })();
  function reschedule(payment: ScheduledPayment) {
    const planned = draft.plannedAmount.trim() ? amountDigits(draft.plannedAmount) : null;
    const body: Record<string, unknown> = { expectedVersion: payment.version };
    if (draft.dueDate !== payment.dueDate) body.dueDate = draft.dueDate;
    if (planned !== payment.plannedAmount) body.plannedAmount = planned;
    if (Object.keys(body).length === 1) { finish("No hay cambios para guardar."); return; }
    void command.run({ action: "reschedule", resourceId: payment.id, path: `/expenses/scheduled/${payment.id}`, method: "PATCH", body, withRequestId: true, label: "Reprogramando…" },
      () => finish(`«${payment.description}» quedó para el ${formatExpenseDate(draft.dueDate)}.`));
  }
  function omit(payment: ScheduledPayment) {
    const reason = draft.reason.trim();
    void command.run({ action: "cancel", resourceId: payment.id, path: `/expenses/scheduled/${payment.id}/cancel`, method: "POST", body: { expectedVersion: payment.version, ...(reason ? { reason } : {}) },
      withRequestId: true, label: "Omitiendo el pago…" }, () => finish(`«${payment.description}» se omitió. No se registró ningún gasto.`));
  }

  const current = selected?.payment;
  // Future months: generated payments and projected dates (informative only) in one list by due date.
  const rows: ({ kind: "real"; payment: ScheduledPayment } | { kind: "projected"; payment: ProjectedPayment })[] = items ? [
    ...items.map(payment => ({ kind: "real" as const, payment })), ...projected.map(payment => ({ kind: "projected" as const, payment }))] : [];
  if (projected.length) rows.sort((a, b) => a.payment.dueDate.localeCompare(b.payment.dueDate));
  const tileOf = (categoryId: string) => {
    const seed = categoryOf(categoryId)?.seedKey, style = (seed && CATEGORY_STYLES[seed]) || DEFAULT_CATEGORY_STYLE;
    return { style, Icon: CATEGORY_ICONS[style.icon] ?? Tag };
  };
  const titles: Record<Mode, string> = { menu: "Pago programado", pay: "Marcar pagado", reschedule: "Reprogramar pago", omit: "Omitir este pago" };
  return <section aria-labelledby="scheduled-title" className={card} data-scheduled-card>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 id="scheduled-title" tabIndex={-1} className="flex items-center gap-3 text-lg font-semibold focus-visible:outline-2 focus-visible:outline-offset-4"><Repeat aria-hidden="true" className="size-6 text-[var(--vy-blue-600)]" />Gastos fijos</h2>
      <button type="button" onClick={onManage} className={`inline-flex min-h-11 items-center gap-1 rounded-xl px-2 font-semibold text-[var(--vy-blue-600)] hover:bg-[var(--vy-surface-soft)] ${focusRing}`}>Administrar<ChevronRight aria-hidden="true" className="size-5" /></button>
    </div>
    {error && <div className="mt-3"><FailureNotice failure={{ ...error, action: error.action === "login" ? "login" : "reload" }} busy={false} onReload={onReload} reloadLabel="Reintentar pagos programados" /></div>}
    {!items && !error && <div aria-hidden="true" className="mt-4 space-y-3">{[0, 1].map(i => <div key={i} className="h-14 animate-pulse rounded-xl bg-[var(--vy-surface-soft)]" />)}</div>}
    {planned && <p className="mt-3 rounded-xl bg-[var(--vy-surface-soft)] px-3 py-2 text-sm" data-planned-total>
      <span className="font-semibold text-[var(--vy-text)]">Previsto del mes: {formatCop(planned.plannedTotal)}</span>
      <span className="text-[var(--vy-text-muted)]"> · {planned.count} {planned.count === 1 ? "pago" : "pagos"}{planned.withoutAmount ? ` · ${planned.withoutAmount} sin monto` : ""}</span></p>}
    {items && !rows.length && <div className="mt-4 space-y-3">
      <p className="text-[var(--vy-text-muted)]">No hay gastos fijos ni pagos programados en este mes.</p>
      <Button variant="secondary" onClick={onSchedule}>Programar pago</Button>
    </div>}
    {rows.length > 0 && <ul aria-label="Pagos programados" className="mt-2 divide-y divide-[var(--vy-border)]">{rows.map(row => {
      if (row.kind === "projected") {
        const p = row.payment, { style, Icon } = tileOf(p.categoryId);
        return <li key={`${p.templateId}:${p.dueDate}`} data-projected={p.templateId} data-scheduled-state="projected" className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
          <span className="flex min-w-0 flex-1 basis-48 items-center gap-3">
            <span aria-hidden="true" className={`grid size-11 shrink-0 place-items-center rounded-2xl opacity-70 ${style.tone}`}><Icon className="size-5" /></span>
            <span className="min-w-0">
              <span className="block break-words font-semibold text-[var(--vy-text)]">{p.description}</span>
              <span className="block text-sm text-[var(--vy-text-muted)]">Día {Number(p.dueDate.slice(8))} · {p.plannedAmount ? formatCop(p.plannedAmount) : "monto por definir"} · {frequencyLabel(p.frequency, p.interval).toLocaleLowerCase("es-CO")}</span>
            </span>
          </span>
          <span className="ml-auto inline-flex min-h-8 shrink-0 items-center gap-1 rounded-full border border-dashed border-[#8592AD] bg-white px-3 text-sm font-semibold text-[#334155]"
            title="Fecha prevista de un gasto fijo. Se podrá pagar cuando se acerque."><CalendarRange aria-hidden="true" className="size-4" />Proyectado</span>
        </li>;
      }
      const p = row.payment, state = scheduledState(p), { style, Icon } = tileOf(p.categoryId);
      return <li key={p.id} data-scheduled-id={p.id} data-scheduled-state={state.key} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
        <button type="button" onClick={() => open(p, "menu")} aria-label={`Opciones de ${p.description}, ${state.label}`} className={`flex min-w-0 flex-1 basis-48 items-center gap-3 rounded-xl text-left hover:bg-[var(--vy-surface-soft)] ${focusRing}`}>
          <span aria-hidden="true" className={`grid size-11 shrink-0 place-items-center rounded-2xl ${style.tone}`}><Icon className="size-5" /></span>
          <span className="min-w-0">
            <span className="block break-words font-semibold text-[var(--vy-text)]">{p.description}{p.kind === "single" && <span className="ml-2 rounded-full bg-[#F1F4FA] px-2 py-0.5 align-middle text-xs font-semibold text-[#334155]">Único</span>}</span>
            <span className="block text-sm text-[var(--vy-text-muted)]">{dueText(p, month)}</span>
          </span>
        </button>
        <span className="ml-auto flex shrink-0 items-center gap-2">
          <span className={`inline-flex min-h-8 items-center rounded-full px-3 text-sm font-semibold ${state.tone}`}>{state.key === "paid" && <Check aria-hidden="true" className="mr-1 size-4" />}{state.label}</span>
          {p.status === "PENDING" && <button type="button" onClick={() => open(p, "pay")} aria-label={`Marcar pagado: ${p.description}`}
            className={`inline-flex min-h-11 items-center rounded-xl px-3 text-sm font-semibold transition ${focusRing} ${state.key === "pending" ? "bg-[#E6EEFF] text-[var(--vy-blue-600)] hover:bg-[#D6E2FF]" : "bg-[var(--vy-blue-600)] text-white hover:bg-[var(--vy-blue-700)]"}`}>Marcar pagado</button>}
        </span>
      </li>;
    })}</ul>}
    {truncated && <p className="mt-2 text-sm text-[#7a4f0b]">Se muestran los primeros 500 pagos.</p>}
    <p className="mt-3 flex items-start gap-2 text-xs text-[var(--vy-text-muted)]"><CalendarClock aria-hidden="true" className="mt-0.5 size-4 shrink-0" />Los pagos programados no suman en tus gastos hasta que los marcas pagados.{projected.length > 0 && " «Proyectado» es una fecha prevista de un gasto fijo: solo informa y se podrá pagar cuando se acerque."}</p>

    <Sheet open={selected !== null} onOpenChange={value => { if (!value && !busy) setSelected(null); }} title={titles[selected?.mode ?? "menu"]}
      description={current ? `${current.description} · ${current.kind === "fixed" ? "gasto fijo" : "pago único"} · vence el ${formatExpenseDate(current.dueDate)}` : undefined}>
      {current && <div className="space-y-4" data-scheduled-dialog={current.id}>
        {selected?.mode === "menu" && <>
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            {([["Estado", scheduledState(current).label], ["Vencimiento", formatExpenseDate(current.dueDate)],
              ["Monto previsto", current.plannedAmount ? formatCop(current.plannedAmount) : "Por definir"], ["Categoría", current.categoryName ?? "—"],
              ["Medio de pago", `${PAYMENT_LABELS[current.paymentMethod]}${current.paymentMethodNote ? ` · ${current.paymentMethodNote}` : ""}`], ["Proveedor", current.supplierName],
              ["Pagado", current.status === "PAID" && current.paidAmount && current.paidDate ? `${formatCop(current.paidAmount)} el ${formatExpenseDate(current.paidDate)}` : null]] as [string, string | null][])
              .filter(([, value]) => value).map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-[var(--vy-text-muted)]">{label}</dt><dd className="break-words font-medium">{value}</dd></div>)}
          </dl>
          {current.kind === "fixed" && <p className="text-sm text-[var(--vy-text-muted)]">Es una fecha de un gasto fijo. Para cambiar las próximas, usa «Administrar».</p>}
          <div className="flex flex-wrap gap-2">
            {current.status === "PENDING" && <>
              <Button onClick={() => setSelected({ payment: current, mode: "pay" })}>Marcar pagado</Button>
              <Button variant="secondary" onClick={() => setSelected({ payment: current, mode: "reschedule" })}>Reprogramar</Button>
              <Button variant="secondary" onClick={() => setSelected({ payment: current, mode: "omit" })}>Omitir este pago</Button>
            </>}
            {current.status === "PAID" && current.paidExpenseId && <Button variant="secondary" onClick={() => { const id = current.paidExpenseId!; setSelected(null); onOpenExpense(id); }}>Ver el gasto registrado</Button>}
          </div>
        </>}
        {selected?.mode === "pay" && <PayForm payment={current} today={today} busy={busy} onSubmit={payload => pay(current, payload)} />}
        {selected?.mode === "reschedule" && <form noValidate className="space-y-3" onSubmit={event => { event.preventDefault(); if (!rescheduleErrors.length) reschedule(current); }}>
          <fieldset disabled={busy} className="grid gap-3 sm:grid-cols-2">
            <legend className="sr-only">Nueva fecha</legend>
            <label htmlFor="reschedule-date" className="grid gap-1 text-sm font-medium">Nueva fecha de vencimiento
              <Input id="reschedule-date" type="date" min={today} max={addDays(today, MAX_SCHEDULE_DAYS_AHEAD)} value={draft.dueDate} onChange={e => setDraft(d => ({ ...d, dueDate: e.target.value }))} /></label>
            <label htmlFor="reschedule-amount" className="grid gap-1 text-sm font-medium">Monto previsto (opcional)
              <AmountInput id="reschedule-amount" value={draft.plannedAmount} onChange={plannedAmount => setDraft(d => ({ ...d, plannedAmount }))} placeholder="Por definir" /></label>
          </fieldset>
          {current.kind === "fixed" && <p className="text-xs text-[var(--vy-text-muted)]">Solo cambia esta fecha; el gasto fijo y sus próximas fechas siguen igual.</p>}
          {rescheduleErrors.length > 0 && <ul role="alert" className="list-disc space-y-1 rounded-xl border border-[#efc2bd] bg-[#fdf0ee] p-4 pl-8 text-sm text-[#5e1f17]">{rescheduleErrors.map(e => <li key={e}>{e}</li>)}</ul>}
          <Button type="submit" loading={busy} disabled={busy || rescheduleErrors.length > 0}>Guardar nueva fecha</Button>
        </form>}
        {selected?.mode === "omit" && <form noValidate className="space-y-3" onSubmit={event => { event.preventDefault(); omit(current); }}>
          <p className="text-sm">No se registrará ningún gasto y este pago dejará de aparecer como pendiente. No se puede deshacer{current.kind === "fixed" ? "; las próximas fechas del gasto fijo siguen igual" : ""}.</p>
          <label htmlFor="omit-reason" className="grid gap-1 text-sm font-medium">Motivo (opcional)
            <Textarea id="omit-reason" maxLength={300} disabled={busy} value={draft.reason} onChange={e => setDraft(d => ({ ...d, reason: e.target.value }))} /></label>
          <Button type="submit" variant="destructive" loading={busy} disabled={busy}>Sí, omitir este pago</Button>
        </form>}
        {selected?.mode !== "menu" && <Button variant="secondary" disabled={busy} onClick={() => { command.clearFailure(); setSelected({ payment: current, mode: "menu" }); }}>Volver</Button>}
        <p role="status" className="text-sm empty:hidden">{command.busy}</p>
        {command.failure && <FailureNotice failure={command.failure} busy={busy} onRetry={() => void command.retry()} onReload={() => { command.clearFailure(); setSelected(null); onReload(); }} reloadLabel="Recargar pagos" />}
      </div>}
    </Sheet>
  </section>;
}
