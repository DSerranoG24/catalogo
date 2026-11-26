"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Input";
import { selectClass } from "@/components/sales/CustomerPicker";
import { formatAmountInput, minExpenseDate, PAYMENT_LABELS, PAYMENT_METHODS, possibleDuplicate, validateExpenseForm,
  type Expense, type ExpenseCategory, type ExpenseForm as Form, type ExpensePayload } from "@/lib/expenses-ui.mjs";

export const emptyExpenseForm = (today: string): Form => ({ expenseDate: today, amount: "", categoryId: "", paymentMethod: "CASH", paymentMethodNote: "", paymentReference: "", description: "", supplierName: "" });

/** Register or replace an expense. Validates locally; the server validates again. */
export default function ExpenseForm({ idPrefix, categories, today, initial, recent = [], busy, disabled = false, submitLabel, onSubmit }: {
  idPrefix: string; categories: ExpenseCategory[]; today: string; initial?: Form; recent?: Expense[]; busy: boolean; disabled?: boolean; submitLabel: string;
  onSubmit: (payload: ExpensePayload, reset: () => void) => void;
}) {
  const [form, setForm] = useState<Form>(() => initial ? { ...initial, amount: formatAmountInput(initial.amount, 0).value } : emptyExpenseForm(today));
  // Thousands separators while typing: keep the caret after the same digit (formatAmountInput computes it).
  const amountRef = useRef<HTMLInputElement>(null), caret = useRef<number | null>(null);
  useLayoutEffect(() => {
    const input = amountRef.current, position = caret.current;
    caret.current = null;
    if (input && position !== null && document.activeElement === input) input.setSelectionRange(position, position);
  });
  const [errors, setErrors] = useState<string[]>([]);
  const [duplicate, setDuplicate] = useState(false);
  const active = categories.filter(c => !c.archivedAt);
  const set = (patch: Partial<Form>) => { setForm(current => ({ ...current, ...patch })); setErrors([]); setDuplicate(false); };
  const id = (name: string) => `${idPrefix}-${name}`;
  const payroll = active.find(c => c.id === form.categoryId)?.seedKey === "payroll-fees";

  function submit() {
    const { errors: problems, payload } = validateExpenseForm(form, today);
    setErrors(problems);
    if (problems.length) return;
    if (!duplicate && possibleDuplicate(recent, payload)) { setDuplicate(true); return; }
    onSubmit(payload, () => { setForm(emptyExpenseForm(today)); setDuplicate(false); });
  }
  return <form noValidate className="space-y-3" onSubmit={event => { event.preventDefault(); submit(); }}>
    <fieldset disabled={busy} className="grid gap-3 sm:grid-cols-2">
      <legend className="sr-only">Datos del gasto</legend>
      <label htmlFor={id("amount")} className="grid gap-1 text-sm font-medium text-[var(--vy-text)] sm:col-span-2">Monto en pesos
        <span className="flex items-center gap-2 rounded-2xl border border-[var(--vy-field-border)] bg-white px-4 focus-within:border-[var(--vy-blue-600)] focus-within:ring-4 focus-within:ring-[#0450E5]/25">
          <span aria-hidden="true" className="text-3xl font-bold text-[var(--vy-text-muted)]">$</span>
          <input ref={amountRef} id={id("amount")} inputMode="numeric" autoComplete="off" placeholder="150.000" value={form.amount}
            onChange={e => { const next = formatAmountInput(e.target.value, e.target.selectionStart ?? e.target.value.length, form.amount, (e.nativeEvent as InputEvent).inputType); caret.current = next.caret; set({ amount: next.value }); }}
            className="min-h-16 w-full min-w-0 bg-transparent text-3xl font-bold tracking-tight text-[var(--vy-text)] outline-none placeholder:text-[var(--vy-text-subtle)]" />
        </span></label>
      <label htmlFor={id("date")} className="grid gap-1 text-sm font-medium">Fecha del gasto
        <Input id={id("date")} type="date" min={minExpenseDate(today)} max={today} value={form.expenseDate} onChange={e => set({ expenseDate: e.target.value })} /></label>
      <label htmlFor={id("category")} className="grid gap-1 text-sm font-medium">Categoría
        <select id={id("category")} className={selectClass} value={form.categoryId} onChange={e => set({ categoryId: e.target.value })}>
          <option value="">Elige una categoría</option>{active.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select></label>
      <label htmlFor={id("method")} className="grid gap-1 text-sm font-medium">Medio de pago
        <select id={id("method")} className={selectClass} value={form.paymentMethod} onChange={e => set({ paymentMethod: e.target.value as Form["paymentMethod"] })}>
          {PAYMENT_METHODS.map(m => <option key={m} value={m}>{PAYMENT_LABELS[m]}</option>)}
        </select></label>
      {form.paymentMethod === "OTHER" && <label htmlFor={id("note")} className="grid gap-1 text-sm font-medium sm:col-span-2">¿Qué medio de pago? (obligatorio con «Otro»)
        <Input id={id("note")} maxLength={80} placeholder="Ej.: Bancolombia a la mano" value={form.paymentMethodNote} onChange={e => set({ paymentMethodNote: e.target.value })} /></label>}
      <label htmlFor={id("description")} className="grid gap-1 text-sm font-medium sm:col-span-2">Descripción
        <Textarea id={id("description")} maxLength={300} value={form.description} onChange={e => set({ description: e.target.value })} /></label>
      <label htmlFor={id("supplier")} className="grid gap-1 text-sm font-medium">Proveedor (opcional)
        <Input id={id("supplier")} maxLength={160} value={form.supplierName} onChange={e => set({ supplierName: e.target.value })} /></label>
      <label htmlFor={id("reference")} className="grid gap-1 text-sm font-medium">Referencia de pago (opcional, privada)
        <Input id={id("reference")} maxLength={100} placeholder="Nº de transacción" value={form.paymentReference} onChange={e => set({ paymentReference: e.target.value })} /></label>
    </fieldset>
    <p className="text-xs text-[var(--vy-text-muted)]">No escribas números de documento, cuentas completas ni datos de salud.{payroll && " En nómina y honorarios, identifica a la persona sin datos sensibles."}</p>
    {errors.length > 0 && <ul role="alert" className="list-disc space-y-1 rounded-xl border border-[#efc2bd] bg-[#fdf0ee] p-4 pl-8 text-sm text-[#5e1f17]">{errors.map(e => <li key={e}>{e}</li>)}</ul>}
    {duplicate && <p role="alert" className="rounded-xl border border-[#ecd3a3] bg-[#fdf5e6] p-3 text-sm text-[#7a4f0b]">Ya hay un gasto confirmado de este monto en esa fecha. Si es otro gasto distinto, pulsa de nuevo para registrarlo.</p>}
    <Button type="submit" loading={busy} disabled={busy || disabled}>{submitLabel}</Button>
  </form>;
}
