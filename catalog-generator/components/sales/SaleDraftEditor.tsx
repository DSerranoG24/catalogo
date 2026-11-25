"use client";

import { useMemo, useRef, useState } from "react";
import { apiRequest } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { AlertDialog, AlertDialogCancel, DialogActions } from "@/components/ui/Dialog";
import { draftEstimate, formatCop, parseMoneyInput, parseQuantityInput, validateDraft, type DraftLine, type Sale } from "@/lib/sales-ui.mjs";
import CustomerPicker, { type PickedCustomer } from "./CustomerPicker";
import type { SaleCommand } from "./useSaleCommand";

type InventoryHit = { id: string; name: string; sku: string; stock: number; unitSalePrice: string | null };
function parseItems(value: unknown): InventoryHit[] {
  const items = (value as { result?: { items?: unknown } } | null)?.result?.items;
  if (!Array.isArray(items)) throw new Error("No se pudo validar la lista de artículos.");
  return items.map(raw => {
    const item = raw as { id?: unknown; name?: unknown; sku?: unknown; stock?: unknown; commercialTerms?: { unitSalePrice?: unknown } | null };
    if (typeof item.id !== "string" || typeof item.name !== "string" || typeof item.sku !== "string" || !Number.isSafeInteger(item.stock)) throw new Error("No se pudo validar la lista de artículos.");
    const price = item.commercialTerms?.unitSalePrice;
    return { id: item.id, name: item.name, sku: item.sku, stock: item.stock as number, unitSalePrice: typeof price === "string" && /^\d+$/.test(price) ? price : null };
  });
}
const toDraft = (sale: Sale): DraftLine[] => sale.lines.map(line => ({ inventoryItemId: line.inventoryItemId, itemName: line.itemName, sku: line.sku, unitPrice: line.unitPrice, stock: null, quantity: String(line.quantity), unitDiscount: line.unitDiscount }));
const payloadOf = (lines: DraftLine[]) => lines.map(line => ({ inventoryItemId: line.inventoryItemId, quantity: parseQuantityInput(line.quantity), unitDiscount: parseMoneyInput(line.unitDiscount) }));

