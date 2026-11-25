"use client";

import { useEffect, useRef, useState } from "react";
import { apiRequest } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Input";
import { AlertDialog, AlertDialogCancel, DialogActions } from "@/components/ui/Dialog";
import { selectClass } from "@/components/sales/CustomerPicker";
import FailureNotice from "@/components/sales/FailureNotice";
import { useSafeCommand } from "@/components/common/useSafeCommand";
import { formatDate } from "@/lib/sales-ui.mjs";
import { describeExpenseFailure, EXPENSE_STATUS_LABELS, EXPENSE_STATUS_TONES, formatCop, formatExpenseDate, parseExpenseDetail, PAYMENT_LABELS,
  type Expense, type ExpenseCategory, type ExpenseEvent } from "@/lib/expenses-ui.mjs";
import ExpenseForm from "./ExpenseForm";

const EVENT_LABELS: Record<string, string> = { CREATED: "Registrado", RECLASSIFIED: "Reclasificado", VOIDED: "Anulado", REPLACED: "Reemplazado" };
const fieldLabels: Record<string, string> = { categoryName: "Categoría", description: "Descripción", paymentMethodNote: "Nota del medio de pago" };

function EventLine({ event }: { event: ExpenseEvent }) {
  const changes = event.eventType === "RECLASSIFIED" && event.before
    ? Object.keys(fieldLabels).filter(k => event.before![k] !== event.after[k]).map(k => `${fieldLabels[k]}: «${String(event.before![k] ?? "—")}» → «${String(event.after[k] ?? "—")}»`) : [];
  return <li className="rounded-xl border border-[#e2e8e0] p-3 text-sm">
    <p className="font-medium">{EVENT_LABELS[event.eventType] ?? event.eventType} · {formatDate(event.occurredAt)}</p>
    {changes.map(c => <p key={c} className="break-words">{c}</p>)}
    {event.eventType === "VOIDED" && typeof event.after.voidReason === "string" && <p className="break-words">Motivo: {event.after.voidReason}</p>}
  </li>;
}

