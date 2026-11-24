"use client";
import { useEffect, useRef, useState } from "react";
import { apiRequest } from "@/lib/api";
import { parseInventoryItemReply, type InventoryItemView as Item } from "@/lib/inventory-item.mjs";
export default function InventoryDetails({ id, onSaved }: { id: string; onSaved: (item: Item) => void }) {
  const [item, setItem] = useState<Item | null>(null), [name, setName] = useState(""), [sku, setSku] = useState(""), [minimum, setMinimum] = useState("0");
  const [price, setPrice] = useState(""), [cost, setCost] = useState(""), [error, setError] = useState(""), [message, setMessage] = useState(""), [busy, setBusy] = useState(false), [reload, setReload] = useState(0);
  const pending = useRef(false);
  const [loaded, setLoaded] = useState<{ key: string; error: string } | null>(null);
  const loadKey = `${id}:${reload}`;
  const loading = loaded?.key !== loadKey;
  function display(result: Item, part: "all" | "data" | "terms" = "all") {
    setItem(result);
    if (part !== "terms") { setName(result.name); setSku(result.sku); setMinimum(String(result.minimumStock)); }
    if (part !== "data") { setPrice(result.commercialTerms?.unitSalePrice ?? ""); setCost(result.commercialTerms?.referenceUnitCost ?? ""); }
  }
  useEffect(() => {
    const controller = new AbortController();
    apiRequest<unknown>(`/inventory/items/${id}/commercial-terms`, { signal: controller.signal }).then(reply => {
      if (controller.signal.aborted) return;
      display(parseInventoryItemReply(reply, id)); setLoaded({ key: loadKey, error: "" }); setError(""); setMessage("");
    }).catch(cause => {
      if (!controller.signal.aborted) { setItem(null); setLoaded({ key: loadKey, error: cause instanceof Error ? cause.message : "No se pudo cargar la ficha." }); }
    });
    return () => controller.abort();
  }, [id, loadKey]);
  async function save(terms: boolean) {
    if (!item || loading || pending.current) return; pending.current = true; setBusy(true); setError(""); setMessage("");
    try {
      const body = terms ? { expectedVersion: item.commercialTerms?.version ?? null, unitSalePrice: price, referenceUnitCost: cost === "" ? null : cost } : { expectedVersion: item.dataVersion, name, sku, minimumStock: Number(minimum) };
      const result = parseInventoryItemReply(await apiRequest<unknown>(`/inventory/items/${id}${terms ? "/commercial-terms" : ""}`, { method: terms ? "PUT" : "PATCH", body: JSON.stringify(body) }), id);
      display(result, terms ? "terms" : "data"); setMessage("Ficha actualizada."); onSaved(result);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo guardar."); } finally { pending.current = false; setBusy(false); }
  }
  return <section aria-label="Datos y ficha comercial" className="space-y-3 rounded border p-4"><h3 className="font-semibold">Datos y ficha comercial independiente del catálogo</h3>
    {loading && <p role="status">Cargando ficha…</p>}
    {(error || (!loading && loaded?.error)) && <p role="alert">{error || loaded?.error} <button disabled={busy || loading} onClick={() => setReload(value => value + 1)} className="min-h-11 underline">Recargar ficha</button></p>}<p role="status">{message}</p>
    <form onSubmit={e => { e.preventDefault(); void save(false); }}><fieldset disabled={busy || loading || !item} className="grid gap-3 sm:grid-cols-3"><label>Editar nombre<input required maxLength={160} value={name} onChange={e => setName(e.target.value)} className="block min-h-11 w-full border p-2" /></label><label>Editar SKU<input required maxLength={80} value={sku} onChange={e => setSku(e.target.value)} className="block min-h-11 w-full border p-2" /></label><label>Editar mínimo<input required type="number" min="0" step="1" value={minimum} onChange={e => setMinimum(e.target.value)} className="block min-h-11 w-full border p-2" /></label><button className="min-h-11 rounded border p-2">Guardar datos del producto</button></fieldset></form>
    <form onSubmit={e => { e.preventDefault(); void save(true); }}><fieldset disabled={busy || loading || !item} className="grid gap-3 sm:grid-cols-3"><label>Precio de venta COP<input required inputMode="numeric" pattern="[0-9]+" value={price} onChange={e => setPrice(e.target.value)} className="block min-h-11 w-full border p-2" /></label><label>Costo de referencia COP (opcional)<input inputMode="numeric" pattern="[0-9]*" value={cost} onChange={e => setCost(e.target.value)} className="block min-h-11 w-full border p-2" /></label><button className="min-h-11 rounded border p-2">Guardar ficha comercial</button></fieldset><p className="text-sm">Pesos enteros. Dejar el costo vacío lo elimina explícitamente; no cambia las existencias.</p></form>
  </section>;
}
