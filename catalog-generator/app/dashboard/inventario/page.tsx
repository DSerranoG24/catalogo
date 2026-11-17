"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { apiRequest, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

type Item = { id: string; name: string; sku: string; stock: number; minimumStock: number };
type Movement = { id: string; type: string; quantity: number; previousStock: number; resultingStock: number; reason: string; createdAt: string };
type Page<T> = { total: number; page: number } & T;
const labels: Record<string, string> = { IN: "Entrada", OUT: "Salida", ADJUSTMENT: "Ajuste" };

function useInventoryRequest<T>(path: string | null, revision: number) {
  const key = `${path}:${revision}`;
  const [response, setResponse] = useState<{ key: string; data: T | null; error: string } | null>(null);
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    apiRequest<{ result: T }>(path, { signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) setResponse({ key, data: value.result, error: "" }); })
      .catch(cause => { if (!controller.signal.aborted) setResponse({ key, data: null, error: cause instanceof Error ? cause.message : "No se pudieron cargar los datos." }); });
    return () => controller.abort();
  }, [path, key]);
  return { data: response?.key === key ? response.data : null, error: response?.key === key ? response.error : "", loading: path !== null && response?.key !== key };
}

export default function InventoryPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const retry = useRef<{ body: string; key: string } | null>(null);
  const [selected, setSelected] = useState<Item | null>(null);
  const [historyPage, setHistoryPage] = useState(1);
  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [minimum, setMinimum] = useState("0");
  const [type, setType] = useState("IN");
  const [quantity, setQuantity] = useState("1");
  const [reason, setReason] = useState("");

  const { data, loading, error: listError } = useInventoryRequest<Page<{ items: Item[] }>>(`/inventory/items?page=${page}&q=${encodeURIComponent(query)}`, revision);
  const { data: history, loading: historyLoading, error: historyError } = useInventoryRequest<Page<{ movements: Movement[] }>>(selected ? `/inventory/items/${selected.id}/movements?page=${historyPage}` : null, revision);

  async function save(kind: "item" | "movement") {
    if (pending.current || (kind === "movement" && !selected)) return;
    pending.current = true; setBusy(true); setError(""); setMessage("");
    const fields = kind === "item" ? { name, sku, minimumStock: Number(minimum) } : { type, quantity: Number(quantity), reason };
    const fingerprint = JSON.stringify({ kind, item: selected?.id, fields });
    if (retry.current?.body !== fingerprint) retry.current = { body: fingerprint, key: crypto.randomUUID() };
    const body = kind === "item" ? { ...fields, id: retry.current.key } : { ...fields, key: retry.current.key };
    try {
      const response = await apiRequest<{ result: Item | Movement }>(kind === "item" ? "/inventory/items" : `/inventory/items/${selected?.id}/movements`, { method: "POST", body: JSON.stringify(body) });
      retry.current = null;
      if (kind === "item") { setName(""); setSku(""); setMinimum("0"); setPage(1); setQuery(""); setSearch(""); }
      else {
        const movement = response.result;
        if ("resultingStock" in movement) setSelected(current => current ? { ...current, stock: movement.resultingStock } : null);
        setReason(""); setQuantity("1"); setHistoryPage(1);
      }
      setMessage(kind === "item" ? "Producto creado. Registra una entrada para cargar existencias." : "Movimiento registrado.");
      setRevision(value => value + 1);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) setError("Tu sesión expiró. Inicia sesión para continuar.");
      else setError(cause instanceof Error ? cause.message : "No se pudo guardar. Reintenta con los mismos datos.");
    } finally { pending.current = false; setBusy(false); }
  }

  const field = "grid gap-2 text-sm font-medium";
  return <main className="mx-auto max-w-6xl space-y-6 px-5 py-8 sm:px-8">
    <Link href="/dashboard" className="inline-flex min-h-11 items-center underline">← Catálogos</Link>
    <div><h1 className="text-3xl font-semibold">Inventario</h1><p className="mt-2 text-sm text-[#52675b]">Una bodega para tu cuenta. Administra productos y movimientos independientemente de tus catálogos.</p></div>
    {(error || listError) && <div role="alert" className="rounded-xl border border-red-300 p-4"><p>{error || listError}</p><Button variant="secondary" onClick={() => setRevision(value => value + 1)}>Recargar datos</Button><Link href="/login" className="ml-4 underline">Iniciar sesión</Link></div>}
    <p role="status">{message}</p>
    <section aria-labelledby="new-item" className="rounded-2xl border border-[#dce4dc] bg-white p-5">
      <h2 id="new-item" className="text-xl font-semibold">Nuevo producto</h2>
      <form onSubmit={event => { event.preventDefault(); void save("item"); }} className="mt-4 grid gap-4 sm:grid-cols-3">
        <fieldset disabled={busy} className="contents">
          <label className={field}>Nombre<Input required maxLength={160} value={name} onChange={event => setName(event.target.value)} /></label>
          <label className={field}>SKU / código<Input required maxLength={80} value={sku} onChange={event => setSku(event.target.value)} /></label>
          <label className={field}>Existencia mínima<Input required type="number" min="0" max="2147483647" step="1" value={minimum} onChange={event => setMinimum(event.target.value)} /></label>
          <Button type="submit" loading={busy}>Crear producto</Button>
        </fieldset>
      </form>
    </section>
    <section aria-labelledby="items" className="space-y-4">
      <h2 id="items" className="text-xl font-semibold">Productos de la bodega</h2>
      <form className="flex flex-wrap items-end gap-3" onSubmit={event => { event.preventDefault(); setPage(1); setQuery(search); }}>
        <label className={field}>Buscar por nombre o SKU<Input maxLength={160} value={search} onChange={event => setSearch(event.target.value)} /></label><Button type="submit" variant="secondary">Buscar</Button>
      </form>
      {loading ? <p role="status">Cargando inventario…</p> : data && <>
        <p>{data.total} productos</p>
        {!data.items.length && <p>No hay productos para esta búsqueda. Puedes crear uno arriba.</p>}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{data.items.map(item => <article key={item.id} className="rounded-xl border border-[#dce4dc] bg-white p-4">
          <h3 className="break-words font-semibold">{item.name}</h3><p className="break-words text-sm">SKU: {item.sku}</p>
          <p className="mt-3 text-lg">{item.stock} unidades</p><p className="text-sm">Mínimo: {item.minimumStock}{item.stock <= item.minimumStock && " · Existencias bajas"}</p>
          <Button variant="secondary" className="mt-3" disabled={busy} onClick={() => { setSelected(item); setHistoryPage(1); setReason(""); retry.current = null; }}>Movimientos de {item.name}</Button>
        </article>)}</div>
        <div className="flex items-center gap-4"><Button variant="secondary" disabled={page === 1} onClick={() => setPage(value => value - 1)}>Anterior</Button><span>Página {page}</span><Button variant="secondary" disabled={page * 24 >= data.total} onClick={() => setPage(value => value + 1)}>Siguiente</Button></div>
      </>}
    </section>
    {selected && <section aria-labelledby="movements" className="space-y-4 rounded-2xl border border-[#dce4dc] bg-white p-5">
      <h2 id="movements" className="text-xl font-semibold">Movimientos: {selected.name}</h2>
      <p>Existencias al consultar: {selected.stock}. El servidor valida el saldo actual al guardar.</p>
      <form onSubmit={event => { event.preventDefault(); void save("movement"); }} className="grid gap-4 sm:grid-cols-3">
        <fieldset disabled={busy} className="contents">
          <label className={field}>Tipo<select className="min-h-11 rounded border p-2" value={type} onChange={event => setType(event.target.value)}>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className={field}>{type === "ADJUSTMENT" ? "Existencia final contada" : "Cantidad"}<Input required type="number" min={type === "ADJUSTMENT" ? 0 : 1} max="2147483647" step="1" value={quantity} onChange={event => setQuantity(event.target.value)} /></label>
          <label className={field}>Motivo<Input required minLength={3} maxLength={300} value={reason} onChange={event => setReason(event.target.value)} /></label>
          <Button type="submit" loading={busy}>Registrar movimiento</Button>
        </fieldset>
      </form>
      {type === "ADJUSTMENT" && <p className="text-sm">El ajuste reemplaza las existencias por la cantidad contada. Usa entradas y salidas para sumar o restar unidades.</p>}
      <h3 className="font-semibold">Historial</h3>
      {historyLoading && <p role="status">Cargando movimientos…</p>}
      {historyError && <p role="alert">{historyError} <Button variant="secondary" onClick={() => setRevision(value => value + 1)}>Reintentar historial</Button></p>}
      {history && <>
        {!history.movements.length && <p>Aún no hay movimientos.</p>}
        <ul className="divide-y">{history.movements.map(movement => <li key={movement.id} className="py-3"><p>{labels[movement.type]} · {movement.quantity} unidades · {movement.previousStock} → {movement.resultingStock}</p><p className="break-words text-sm">{movement.reason}</p><time className="text-sm" dateTime={movement.createdAt}>{new Date(movement.createdAt).toLocaleString("es-CO", { timeZone: "America/Bogota" })}</time></li>)}</ul>
        <div className="flex items-center gap-4"><Button variant="secondary" disabled={historyPage === 1} onClick={() => setHistoryPage(value => value - 1)}>Anteriores</Button><span>Página {historyPage}</span><Button variant="secondary" disabled={historyPage * 24 >= history.total} onClick={() => setHistoryPage(value => value + 1)}>Más movimientos</Button></div>
      </>}
    </section>}
  </main>;
}
