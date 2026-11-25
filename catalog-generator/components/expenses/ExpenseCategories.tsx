"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { AlertDialog, AlertDialogCancel, DialogActions } from "@/components/ui/Dialog";
import FailureNotice from "@/components/sales/FailureNotice";
import { useSafeCommand } from "@/components/common/useSafeCommand";
import { describeExpenseFailure, type ExpenseCategory } from "@/lib/expenses-ui.mjs";

/** Create, rename, reorder, archive and reactivate categories. Nothing is deleted. */
export default function ExpenseCategories({ categories, onChanged }: { categories: ExpenseCategory[]; onChanged: () => void }) {
  const command = useSafeCommand(describeExpenseFailure);
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [archiving, setArchiving] = useState<ExpenseCategory | null>(null);
  const [message, setMessage] = useState("");
  const locked = command.busy !== null;
  const ordered = [...categories].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
  const done = (text: string) => { setMessage(text); onChanged(); };

  function create() {
    setMessage("");
    void command.run({ action: "createCategory", resourceId: "new", path: "/expense-categories", method: "POST", body: { name: name.trim() }, withRequestId: true, label: "Creando categoría…" },
      () => { setName(""); done("Categoría creada."); });
  }
  const reactivate = (c: ExpenseCategory) => void command.run({ action: "reactivate", resourceId: c.id, path: `/expense-categories/${c.id}/reactivate`, method: "POST", body: { expectedVersion: c.version }, withRequestId: true, label: "Reactivando…" }, () => { setName(""); done(`«${c.name}» reactivada.`); });
  const setPosition = (c: ExpenseCategory, position: number) => command.run({ action: "reorder", resourceId: c.id, path: `/expense-categories/${c.id}`, method: "PATCH", body: { expectedVersion: c.version, position }, withRequestId: true, label: "Reordenando…" }, () => {});
  async function move(index: number, delta: -1 | 1) {
    const a = ordered[index], b = ordered[index + delta];
    if (!a || !b) return;
    if (await setPosition(a, b.position) && await setPosition(b, a.position)) done("Orden actualizado.");
    else onChanged();
  }
  return <section aria-labelledby="expense-categories" className="space-y-4 rounded-2xl border border-[#dce4dc] bg-white p-5">
    <div><h2 id="expense-categories" className="text-xl font-semibold">Categorías</h2>
      <p className="mt-1 text-sm text-[#52675b]">Archivar no borra gastos: la categoría deja de ofrecerse al registrar, pero sigue en el historial y en los totales.</p></div>
    <form className="flex flex-wrap items-end gap-2" onSubmit={e => { e.preventDefault(); if (name.trim()) create(); }}>
      <label htmlFor="new-category" className="grid min-w-0 flex-1 gap-1 text-sm font-medium">Nueva categoría<Input id="new-category" maxLength={60} value={name} disabled={locked} onChange={e => setName(e.target.value)} /></label>
      <Button type="submit" variant="secondary" disabled={locked || !name.trim()}>Crear categoría</Button>
    </form>
    <p role="status" className="text-sm">{message}</p>
    {command.failure && <FailureNotice failure={command.failure} busy={locked} onRetry={() => void command.retry()} onReload={() => { command.clearFailure(); onChanged(); }} reloadLabel="Recargar categorías">
      {command.failure.code === "EXPENSE_CATEGORY_NAME_CONFLICT" && <NameConflict name={name} categories={categories} busy={locked} onReactivate={reactivate} />}
    </FailureNotice>}
    <ul aria-label="Categorías de gastos" className="divide-y divide-[#e2e8e0] rounded-xl border border-[#e2e8e0]">{ordered.map((c, index) => <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
      {editing?.id === c.id ? <form className="flex min-w-0 flex-1 flex-wrap items-end gap-2" onSubmit={e => { e.preventDefault(); void command.run({ action: "rename", resourceId: c.id, path: `/expense-categories/${c.id}`, method: "PATCH", body: { expectedVersion: c.version, name: editing.name.trim() }, withRequestId: true, label: "Renombrando…" }, () => { setEditing(null); done("Categoría renombrada."); }); }}>
        <label className="grid min-w-0 flex-1 gap-1 font-medium">Nuevo nombre de {c.name}<Input maxLength={60} value={editing.name} onChange={e => setEditing({ id: c.id, name: e.target.value })} /></label>
        <Button type="submit" size="sm" disabled={locked || !editing.name.trim()}>Guardar nombre</Button><Button size="sm" variant="secondary" onClick={() => setEditing(null)}>Cancelar</Button>
      </form> : <span className="min-w-0 break-words font-medium">{c.name}{c.archivedAt && <span className="ml-2 rounded-full border border-[#cfd6cf] bg-[#f3f5f2] px-2 text-xs text-[#3f4a43]">Archivada</span>}</span>}
      {editing?.id !== c.id && <span className="flex flex-wrap gap-1">
        <Button size="sm" variant="ghost" disabled={locked || index === 0} aria-label={`Subir ${c.name}`} onClick={() => void move(index, -1)}>↑</Button>
        <Button size="sm" variant="ghost" disabled={locked || index === ordered.length - 1} aria-label={`Bajar ${c.name}`} onClick={() => void move(index, 1)}>↓</Button>
        <Button size="sm" variant="secondary" disabled={locked} onClick={() => setEditing({ id: c.id, name: c.name })}>Renombrar {c.name}</Button>
        {c.archivedAt ? <Button size="sm" variant="secondary" disabled={locked} onClick={() => void command.run({ action: "reactivate", resourceId: c.id, path: `/expense-categories/${c.id}/reactivate`, method: "POST", body: { expectedVersion: c.version }, withRequestId: true, label: "Reactivando…" }, () => done(`«${c.name}» reactivada.`))}>Reactivar {c.name}</Button>
          : <Button size="sm" variant="destructive-ghost" disabled={locked} onClick={() => setArchiving(c)}>Archivar {c.name}</Button>}
      </span>}
    </li>)}</ul>
    <AlertDialog open={archiving !== null} onOpenChange={open => { if (!open) setArchiving(null); }} title={`¿Archivar «${archiving?.name ?? ""}»?`} description="Dejará de ofrecerse al registrar gastos. Los gastos existentes la conservan y puedes reactivarla cuando quieras.">
      <DialogActions><AlertDialogCancel label="Volver" /><Button variant="destructive" onClick={() => { const c = archiving!; setArchiving(null); void command.run({ action: "archive", resourceId: c.id, path: `/expense-categories/${c.id}/archive`, method: "POST", body: { expectedVersion: c.version }, withRequestId: true, label: "Archivando…" }, () => done(`«${c.name}» archivada.`)); }}>Sí, archivar</Button></DialogActions>
    </AlertDialog>
  </section>;
}

/** Offers to reactivate the archived category that blocked the name instead of creating a duplicate. */
function NameConflict({ name, categories, busy, onReactivate }: { name: string; categories: ExpenseCategory[]; busy: boolean; onReactivate: (c: ExpenseCategory) => void }) {
  const key = name.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
  const match = categories.find(c => c.name.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase() === key);
  if (!match) return null;
  return match.archivedAt
    ? <Button variant="secondary" disabled={busy} onClick={() => onReactivate(match)}>Reactivar «{match.name}»</Button>
    : <p className="text-sm">Ya existe «{match.name}» y está activa.</p>;
}