export default function SaleDraftEditor({ sale, busy, run, onSaved }: {
  sale: Sale; busy: string | null;
  run: (command: SaleCommand, onSuccess: (reply: unknown) => Promise<void> | void) => Promise<boolean>;
  onSaved: (message: string) => void;
}) {
  const savedCustomer: PickedCustomer | null = sale.customerId && sale.customer ? { id: sale.customerId, fullName: sale.customer.fullName, phone: sale.customer.phone ?? "" } : null;
  const [lines, setLines] = useState<DraftLine[]>(() => toDraft(sale));
  const [customer, setCustomer] = useState<PickedCustomer | null>(savedCustomer);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<InventoryHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [confirming, setConfirming] = useState<null | "confirm" | "deliver">(null);
  const searchVersion = useRef(0);
  const locked = busy !== null;

  const customerChanged = (customer?.id ?? null) !== (sale.customerId ?? null);
  const dirty = customerChanged || JSON.stringify(payloadOf(lines)) !== JSON.stringify(payloadOf(toDraft(sale)));
  const estimate = useMemo(() => draftEstimate(lines), [lines]);
  const units = sale.lines.reduce((sum, line) => sum + line.quantity, 0);

  async function search() {
    const version = ++searchVersion.current;
    setSearching(true); setSearchError("");
    try {
      const found = parseItems(await apiRequest<unknown>(`/inventory/items?page=1&q=${encodeURIComponent(query.trim())}`));
      if (version === searchVersion.current) setHits(found);
    } catch (cause) { if (version === searchVersion.current) setSearchError(cause instanceof Error ? cause.message : "No se pudo buscar en el inventario."); }
    finally { if (version === searchVersion.current) setSearching(false); }
  }
  function add(hit: InventoryHit) {
    if (!hit.unitSalePrice || lines.some(line => line.inventoryItemId === hit.id)) return;
    setLines(current => [...current, { inventoryItemId: hit.id, itemName: hit.name, sku: hit.sku, unitPrice: hit.unitSalePrice, stock: hit.stock, quantity: "1", unitDiscount: "0" }]);
    setErrors([]);
  }
  function update(index: number, patch: Partial<DraftLine>) { setLines(current => current.map((line, i) => i === index ? { ...line, ...patch } : line)); setErrors([]); }
  function save() {
    const problems = validateDraft(lines);
    setErrors(problems);
    if (problems.length) return;
    const body = { expectedVersion: sale.version, lines: payloadOf(lines), ...(customerChanged ? { customerId: customer?.id ?? null } : {}) };
    void run({ action: "saveDraft", saleId: sale.id, path: `/sales/${sale.id}`, method: "PATCH", body, withRequestId: false, label: "Guardando borrador…" }, () => onSaved("Borrador guardado. El servidor recalculó los totales."));
  }
  function confirm(deliverImmediately: boolean) {
    setConfirming(null);
    void run({ action: deliverImmediately ? "confirmAndDeliver" : "confirm", saleId: sale.id, path: `/sales/${sale.id}/confirm`, method: "POST", body: { expectedVersion: sale.version, deliverImmediately }, withRequestId: true, label: deliverImmediately ? "Confirmando y entregando…" : "Confirmando venta…" },
      () => onSaved(deliverImmediately ? "Venta confirmada y entregada. Se descontaron las existencias." : "Venta confirmada. Se descontaron las existencias."));
  }

  return <section aria-labelledby={`draft-${sale.id}`} className="space-y-5">
    <h3 id={`draft-${sale.id}`} className="text-lg font-semibold">Editar borrador</h3>
    <fieldset disabled={locked} className="space-y-5">
      <legend className="sr-only">Datos del borrador</legend>
      <CustomerPicker idPrefix={`draft-${sale.id}`} value={customer} onChange={setCustomer} disabled={locked} />

      <div className="space-y-2 rounded-xl border border-[#e2e8e0] bg-[#fafcf9] p-4">
        <div className="flex flex-wrap items-end gap-2">
          <label htmlFor={`items-q-${sale.id}`} className="grid min-w-0 flex-1 gap-1 text-sm font-medium">Buscar artículo del inventario
            <Input id={`items-q-${sale.id}`} maxLength={160} value={query} placeholder="Nombre o SKU"
              onChange={event => { searchVersion.current++; setSearching(false); setHits(null); setQuery(event.target.value); }}
              onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); void search(); } }} />
          </label>
          <Button variant="secondary" loading={searching} disabled={searching} onClick={() => void search()}>Buscar artículos</Button>
        </div>
        {searchError && <p role="alert" className="text-sm text-[#8a2b20]">{searchError}</p>}
        {hits && !hits.length && <p role="status" className="text-sm">No hay artículos para esta búsqueda.</p>}
        {hits && hits.length > 0 && <ul aria-label="Artículos encontrados" className="divide-y divide-[#e2e8e0]">{hits.map(hit => {
          const already = lines.some(line => line.inventoryItemId === hit.id);
          return <li key={hit.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <div className="min-w-0"><p className="break-words font-medium">{hit.name}</p>
              <p className="text-sm text-[#52675b]">SKU {hit.sku} · {hit.stock} en stock · {hit.unitSalePrice ? formatCop(hit.unitSalePrice) : <span className="font-semibold text-[#8a2b20]">Sin ficha comercial: configura el precio en Inventario</span>}</p></div>
            <Button variant="secondary" size="sm" disabled={!hit.unitSalePrice || already} onClick={() => add(hit)}>{already ? `${hit.name} ya está en la venta` : `Añadir ${hit.name}`}</Button>
          </li>;
        })}</ul>}
      </div>

      {!lines.length ? <p className="text-sm">El borrador no tiene artículos. Búscalos arriba para añadirlos.</p> :
        <ul aria-label="Líneas del borrador" className="space-y-3">{lines.map((line, index) => {
          const total = estimate.rows[index]?.lineTotal;
          return <li key={line.inventoryItemId} className="grid gap-3 rounded-xl border border-[#e2e8e0] p-3 sm:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))_auto] sm:items-end">
            <div className="min-w-0"><p className="break-words font-medium">{line.itemName}</p>
              <p className="text-sm text-[#52675b]">SKU {line.sku} · {line.unitPrice ? formatCop(line.unitPrice) : "Sin ficha comercial"}{line.stock !== null && ` · ${line.stock} en stock`}</p></div>
            <label className="grid gap-1 text-sm font-medium">Cantidad<Input inputMode="numeric" value={line.quantity} aria-label={`Cantidad de ${line.itemName}`} onChange={event => update(index, { quantity: event.target.value })} /></label>
            <label className="grid gap-1 text-sm font-medium">Descuento unitario<Input inputMode="numeric" value={line.unitDiscount} aria-label={`Descuento unitario de ${line.itemName}`} onChange={event => update(index, { unitDiscount: event.target.value })} /></label>
            <p className="text-sm"><span className="block font-medium">Total estimado</span>{total ? formatCop(total) : "—"}</p>
            <Button variant="destructive-ghost" size="sm" onClick={() => { setLines(current => current.filter((_, i) => i !== index)); setErrors([]); }}>Quitar {line.itemName}</Button>
          </li>;
        })}</ul>}

      <div className="rounded-xl border border-[#e2e8e0] p-4 text-sm">
        <p className="font-medium">Estimado mientras editas</p>
        <p>Subtotal {formatCop(estimate.subtotal)} · Descuento {formatCop(estimate.discountTotal)} · <strong>Total {formatCop(estimate.total)}</strong></p>
        <p className="mt-1 text-[#52675b]">El servidor calcula el total definitivo al guardar el borrador.</p>
      </div>
      {errors.length > 0 && <ul role="alert" className="list-disc space-y-1 rounded-xl border border-[#efc2bd] bg-[#fdf0ee] p-4 pl-8 text-sm text-[#5e1f17]">{errors.map(error => <li key={error}>{error}</li>)}</ul>}
    </fieldset>

    <div className="flex flex-wrap gap-2">
      <Button variant="secondary" loading={busy === "Guardando borrador…"} disabled={locked || !dirty} onClick={save}>Guardar borrador</Button>
      <Button disabled={locked || dirty || !sale.lines.length} onClick={() => setConfirming("confirm")}>Confirmar</Button>
      <Button disabled={locked || dirty || !sale.lines.length} onClick={() => setConfirming("deliver")}>Confirmar y entregar</Button>
    </div>
    {dirty && <p className="text-sm text-[#7a4f0b]">Hay cambios sin guardar. Guarda el borrador antes de confirmar.</p>}
    {!dirty && !sale.lines.length && <p className="text-sm">Añade artículos y guarda el borrador para poder confirmarlo.</p>}

    <AlertDialog open={confirming !== null} onOpenChange={open => { if (!open) setConfirming(null); }}
      title={confirming === "deliver" ? "¿Confirmar y entregar la venta?" : "¿Confirmar la venta?"}
      description={<>Se descontarán {units} unidad{units === 1 ? "" : "es"} del inventario y el total quedará en <strong>{formatCop(sale.total)}</strong>. {confirming === "deliver" ? "La venta quedará entregada; después solo podrá corregirse con devoluciones." : "Después podrás entregarla o cancelarla."} Los totales no indican pagos recibidos.</>}>
      <DialogActions><AlertDialogCancel label="Volver" /><Button onClick={() => confirm(confirming === "deliver")}>{confirming === "deliver" ? "Sí, confirmar y entregar" : "Sí, confirmar"}</Button></DialogActions>
    </AlertDialog>
  </section>;
}
