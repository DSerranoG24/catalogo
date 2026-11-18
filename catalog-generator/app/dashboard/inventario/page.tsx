"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { apiRequest, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { InventoryRetryKeys } from "@/lib/inventory-retry";
import InventoryDetails from "@/components/inventory/InventoryDetails";

type Item = { id: string; name: string; sku: string; stock: number; minimumStock: number };
type Movement = { id: string; type: string; quantity: number; previousStock: number; resultingStock: number; reason: string; createdAt: string };
type Page<T> = { total: number; page: number } & T;
type MovementDraft = { type: string; quantity: string; reason: string };
const emptyMovementDraft: MovementDraft = { type: "IN", quantity: "1", reason: "" };
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
  const [errorKind, setErrorKind] = useState<"item" | "movement" | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const retry = useRef(new InventoryRetryKeys());
  const movementHeading = useRef<HTMLHeadingElement>(null);
  const [selected, setSelected] = useState<Item | null>(null);
  const [historyPage, setHistoryPage] = useState(1);
  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [minimum, setMinimum] = useState("0");
  const [movementDrafts, setMovementDrafts] = useState<Record<string, MovementDraft>>({});
  const { type, quantity, reason } = (selected && movementDrafts[selected.id]) || emptyMovementDraft;
  const selectedId = selected?.id;

  function updateMovementDraft(changes: Partial<MovementDraft>) {
    if (!selected) return;
    setMovementDrafts(current => ({ ...current, [selected.id]: { ...(current[selected.id] || emptyMovementDraft), ...changes } }));
  }

  useEffect(() => {
    if (selectedId) movementHeading.current?.focus();
  }, [selectedId]);

  const { data, loading, error: listError } = useInventoryRequest<Page<{ items: Item[] }>>(`/inventory/items?page=${page}&q=${encodeURIComponent(query)}`, revision);
  const { data: history, loading: historyLoading, error: historyError } = useInventoryRequest<Page<{ movements: Movement[] }>>(selected ? `/inventory/items/${selected.id}/movements?page=${historyPage}` : null, revision);

  async function save(kind: "item" | "movement") {
    if (pending.current || (kind === "movement" && !selected)) return;
    pending.current = true; setBusy(true); setError(""); setErrorKind(kind); setMessage("");
    const fields = kind === "item" ? { name: name.trim(), sku: sku.trim().toUpperCase(), minimumStock: Number(minimum) } : { type, quantity: Number(quantity), reason: reason.trim() };
    const fingerprint = JSON.stringify({ kind, item: kind === "movement" ? selected?.id : undefined, fields });
    try {
      const key = retry.current.keyFor(fingerprint);
      const body = kind === "item" ? { ...fields, id: key } : { ...fields, key };
      const response = await apiRequest<{ result: Item | Movement }>(kind === "item" ? "/inventory/items" : `/inventory/items/${selected?.id}/movements`, { method: "POST", body: JSON.stringify(body) });
      retry.current.complete(fingerprint);
      if (kind === "item") { setName(""); setSku(""); setMinimum("0"); setPage(1); setQuery(""); setSearch(""); }
      else {
        const movement = response.result;
        if ("resultingStock" in movement) setSelected(current => current ? { ...current, stock: movement.resultingStock } : null);
        updateMovementDraft({ reason: "", quantity: "1" }); setHistoryPage(1);
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
    <Link href="/dashboard/inventario/hoja" className="ml-4 inline-flex min-h-11 items-center rounded-xl border border-[#173d2a] bg-white px-4 font-semibold text-[#173d2a]">Editar en hoja de cálculo</Link>
    <div><h1 className="text-3xl font-semibold">Inventario</h1><p className="mt-2 text-sm text-[#52675b]">Una bodega para tu cuenta. Administra productos y movimientos independientemente de tus catálogos.</p></div>
    {listError && <div role="alert" className="rounded-xl border border-red-300 p-4"><p>{listError}</p><Button variant="secondary" onClick={() => setRevision(value => value + 1)}>Recargar datos</Button><Link href="/login" className="ml-4 underline">Iniciar sesión</Link></div>}
    <p role="status">{message}</p>
    <section aria-labelledby="new-item" className="rounded-2xl border border-[#dce4dc] bg-white p-5">
      <h2 id="new-item" className="text-xl font-semibold">Nuevo producto</h2>
      {error && errorKind === "item" && <p role="alert" className="mt-3 text-red-800">{error}</p>}
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
          <Button variant="secondary" className="mt-3" disabled={busy} onClick={() => { setSelected(item); setHistoryPage(1); setError(""); setMessage(""); }}>Movimientos de {item.name}</Button>
        </article>)}</div>
        <div className="flex flex-wrap items-center gap-3"><Button variant="secondary" className="shrink-0" disabled={page === 1} onClick={() => setPage(value => value - 1)}>Anterior</Button><span className="shrink-0 whitespace-nowrap">Página {page}</span><Button variant="secondary" className="shrink-0" disabled={page * 24 >= data.total} onClick={() => setPage(value => value + 1)}>Siguiente</Button></div>
      </>}
    </section>
    {selected && <section aria-labelledby="movements" className="space-y-4 rounded-2xl border border-[#dce4dc] bg-white p-5">
      <InventoryDetails key={selected.id} id={selected.id} onSaved={item => { setSelected(item); setRevision(value => value + 1); }} />
      <h2 id="movements" ref={movementHeading} tabIndex={-1} className="break-words text-xl font-semibold focus-visible:outline-2 focus-visible:outline-offset-4">Movimientos: {selected.name}</h2>
      <p>Existencias al consultar: {selected.stock}. El servidor valida el saldo actual al guardar.</p>
      {error && errorKind === "movement" && <p role="alert" className="text-red-800">{error}</p>}
      <p className="text-sm">Si falla la conexión, reintenta con los mismos datos. Antes de repetir una operación después de recargar la página, revisa el historial.</p>
      <form onSubmit={event => { event.preventDefault(); void save("movement"); }} className="grid gap-4 sm:grid-cols-3">
        <fieldset disabled={busy} className="contents">
          <label className={field}>Tipo<select className="min-h-11 rounded border p-2" value={type} onChange={event => updateMovementDraft({ type: event.target.value })}>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className={field}>{type === "ADJUSTMENT" ? "Existencia final contada" : "Cantidad"}<Input required type="number" min={type === "ADJUSTMENT" ? 0 : 1} max="2147483647" step="1" value={quantity} onChange={event => updateMovementDraft({ quantity: event.target.value })} /></label>
          <label className={field}>Motivo<Input required minLength={3} maxLength={300} value={reason} onChange={event => updateMovementDraft({ reason: event.target.value })} /></label>
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
        <div className="flex flex-wrap items-center gap-3"><Button variant="secondary" className="shrink-0" disabled={historyPage === 1} onClick={() => setHistoryPage(value => value - 1)}>Anteriores</Button><span className="shrink-0 whitespace-nowrap">Página {historyPage}</span><Button variant="secondary" className="shrink-0" disabled={historyPage * 24 >= history.total} onClick={() => setHistoryPage(value => value + 1)}>Más movimientos</Button></div>
      </>}
    </section>}
  </main>;
}
