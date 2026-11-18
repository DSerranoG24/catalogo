"use client";
import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";
type Item = { id: string; name: string; sku: string; minimumStock: number; dataVersion: number; commercialTerms: { unitSalePrice: string; referenceUnitCost: string | null; version: number } | null };
export default function InventoryDetails({ id, onSaved }: { id: string; onSaved: () => void }) {
  const [item, setItem] = useState<Item | null>(null), [name, setName] = useState(""), [sku, setSku] = useState(""), [minimum, setMinimum] = useState("0");
  const [price, setPrice] = useState(""), [cost, setCost] = useState(""), [error, setError] = useState(""), [message, setMessage] = useState(""), [busy, setBusy] = useState(false), [reload, setReload] = useState(0);
  useEffect(() => { const controller = new AbortController(); apiRequest<{ result: Item }>(`/inventory/items/${id}/commercial-terms`, { signal: controller.signal }).then(({ result }) => {
    setItem(result); setName(result.name); setSku(result.sku); setMinimum(String(result.minimumStock)); setPrice(result.commercialTerms?.unitSalePrice ?? ""); setCost(result.commercialTerms?.referenceUnitCost ?? "");
  }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "No se pudo cargar la ficha."); }); return () => controller.abort(); }, [id, reload]);
  async function save(terms: boolean) {
    if (!item || busy) return; setBusy(true); setError(""); setMessage("");
    try {
      const body = terms ? { expectedVersion: item.commercialTerms?.version ?? null, unitSalePrice: price, referenceUnitCost: cost === "" ? null : cost } : { expectedVersion: item.dataVersion, name, sku, minimumStock: Number(minimum) };
      const result = await apiRequest<{ result: Item }>(`/inventory/items/${id}${terms ? "/commercial-terms" : ""}`, { method: terms ? "PUT" : "PATCH", body: JSON.stringify(body) });
      setItem(result.result); setMessage("Ficha actualizada."); onSaved();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo guardar."); } finally { setBusy(false); }
  }
  return <section aria-label="Datos y ficha comercial" className="space-y-3 rounded border p-4"><h3 className="font-semibold">Datos y ficha comercial independiente del catálogo</h3>
    {error && <p role="alert">{error} <button onClick={() => setReload(reload + 1)} className="underline">Recargar ficha</button></p>}<p role="status">{message}</p>
    <form onSubmit={e => { e.preventDefault(); void save(false); }}><fieldset disabled={busy || !item} className="grid gap-3 sm:grid-cols-3"><label>Editar nombre<input required maxLength={160} value={name} onChange={e => setName(e.target.value)} className="block min-h-11 w-full border p-2" /></label><label>Editar SKU<input required maxLength={80} value={sku} onChange={e => setSku(e.target.value)} className="block min-h-11 w-full border p-2" /></label><label>Editar mínimo<input required type="number" min="0" step="1" value={minimum} onChange={e => setMinimum(e.target.value)} className="block min-h-11 w-full border p-2" /></label><button className="min-h-11 rounded border p-2">Guardar datos del producto</button></fieldset></form>
    <form onSubmit={e => { e.preventDefault(); void save(true); }}><fieldset disabled={busy || !item} className="grid gap-3 sm:grid-cols-3"><label>Precio de venta COP<input required inputMode="numeric" pattern="[0-9]+" value={price} onChange={e => setPrice(e.target.value)} className="block min-h-11 w-full border p-2" /></label><label>Costo de referencia COP (opcional)<input inputMode="numeric" pattern="[0-9]*" value={cost} onChange={e => setCost(e.target.value)} className="block min-h-11 w-full border p-2" /></label><button className="min-h-11 rounded border p-2">Guardar ficha comercial</button></fieldset><p className="text-sm">Pesos enteros. Dejar el costo vacío lo elimina explícitamente; no cambia las existencias.</p></form>
  </section>;
}
