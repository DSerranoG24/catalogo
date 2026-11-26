"use client";

import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Input";
import { AlertDialog, AlertDialogCancel, DialogActions } from "@/components/ui/Dialog";
import FailureNotice from "@/components/sales/FailureNotice";
import { useSafeCommand } from "@/components/common/useSafeCommand";
import { amountDigits, describeExpenseFailure, formatAmountInput, formatCop, formatExpenseDate, FREQUENCIES, frequencyLabel, parseRecurringList,
  type ExpenseCategory, type Frequency, type RecurringExpense } from "@/lib/expenses-ui.mjs";
import { ChevronDown } from "lucide-react";
import { AmountInput, focusRing, panelSelect } from "./Sheet";

const endedDate = new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", dateStyle: "medium" });

type Failure = ReturnType<typeof describeExpenseFailure>;
const STATUS: Record<RecurringExpense["status"], { label: string; tone: string }> = {
  ACTIVE: { label: "Activo", tone: "bg-[#E6EEFF] text-[#1D4ED8]" }, PAUSED: { label: "En pausa", tone: "bg-[#FFF1E6] text-[#B93815]" }, ENDED: { label: "Terminado", tone: "bg-[#F1F4FA] text-[#334155]" },
};
const UNITS: Record<Frequency, string> = { WEEKLY: "Semanas", MONTHLY: "Meses", YEARLY: "Años" };
type Draft = { description: string; amount: string; categoryId: string; frequency: Frequency; interval: string };

/**
 * «Administrar»: the account's fixed expenses (active and paused). Editing changes the future pending dates that were not
 * edited by hand (decision F1b-5); pausing cancels the future pending ones; resuming generates again; ending is final.
 */
