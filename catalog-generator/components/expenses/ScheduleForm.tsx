"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Input";
import { addDays, FREQUENCIES, MAX_SCHEDULE_DAYS_AHEAD, PAYMENT_LABELS, PAYMENT_METHODS, validateScheduleForm,
  type ExpenseCategory, type Frequency, type ScheduleForm as Form } from "@/lib/expenses-ui.mjs";
import { AmountInput, panelSelect } from "./Sheet";

const FREQUENCY_OPTIONS: Record<Frequency, string> = { WEEKLY: "Semanas", MONTHLY: "Meses", YEARLY: "Años" };
export const emptyScheduleForm = (today: string): Form => ({ plannedAmount: "", dueDate: today, categoryId: "", paymentMethod: "BANK_TRANSFER", paymentMethodNote: "",
  description: "", supplierName: "", repeat: false, frequency: "MONTHLY", interval: "1", endDate: "" });

/**
 * «Programar pago»: a single future payment or, with «Repetir», a fixed expense. Nothing here is an expense yet:
 * it only counts when it is marked paid. Validates locally; the server validates again.
 */
export default function ScheduleForm({ categories, today, busy, onSubmit }: {
  categories: ExpenseCategory[]; today: string; busy: boolean; onSubmit: (path: "/expenses/scheduled" | "/expenses/recurring", payload: Record<string, unknown>, reset: () => void) => void;
}) {
  const [form, setForm] = useState<Form>(() => emptyScheduleForm(today));
  const [errors, setErrors] = useState<string[]>([]);
  const set = (patch: Partial<Form>) => { setForm(current => ({ ...current, ...patch })); setErrors([]); };
  const active = categories.filter(c => !c.archivedAt);
  const id = (name: string) => `schedule-${name}`;
  function submit() {
    const { errors: problems, path, payload } = validateScheduleForm(form, today);
    setErrors(problems);
    if (!problems.length) onSubmit(path, payload, () => setForm(emptyScheduleForm(today)));
  }
  return <form noValidate className="space-y-3" onSubmit={event => { event.preventDefault(); submit(); }}>
    <fieldset disabled={busy} className="grid gap-3 sm:grid-cols-2">
      <legend className="sr-only">Datos del pago programado</legend>
      <label htmlFor={id("amount")} className="grid gap-1 text-sm font-medium sm:col-span-2">Monto previsto (opcional)
        <AmountInput id={id("amount")} large value={form.plannedAmount} onChange={plannedAmount => set({ plannedAmount })} placeholder="Si aún no lo sabes, déjalo vacío" /></label>
      <label htmlFor={id("due")} className="grid gap-1 text-sm font-medium">{form.repeat ? "Primer vencimiento" : "Vence el"}
        <Input id={id("due")} type="date" min={today} max={addDays(today, MAX_SCHEDULE_DAYS_AHEAD)} value={form.dueDate} onChange={e => set({ dueDate: e.target.value })} /></label>
      <label htmlFor={id("category")} className="grid gap-1 text-sm font-medium">Categoría
        <select id={id("category")} className={panelSelect} value={form.categoryId} onChange={e => set({ categoryId: e.target.value })}>
          <option value="">Elige una categoría</option>{active.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select></label>
      <label htmlFor={id("description")} className="grid gap-1 text-sm font-medium sm:col-span-2">Descripción
        <Textarea id={id("description")} maxLength={300} placeholder="Ej.: Internet del local" value={form.description} onChange={e => set({ description: e.target.value })} /></label>
      <label htmlFor={id("method")} className="grid gap-1 text-sm font-medium">Medio de pago habitual
        <select id={id("method")} className={panelSelect} value={form.paymentMethod} onChange={e => set({ paymentMethod: e.target.value as Form["paymentMethod"] })}>
          {PAYMENT_METHODS.map(m => <option key={m} value={m}>{PAYMENT_LABELS[m]}</option>)}
        </select></label>
      <label htmlFor={id("supplier")} className="grid gap-1 text-sm font-medium">Proveedor (opcional)
        <Input id={id("supplier")} maxLength={160} value={form.supplierName} onChange={e => set({ supplierName: e.target.value })} /></label>
      {form.paymentMethod === "OTHER" && <label htmlFor={id("note")} className="grid gap-1 text-sm font-medium sm:col-span-2">¿Qué medio de pago? (obligatorio con «Otro»)
        <Input id={id("note")} maxLength={80} value={form.paymentMethodNote} onChange={e => set({ paymentMethodNote: e.target.value })} /></label>}
      <label className="flex min-h-11 items-center gap-3 text-sm font-medium sm:col-span-2">
        <input id={id("repeat")} type="checkbox" className="size-5 accent-[var(--vy-blue-600)]" checked={form.repeat} onChange={e => set({ repeat: e.target.checked })} />
        Repetir: es un gasto fijo</label>
      {form.repeat && <div className="grid gap-3 rounded-2xl border border-[var(--vy-border)] bg-[var(--vy-surface-soft)] p-3 sm:col-span-2 sm:grid-cols-3">
        <label htmlFor={id("interval")} className="grid gap-1 text-sm font-medium">Cada
          <select id={id("interval")} className={panelSelect} value={form.interval} onChange={e => set({ interval: e.target.value })}>
            {Array.from({ length: 12 }, (_, i) => String(i + 1)).map(n => <option key={n} value={n}>{n}</option>)}
          </select></label>
        <label htmlFor={id("frequency")} className="grid gap-1 text-sm font-medium">Periodo
          <select id={id("frequency")} className={panelSelect} value={form.frequency} onChange={e => set({ frequency: e.target.value as Frequency })}>
            {FREQUENCIES.map(f => <option key={f} value={f}>{FREQUENCY_OPTIONS[f]}</option>)}
          </select></label>
        <label htmlFor={id("end")} className="grid gap-1 text-sm font-medium">Hasta (opcional)
          <Input id={id("end")} type="date" min={form.dueDate || today} value={form.endDate} onChange={e => set({ endDate: e.target.value })} /></label>
        <p className="text-xs text-[var(--vy-text-muted)] sm:col-span-3">¿Pagas cada quincena? Crea dos gastos fijos mensuales, uno por cada fecha. Si el día no existe en un mes (por ejemplo, el 31), vence el último día.</p>
      </div>}
    </fieldset>
    <p className="text-xs text-[var(--vy-text-muted)]">Un pago programado no suma en tus gastos hasta que lo marques pagado. No escribas números de documento ni cuentas completas.</p>
    {errors.length > 0 && <ul role="alert" className="list-disc space-y-1 rounded-xl border border-[#efc2bd] bg-[#fdf0ee] p-4 pl-8 text-sm text-[#5e1f17]">{errors.map(e => <li key={e}>{e}</li>)}</ul>}
    <Button type="submit" loading={busy} disabled={busy}>{form.repeat ? "Guardar gasto fijo" : "Guardar pago programado"}</Button>
  </form>;
}
