"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { apiRequest, type Category } from "@/lib/api";
import type { SelectedProduct } from "@/lib/product-bulk-selection";

type Operation = { action: "delete" | "discard" } | { action: "price"; price: number }
  | { action: "category"; categoryId: string | null }
  | { action: "promotion"; promotion: { salePrice: number; saleStartsAt: string; saleEndsAt: string } | null };
type Preview = { token: string | null; totalSelected: number; affected: number;
  issues: { id: string; message: string }[];
  changes: { id: string; name: string; skipped: boolean; before: Record<string, string | number | null>; after: Record<string, string | number | null> }[] };
type Result = { totalSelected: number; changed: number; skipped: number; storageWarning: string | null };

export default function ProductBulkActions({ catalogId, categories, items, busy, editorDirty, onBusy, onExit, onExecuted }: {
  catalogId: string; categories: Category[]; items: readonly SelectedProduct[]; busy: boolean;
  editorDirty: boolean;
  onBusy: (busy: boolean) => void; onExit: () => void; onExecuted: () => void;
}) {
  const [action, setAction] = useState<Operation["action"]>("price");
  const [price, setPrice] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [salePrice, setSalePrice] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [removePromotion, setRemovePromotion] = useState(false);
  const [preview, setPreview] = useState<{ value: Preview; items: readonly SelectedProduct[] } | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const current = preview?.items === items ? preview.value : null;
  const destructive = action === "delete" || action === "discard";
  const phrase = `${action === "delete" ? "ELIMINAR" : "DESCARTAR"} ${items.length}`;
  const invalidate = () => { setPreview(null); setConfirmation(""); setError(""); };
  const amount = (text: string) => {
    const value = Number(text);
    if (!text.trim() || !Number.isInteger(value) || value < 0 || value > 2147483647) throw new Error("Introduce un precio entero entre 0 y 2147483647.");
    return value;
  };
  function operation(): Operation {
    if (action === "price") return { action, price: amount(price) };
    if (action === "category") return { action, categoryId: categoryId || null };
    if (action === "promotion") {
      if (removePromotion) return { action, promotion: null };
      if (!start || !end || !Number.isFinite(Date.parse(start)) || !Number.isFinite(Date.parse(end)) || Date.parse(start) >= Date.parse(end)) throw new Error("Completa un periodo de oferta válido.");
      return { action, promotion: { salePrice: amount(salePrice), saleStartsAt: new Date(start).toISOString(), saleEndsAt: new Date(end).toISOString() } };
    }
    return { action };
  }
  async function execute(token: string, selected: readonly SelectedProduct[], typed?: string) {
    const response = await apiRequest<Result>(`/products/catalog/${catalogId}/bulk/confirm`, { method: "POST", body: JSON.stringify({ token, ...(typed ? { confirmation: typed } : {}) }) });
    setResult(response); setPreview(null);
    // The immutable selection snapshot is the entire submitted set, never the visible page.
    if (selected === items) onExecuted();
  }
  async function review() {
    if (busy || editorDirty || !items.length) return;
    onBusy(true); invalidate(); setResult(null);
    const selected = items;
    try {
      const requested = operation();
      const response = await apiRequest<Preview>(`/products/catalog/${catalogId}/bulk/preview`, { method: "POST", body: JSON.stringify({ operation: requested, items: selected.map(({ id, updatedAt }) => ({ id, updatedAt })) }) });
      setPreview({ value: response, items: selected });
      // Category is reversible and uses a single explicit apply button, without an extra dialog.
      if (requested.action === "category" && response.token && !response.issues.length) await execute(response.token, selected);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo revisar el lote."); }
    finally { onBusy(false); }
  }
  async function confirm() {
    if (busy || editorDirty || !current?.token) return;
    onBusy(true); setError("");
    try { await execute(current.token, items, destructive ? confirmation : undefined); }
    catch (cause) { setPreview(null); setError(cause instanceof Error ? cause.message : "No se pudo aplicar. Consulta el listado antes de reintentar si perdiste la respuesta."); }
    finally { onBusy(false); }
  }
  const choices = ["delete", "discard", "price", "promotion", "category"] as const;
  const labels: Record<Operation["action"], string> = { delete: "Borrar", discard: "Descartar provisionales", price: "Cambiar precio", promotion: "Cambiar oferta", category: "Cambiar categoría" };
  const money = (value: string | number | null | undefined) => typeof value === "number" ? `$${value.toLocaleString("es-CO")}` : "Sin oferta";
  const date = (value: string | number | null | undefined) => typeof value === "string" ? new Date(value).toLocaleString("es-CO") : "Sin fecha";
  return <>
    {!!items.length && <aside data-bulk-selection className="sticky top-0 z-30 mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#68756e] bg-white p-3 text-[#263b31]">
      <p role="status" aria-live="polite" className="font-semibold">{items.length} productos seleccionados en total, incluidos los de otras páginas y filtros.</p>
      <Button type="button" variant="secondary" disabled={busy} onClick={() => { invalidate(); onExit(); }}>Salir de la selección</Button>
    </aside>}
    {!!items.length && <section aria-label="Acciones en lote" className="my-4 space-y-4 rounded-xl border border-[#cbd7cc] bg-white p-4 text-sm text-[#263b31]">
      {editorDirty && <p role="status">Guarda o cancela el borrador del editor antes de ejecutar un lote. La selección se conserva.</p>}
      <fieldset disabled={busy} className="space-y-3">
        <label className="block">Acción para los {items.length} seleccionados<select data-bulk-action value={action} onChange={e => { const next = choices.find(key => key === e.target.value); if (next) { setAction(next); invalidate(); } }} className="ml-2 min-h-11 max-w-full rounded border border-[#68756e] p-2">
          {Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label} ({items.length})</option>)}
        </select></label>
        {action === "price" && <label className="block">Nuevo precio para todos<Input data-bulk-price type="number" min="0" max="2147483647" step="1" value={price} onChange={e => { setPrice(e.target.value); invalidate(); }} /></label>}
        {action === "category" && <label className="block">Categoría para todos<select data-bulk-category value={categoryId} onChange={e => { setCategoryId(e.target.value); invalidate(); }} className="ml-2 min-h-11 max-w-full rounded border border-[#68756e] p-2"><option value="">Quitar categoría</option>{categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>}
        {action === "promotion" && <>
          <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={removePromotion} onChange={e => { setRemovePromotion(e.target.checked); invalidate(); }} />Quitar la oferta y sus fechas de todos</label>
          {!removePromotion && <><label className="block">Precio de oferta para todos<Input type="number" min="0" step="1" value={salePrice} onChange={e => { setSalePrice(e.target.value); invalidate(); }} /></label><label className="block">Válido desde<Input type="datetime-local" value={start} onChange={e => { setStart(e.target.value); invalidate(); }} /></label><label className="block">Válido hasta<Input type="datetime-local" value={end} onChange={e => { setEnd(e.target.value); invalidate(); }} /></label></>}
        </>}
        {destructive && <p>Irreversible: se eliminan productos, reseñas e imágenes registradas y se encola la limpieza de sus archivos. Los pedidos conservan los nombres, cantidades y precios históricos. Descartar solo elimina provisionales inactivos.</p>}
        <Button type="button" disabled={editorDirty} onClick={() => void review()}>{action === "category" ? "Aplicar categoría a" : "Revisar"} {items.length} seleccionados</Button>
      </fieldset>
      {current && <div data-bulk-preview className="space-y-3">
        <p>{current.totalSelected} seleccionados en total. Se modificarán {current.affected}; se omitirán {current.changes.filter(change => change.skipped).length}.</p>
        {current.issues.map(issue => <p role="alert" key={issue.id}>{items.find(item => item.id === issue.id)?.name ?? "Categoría seleccionada"}: {issue.message}</p>)}
        <ul className="max-h-64 space-y-2 overflow-auto">{current.changes.map(change => <li key={change.id} className="break-words"><strong>{change.name}</strong>: {change.skipped ? "Se omite: no es un provisional inactivo." : destructive ? "Se eliminará." : action === "price" ? `Precio: ${money(change.before.price)} → ${money(change.after.price)}.` : action === "promotion" ? `Oferta: ${money(change.before.salePrice)} → ${money(change.after.salePrice)}. Periodo anterior: ${date(change.before.saleStartsAt)} a ${date(change.before.saleEndsAt)}. Nuevo periodo: ${date(change.after.saleStartsAt)} a ${date(change.after.saleEndsAt)}.` : "Se cambiará la categoría."}</li>)}</ul>
        {!current.affected && !current.issues.length && <p role="status">Ningún seleccionado cumple la condición. No se borró nada.</p>}
        {current.token && action !== "category" && <>
          {destructive && <label className="block">Escribe {phrase}<Input data-bulk-confirm value={confirmation} autoComplete="off" onChange={e => setConfirmation(e.target.value)} /></label>}
          <Button type="button" variant={destructive ? "destructive" : "primary"} disabled={busy || editorDirty || (destructive && confirmation !== phrase)} onClick={() => void confirm()}>Confirmar {labels[action].toLowerCase()} para {current.totalSelected} seleccionados</Button>
        </>}
      </div>}
    </section>}
    {error && <p role="alert" className="my-3 text-sm text-[#a5432a]">{error}</p>}
    {result && <p role="status" className="my-3 text-sm text-[#263b31]">Lote de {result.totalSelected} seleccionados: {result.changed} modificados; {result.skipped} omitidos. {result.storageWarning}</p>}
  </>;
}