export default function RecurringManager({ categories, onChanged }: { categories: ExpenseCategory[]; onChanged: (message: string) => void }) {
  const [revision, setRevision] = useState(0);
  const [loaded, setLoaded] = useState<{ revision: number; items: RecurringExpense[] | null; error: Failure | null } | null>(null);
  useEffect(() => {
    let active = true;
    apiRequest<unknown>("/expenses/recurring?status=all").then(parseRecurringList).then(
      items => { if (active) setLoaded({ revision, items, error: null }); },
      cause => { if (active) setLoaded({ revision, items: null, error: describeExpenseFailure(cause) }); });
    return () => { active = false; };
  }, [revision]);
  const current = loaded?.revision === revision ? loaded : null;
  const all = current?.items ?? (loaded?.items ?? null);
  // Active and paused can be managed; ended ones are listed apart, read only.
  const items = all?.filter(t => t.status !== "ENDED") ?? null, ended = all?.filter(t => t.status === "ENDED") ?? [];
  const [editing, setEditing] = useState<{ template: RecurringExpense; draft: Draft } | null>(null);
  const [ending, setEnding] = useState<RecurringExpense | null>(null);
  const [message, setMessage] = useState("");
  const command = useSafeCommand(describeExpenseFailure);
  const busy = command.busy !== null;
  const done = (text: string) => { setEditing(null); setEnding(null); setMessage(text); setRevision(v => v + 1); onChanged(text); };

  function state(template: RecurringExpense, action: "pause" | "resume" | "end") {
    const labels = { pause: ["Pausando…", "quedó en pausa. Sus fechas futuras pendientes se cancelaron."], resume: ["Reanudando…", "se reanudó."], end: ["Terminando…", "terminó. Sus fechas futuras pendientes se cancelaron."] }[action];
    void command.run({ action, resourceId: template.id, path: `/expenses/recurring/${template.id}/${action}`, method: "POST", body: { expectedVersion: template.version }, withRequestId: true, label: labels[0] },
      () => done(`«${template.description}» ${labels[1]}`));
  }
  const draftErrors = (() => {
    if (!editing) return [];
    const list: string[] = [], d = editing.draft;
    if (!d.description.trim() || d.description.trim().length > 300) list.push("Escribe una descripción de 1 a 300 caracteres.");
    if (d.amount.trim() && !amountDigits(d.amount)) list.push("El monto estimado debe estar entre $ 1 y $ 1.000.000.000.000.");
    if (!d.categoryId) list.push("Elige una categoría activa.");
    return list;
  })();
  function save() {
    if (!editing) return;
    const { template: t, draft: d } = editing, amount = d.amount.trim() ? amountDigits(d.amount) : null;
    const body: Record<string, unknown> = { expectedVersion: t.version };
    if (d.description.trim() !== t.description) body.description = d.description.trim();
    if (amount !== t.estimatedAmount) body.estimatedAmount = amount;
    if (d.categoryId !== t.categoryId) body.categoryId = d.categoryId;
    if (d.frequency !== t.frequency) body.frequency = d.frequency;
    if (Number(d.interval) !== t.interval) body.interval = Number(d.interval);
    if (Object.keys(body).length === 1) { setEditing(null); setMessage("No hay cambios para guardar."); return; }
    void command.run({ action: "edit", resourceId: t.id, path: `/expenses/recurring/${t.id}`, method: "PATCH", body, withRequestId: true, label: "Guardando gasto fijo…" },
      () => done(`«${d.description.trim()}» se actualizó. Las próximas fechas pendientes usan los nuevos datos.`));
  }

  return <div className="space-y-4" data-recurring-manager>
    <p role="status" className="text-sm font-medium text-[#1D4ED8] empty:hidden">{message}</p>
    {current?.error && <FailureNotice failure={{ ...current.error, action: current.error.action === "login" ? "login" : "reload" }} busy={false} onReload={() => setRevision(v => v + 1)} reloadLabel="Reintentar" />}
    {!items && !current?.error && <p role="status" className="text-sm text-[var(--vy-text-muted)]">Cargando gastos fijos…</p>}
    {items && !items.length && <p className="text-[var(--vy-text-muted)]">{ended.length ? "No tienes gastos fijos activos." : "Aún no tienes gastos fijos."} Usa «Programar pago» y marca «Repetir».</p>}
    {items && items.length > 0 && <ul aria-label="Gastos fijos" className="space-y-3">{items.map(t => {
      const isEditing = editing?.template.id === t.id;
      return <li key={t.id} data-recurring-id={t.id} className="space-y-3 rounded-2xl border border-[var(--vy-border)] p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="break-words font-semibold">{t.description}</p>
            <p className="text-sm text-[var(--vy-text-muted)]">{frequencyLabel(t.frequency, t.interval)} · {t.estimatedAmount ? formatCop(t.estimatedAmount) : "monto por definir"} · {t.categoryName ?? "—"}</p>
            <p className="text-sm text-[var(--vy-text-muted)]">{t.status === "ACTIVE" && t.nextDate ? `Próxima fecha: ${formatExpenseDate(t.nextDate)}` : t.status === "PAUSED" ? "En pausa: no genera fechas" : "Sin próximas fechas"}{t.endDate ? ` · hasta el ${formatExpenseDate(t.endDate)}` : ""}</p>
          </div>
          <span className={`inline-flex min-h-7 items-center rounded-full px-2.5 text-xs font-semibold ${STATUS[t.status].tone}`}>{STATUS[t.status].label}</span>
        </div>
        {isEditing ? <form noValidate className="space-y-3" onSubmit={event => { event.preventDefault(); if (!draftErrors.length) save(); }}>
          <fieldset disabled={busy} className="grid gap-3 sm:grid-cols-2">
            <legend className="sr-only">Editar gasto fijo</legend>
            <label htmlFor="recurring-description" className="grid gap-1 text-sm font-medium sm:col-span-2">Descripción
              <Textarea id="recurring-description" maxLength={300} value={editing.draft.description} onChange={e => setEditing(x => x && { ...x, draft: { ...x.draft, description: e.target.value } })} /></label>
            <label htmlFor="recurring-amount" className="grid gap-1 text-sm font-medium">Monto estimado (opcional)
              <AmountInput id="recurring-amount" value={editing.draft.amount} placeholder="Por definir" onChange={amount => setEditing(x => x && { ...x, draft: { ...x.draft, amount } })} /></label>
            <label htmlFor="recurring-category" className="grid gap-1 text-sm font-medium">Categoría
              <select id="recurring-category" className={panelSelect} value={editing.draft.categoryId} onChange={e => setEditing(x => x && { ...x, draft: { ...x.draft, categoryId: e.target.value } })}>
                <option value="">Elige una categoría</option>{categories.filter(c => !c.archivedAt).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select></label>
            <label htmlFor="recurring-interval" className="grid gap-1 text-sm font-medium">Cada
              <select id="recurring-interval" className={panelSelect} value={editing.draft.interval} onChange={e => setEditing(x => x && { ...x, draft: { ...x.draft, interval: e.target.value } })}>
                {Array.from({ length: 12 }, (_, i) => String(i + 1)).map(n => <option key={n} value={n}>{n}</option>)}
              </select></label>
            <label htmlFor="recurring-frequency" className="grid gap-1 text-sm font-medium">Periodo
              <select id="recurring-frequency" className={panelSelect} value={editing.draft.frequency} onChange={e => setEditing(x => x && { ...x, draft: { ...x.draft, frequency: e.target.value as Frequency } })}>
                {FREQUENCIES.map(f => <option key={f} value={f}>{UNITS[f]}</option>)}
              </select></label>
          </fieldset>
          <p className="text-xs text-[var(--vy-text-muted)]">Los cambios se aplican a las próximas fechas pendientes que no hayas editado a mano. Lo ya pagado no cambia.</p>
          {draftErrors.length > 0 && <ul role="alert" className="list-disc space-y-1 rounded-xl border border-[#efc2bd] bg-[#fdf0ee] p-4 pl-8 text-sm text-[#5e1f17]">{draftErrors.map(e => <li key={e}>{e}</li>)}</ul>}
          <div className="flex flex-wrap gap-2"><Button type="submit" loading={busy} disabled={busy || draftErrors.length > 0}>Guardar cambios</Button><Button variant="secondary" disabled={busy} onClick={() => setEditing(null)}>Cancelar</Button></div>
        </form> : <div className="flex flex-wrap gap-2">
          <Button variant="secondary" disabled={busy} onClick={() => { command.clearFailure(); setEditing({ template: t, draft: { description: t.description, amount: t.estimatedAmount ? formatAmountInput(t.estimatedAmount, 0).value : "",
            categoryId: t.categoryArchived ? "" : t.categoryId, frequency: t.frequency, interval: String(t.interval) } }); }}>Editar</Button>
          {t.status === "ACTIVE" && <Button variant="secondary" disabled={busy} onClick={() => state(t, "pause")}>Pausar</Button>}
          {t.status === "PAUSED" && <Button variant="secondary" disabled={busy} onClick={() => state(t, "resume")}>Reanudar</Button>}
          <Button variant="destructive" disabled={busy} onClick={() => setEnding(t)}>Terminar</Button>
        </div>}
      </li>;
    })}</ul>}
    {ended.length > 0 && <details className="group rounded-2xl border border-[var(--vy-border)] p-4" data-recurring-ended>
      <summary className={`flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-xl font-semibold ${focusRing}`}>
        <span>Terminados ({ended.length})</span><ChevronDown aria-hidden="true" className="size-5 transition group-open:rotate-180" /></summary>
      <ul aria-label="Gastos fijos terminados" className="mt-2 divide-y divide-[var(--vy-border)]">{ended.map(t => <li key={t.id} data-recurring-id={t.id} className="py-3 text-sm">
        <p className="break-words font-semibold">{t.description}</p>
        <p className="text-[var(--vy-text-muted)]">{frequencyLabel(t.frequency, t.interval)} · {t.estimatedAmount ? formatCop(t.estimatedAmount) : "monto por definir"} · {t.categoryName ?? "—"}{t.categoryArchived ? " (archivada)" : ""}</p>
        <p className="text-[var(--vy-text-muted)]">{t.endedAt ? `Terminó el ${endedDate.format(new Date(t.endedAt))}` : "Terminado"}</p>
      </li>)}</ul>
      <p className="mt-2 text-xs text-[var(--vy-text-muted)]">Solo lectura: los pagos ya registrados siguen en tus gastos.</p>
    </details>}
    <p role="status" className="text-sm empty:hidden">{command.busy}</p>
    {command.failure && <FailureNotice failure={command.failure} busy={busy} onRetry={() => void command.retry()} onReload={() => { command.clearFailure(); setEditing(null); setRevision(v => v + 1); }} reloadLabel="Recargar gastos fijos" />}

    <AlertDialog theme="panel" open={ending !== null} onOpenChange={open => { if (!open) setEnding(null); }} title="¿Terminar el gasto fijo?"
      description="Deja de generar fechas y se cancelan sus fechas futuras pendientes. Lo ya pagado queda en el historial. No se puede deshacer.">
      <DialogActions><AlertDialogCancel label="Volver" /><Button variant="destructive" disabled={busy} onClick={() => ending && state(ending, "end")}>Sí, terminar</Button></DialogActions>
    </AlertDialog>
  </div>;
}