export default function ExpenseDetail({ expenseId, categories, today, onChanged, onOpen, onClose }: {
  expenseId: string; categories: ExpenseCategory[]; today: string; onChanged: () => void; onOpen: (id: string) => void; onClose: () => void;
}) {
  // State is written only when a response arrives; "loading" is derived from the requested revision.
  const [revision, setRevision] = useState(0);
  const [loaded, setLoaded] = useState<{ revision: number; error: ReturnType<typeof describeExpenseFailure> | null } | null>(null);
  const [data, setData] = useState<{ expense: Expense; events: ExpenseEvent[] } | null>(null);
  const [message, setMessage] = useState("");
  const [dialog, setDialog] = useState<null | "reclassify" | "void">(null);
  const [draft, setDraft] = useState({ categoryId: "", description: "", note: "" });
  const [reason, setReason] = useState("");
  const [replace, setReplace] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const command = useSafeCommand(describeExpenseFailure);
  const { run, failure, clearFailure } = command;

  useEffect(() => {
    let active = true;
    apiRequest<unknown>(`/expenses/${expenseId}`).then(parseExpenseDetail).then(
      next => { if (active) { setData(next); setLoaded({ revision, error: null }); } },
      cause => { if (active) setLoaded({ revision, error: describeExpenseFailure(cause) }); });
    return () => { active = false; };
  }, [expenseId, revision]);
  const loadedId = data?.expense.id;
  useEffect(() => { if (loadedId) heading.current?.focus(); }, [loadedId]);
  const loadError = loaded?.revision === revision ? loaded.error : null;
  // After a conflict or failed load, the list and totals may be stale too: refresh them with the detail.
  const reload = () => { clearFailure(); setMessage(""); setRevision(v => v + 1); onChanged(); };
  const done = (text: string) => { setDialog(null); setReason(""); setReplace(false); setMessage(text); setRevision(v => v + 1); onChanged(); };

  if (!data) return <section aria-label="Detalle del gasto" className="space-y-3 rounded-2xl border border-[#dce4dc] bg-white p-5">
    {loadError ? <FailureNotice failure={{ ...loadError, action: loadError.action === "login" ? "login" : "reload" }} busy={false} onReload={reload} reloadLabel="Reintentar cargar el gasto" /> : <p role="status">Cargando gasto…</p>}
    <Button variant="secondary" onClick={onClose}>Volver al listado</Button>
  </section>;

  const { expense, events } = data;
  const locked = command.busy !== null;
  const confirmed = expense.status === "CONFIRMED";
  const openReclassify = () => { setDraft({ categoryId: expense.categoryId, description: expense.description, note: expense.paymentMethodNote ?? "" }); setDialog("reclassify"); };
  function reclassify() {
    const body: Record<string, unknown> = { expectedVersion: expense.version };
    if (draft.categoryId !== expense.categoryId) body.categoryId = draft.categoryId;
    if (draft.description.trim() !== expense.description) body.description = draft.description.trim();
    if (expense.paymentMethod === "OTHER" && draft.note.trim() !== (expense.paymentMethodNote ?? "")) body.paymentMethodNote = draft.note.trim();
    setDialog(null);
    if (Object.keys(body).length === 1) { setMessage("No hay cambios para guardar."); return; }
    void run({ action: "reclassify", resourceId: expense.id, path: `/expenses/${expense.id}`, method: "PATCH", body, withRequestId: true, label: "Reclasificando gasto…" }, () => done("Gasto reclasificado. Quedó registrado en el historial."));
  }
  function voidExpense(replacement?: Record<string, unknown>) {
    setDialog(null);
    void run({ action: "void", resourceId: expense.id, path: `/expenses/${expense.id}/void`, method: "POST", body: { expectedVersion: expense.version, reason: reason.trim(), ...(replacement ? { replacement } : {}) },
      withRequestId: true, label: replacement ? "Anulando y registrando el correcto…" : "Anulando gasto…" }, () => done(replacement ? "Gasto anulado y reemplazado." : "Gasto anulado. Ya no cuenta en los totales."));
  }
  const rows: [string, string | null][] = [
    ["Fecha del gasto", formatExpenseDate(expense.expenseDate)], ["Monto", expense.amount ? formatCop(expense.amount) : null],
    ["Categoría", `${expense.categoryName ?? "—"}${expense.categoryArchived ? " (archivada)" : ""}${expense.categoryNameSnapshot && expense.categoryNameSnapshot !== expense.categoryName ? ` · registrada como «${expense.categoryNameSnapshot}»` : ""}`],
    ["Medio de pago", `${PAYMENT_LABELS[expense.paymentMethod]}${expense.paymentMethodNote ? ` · ${expense.paymentMethodNote}` : ""}`],
    ["Referencia de pago", expense.paymentReference ?? null], ["Proveedor", expense.supplierName], ["Registrado", formatDate(expense.recordedAt)],
    ["Anulado", expense.voidedAt ? `${formatDate(expense.voidedAt)} · ${expense.voidReason}` : null],
  ];

  return <section aria-labelledby={`expense-${expense.id}`} data-expense-id={expense.id} data-expense-version={expense.version} className="space-y-5 rounded-2xl border border-[#dce4dc] bg-white p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 space-y-1">
        <h2 id={`expense-${expense.id}`} ref={heading} tabIndex={-1} className="break-words text-xl font-semibold focus-visible:outline-2 focus-visible:outline-offset-4">{expense.description}</h2>
        <span className={`inline-flex min-h-7 items-center rounded-full border px-2.5 text-xs font-semibold ${EXPENSE_STATUS_TONES[expense.status]}`}>{EXPENSE_STATUS_LABELS[expense.status]}</span>
      </div>
      <Button variant="secondary" disabled={locked} onClick={onClose}>Volver al listado</Button>
    </div>
    <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
      {rows.filter(([, v]) => v).map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-[#52675b]">{label}</dt><dd className="break-words font-medium">{value}</dd></div>)}
    </dl>
    {expense.replacedByExpenseId && <Button variant="secondary" onClick={() => onOpen(expense.replacedByExpenseId!)}>Ver el gasto que lo reemplaza</Button>}
    {expense.replacesExpenseId && <Button variant="secondary" onClick={() => onOpen(expense.replacesExpenseId!)}>Ver el gasto anulado que reemplaza</Button>}
    <p role="status" className="text-sm">{message}</p>
    {command.busy && <p role="status" className="text-sm">{command.busy}</p>}
    {failure && <FailureNotice failure={failure} busy={locked} onRetry={() => void command.retry()} onReload={reload} reloadLabel="Recargar gasto" />}
    {confirmed ? <div className="flex flex-wrap gap-2">
      <Button variant="secondary" disabled={locked} onClick={openReclassify}>Reclasificar</Button>
      <Button variant="destructive" disabled={locked} onClick={() => setDialog("void")}>Anular gasto</Button>
    </div> : <p className="text-sm text-[#52675b]">Este gasto es de solo lectura.</p>}
    <p className="text-xs text-[#52675b]">Para corregir monto, fecha, medio de pago, proveedor o referencia, anula el gasto y registra el correcto.</p>

    <section aria-labelledby={`history-${expense.id}`} className="space-y-2">
      <h3 id={`history-${expense.id}`} className="text-lg font-semibold">Historial</h3>
      <ol className="space-y-2">{events.map(event => <EventLine key={event.id} event={event} />)}</ol>
    </section>

    <AlertDialog open={dialog === "reclassify"} onOpenChange={open => { if (!open) setDialog(null); }} title="Reclasificar gasto" description="Cambia la categoría, la descripción o la nota del medio de pago. El monto, la fecha y el medio no cambian.">
      <div className="mt-4 space-y-3">
        <label className="grid gap-1 text-sm font-medium">Categoría<select className={selectClass} value={draft.categoryId} onChange={e => setDraft(d => ({ ...d, categoryId: e.target.value }))}>
          {categories.filter(c => !c.archivedAt || c.id === expense.categoryId).map(c => <option key={c.id} value={c.id} disabled={Boolean(c.archivedAt)}>{c.name}{c.archivedAt ? " (archivada)" : ""}</option>)}
        </select></label>
        <label className="grid gap-1 text-sm font-medium">Descripción<Textarea maxLength={300} value={draft.description} onChange={e => setDraft(d => ({ ...d, description: e.target.value }))} /></label>
        {expense.paymentMethod === "OTHER" && <label className="grid gap-1 text-sm font-medium">Nota del medio de pago<Input maxLength={80} value={draft.note} onChange={e => setDraft(d => ({ ...d, note: e.target.value }))} /></label>}
      </div>
      <DialogActions><AlertDialogCancel label="Volver" /><Button disabled={!draft.description.trim() || (expense.paymentMethod === "OTHER" && draft.note.trim().length < 3)} onClick={reclassify}>Guardar reclasificación</Button></DialogActions>
    </AlertDialog>

    <AlertDialog open={dialog === "void"} onOpenChange={open => { if (!open) setDialog(null); }} title="¿Anular el gasto?" description="Deja de contar en los totales y queda en el historial. No se puede deshacer.">
      <label className="mt-4 grid gap-1 text-sm font-medium">Motivo de la anulación (obligatorio)<Textarea maxLength={300} value={reason} onChange={e => setReason(e.target.value)} /></label>
      <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" className="size-4" checked={replace} onChange={e => setReplace(e.target.checked)} />Registrar el gasto correcto al anular</label>
      {replace ? <div className="mt-3 rounded-xl border border-[#e2e8e0] p-3">
        <ExpenseForm idPrefix={`replace-${expense.id}`} categories={categories} today={today} busy={locked} disabled={reason.trim().length < 3} submitLabel="Anular y registrar el correcto"
          initial={{ expenseDate: expense.expenseDate, amount: expense.amount ?? "", categoryId: expense.categoryArchived ? "" : expense.categoryId, paymentMethod: expense.paymentMethod,
            paymentMethodNote: expense.paymentMethodNote ?? "", paymentReference: expense.paymentReference ?? "", description: expense.description, supplierName: expense.supplierName ?? "" }}
          onSubmit={payload => voidExpense(payload)} />
        {reason.trim().length < 3 && <p className="mt-2 text-sm text-[#8a2b20]">Escribe primero el motivo (al menos 3 caracteres).</p>}
      </div> : <DialogActions><AlertDialogCancel label="Volver" /><Button variant="destructive" disabled={reason.trim().length < 3} onClick={() => voidExpense()}>Sí, anular el gasto</Button></DialogActions>}
      {replace && <DialogActions><AlertDialogCancel label="Volver" /></DialogActions>}
    </AlertDialog>
  </section>;
}
