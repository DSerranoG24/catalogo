"use client";

import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Input";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Image from "next/image";
import { apiRequest, ApiError, type Category } from "@/lib/api";
import { compressProductPhoto } from "@/lib/compress-product-photo";
import { uploadPhotoSequence, type PhotoResult } from "@/lib/product-photo-flow";

type Draft = { id: string; name: string; price: number; categoryId: string | null; description: string | null; images: { url: string }[] };
type Pending = { products: Draft[]; count: number; page: number; pages: number };
const control = "mt-1 min-h-11 w-full rounded-lg border border-[#d6dfd7] bg-white px-3 py-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-emerald)]";

export default function ProductPhotoPanel({ catalogId, categories, onRefresh, onBusy, onClose }: {
  catalogId: string; categories: Category[]; onRefresh: () => void; onBusy: (busy: boolean) => void; onClose: () => void;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [results, setResults] = useState<PhotoResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [index, setIndex] = useState(0);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [selected, setSelected] = useState(0);
  const [form, setForm] = useState({ name: "", price: "", categoryId: "", description: "", reviewed: false });
  const [baseline, setBaseline] = useState(form);
  const [loading, setLoading] = useState(false);
  const [expired, setExpired] = useState(false);
  const stop = useRef(false); const mounted = useRef(true); const locked = useRef(false);
  const title = useRef<HTMLHeadingElement>(null); const nameInput = useRef<HTMLInputElement>(null);
  const dirty = JSON.stringify(form) !== JSON.stringify(baseline);
  const dirtyRef = useRef(false);
  useEffect(() => { dirtyRef.current = dirty; }, [dirty]);

  function choose(draft: Draft | undefined, item: number) {
    setSelected(item);
    const value = { name: draft?.name ?? "", price: "", categoryId: draft?.categoryId ?? "", description: draft?.description ?? "", reviewed: false };
    setForm(value); setBaseline(value);
  }
  const refreshPending = useCallback(async (page = 1, preferredId?: string) => {
    setLoading(true);
    try {
      const result = await apiRequest<Pending>(`/products/catalog/${catalogId}/photos/pending?page=${page}`, { signal: AbortSignal.timeout(30_000) });
      if (!mounted.current) return;
      if (!Array.isArray(result.products) || result.products.length > 24 || !Number.isSafeInteger(result.count) || result.count < 0
        || !Number.isSafeInteger(result.page) || result.page < 1 || !Number.isSafeInteger(result.pages) || result.pages < 1
        || result.products.some(product => typeof product.id !== "string" || typeof product.name !== "string" || !Number.isSafeInteger(product.price)
          || !(product.categoryId === null || typeof product.categoryId === "string") || !(product.description === null || typeof product.description === "string")
          || !Array.isArray(product.images) || product.images.some(image => typeof image.url !== "string"))) throw new Error("Respuesta incompleta al consultar pendientes.");
      const nextIndex = Math.max(0, result.products.findIndex(product => product.id === preferredId));
      setPending(result); setSelected(nextIndex);
      const draft = result.products[nextIndex];
      const value = { name: draft?.name ?? "", price: "", categoryId: draft?.categoryId ?? "", description: draft?.description ?? "", reviewed: false };
      setForm(value); setBaseline(value);
    } catch (failure) { if (mounted.current) { setError(failure instanceof Error ? failure.message : "No se pudieron consultar los pendientes."); if (failure instanceof ApiError && failure.status === 401) setExpired(true); } }
    finally { if (mounted.current) setLoading(false); }
  }, [catalogId]);
  useEffect(() => {
    mounted.current = true; title.current?.focus();
    const timer = setTimeout(() => { void refreshPending(); }, 0);
    return () => { mounted.current = false; stop.current = true; clearTimeout(timer); };
  }, [refreshPending]);
  useEffect(() => { if (!busy && !loading && pending?.products[selected]) nameInput.current?.focus(); }, [busy, loading, pending, selected]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (locked.current || dirtyRef.current) { event.preventDefault(); event.returnValue = ""; } };
    const protectLink = (event: MouseEvent) => {
      const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!anchor || anchor.getAttribute("target") === "_blank") return;
      if (locked.current || (dirtyRef.current && !window.confirm("Tienes cambios sin guardar. ¿Quieres salir y descartarlos?"))) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener("beforeunload", warn); document.addEventListener("click", protectLink, true);
    return () => { window.removeEventListener("beforeunload", warn); document.removeEventListener("click", protectLink, true); };
  }, []);
  function mayLeave() { return !dirtyRef.current || window.confirm("Tienes cambios sin guardar. ¿Quieres descartarlos?"); }
  async function upload() {
    if (locked.current || !files.length || files.length > 30 || !mayLeave()) return;
    locked.current = true; stop.current = false; setBusy(true); setUploading(true); onBusy(true); setError(""); setResults([]); setIndex(0);
    try {
      const plan = await apiRequest<{ token: string; count: number }>(`/products/catalog/${catalogId}/photos/plan`, { method: "POST", body: JSON.stringify({ count: files.length }), signal: AbortSignal.timeout(30_000) });
      if (typeof plan.token !== "string" || plan.count !== files.length) throw new Error("No se pudo preparar el plan de carga.");
      const report = await uploadPhotoSequence(files, {
        prepare: compressProductPhoto, stopped: () => stop.current || !mounted.current,
        progress: (rows, current) => { if (mounted.current) { setResults(rows); setIndex(current); } },
        fatal: failure => { if (failure instanceof ApiError && failure.status === 401) setExpired(true); return failure instanceof ApiError && [401, 403, 404, 409, 429].includes(failure.status); },
        send: async (file, slot) => {
          const body = new FormData(); body.append("token", plan.token); body.append("index", String(slot)); body.append("image", file);
          const response = await apiRequest<{ product: { id: string } }>(`/products/catalog/${catalogId}/photos/item`, { method: "POST", body, signal: AbortSignal.timeout(30_000) });
          if (typeof response.product?.id !== "string") throw new Error("Respuesta incompleta. Refresca el listado para comprobar si se creó.");
          return response.product;
        },
      });
      if (mounted.current) { setResults(report); setFiles([]); }
    } catch (failure) { if (mounted.current) { setError(failure instanceof Error ? failure.message : "No se pudo iniciar la carga."); if (failure instanceof ApiError && failure.status === 401) setExpired(true); } }
    finally {
      locked.current = false;
      if (mounted.current) { setBusy(false); setUploading(false); onBusy(false); onRefresh(); await refreshPending(); title.current?.focus(); }
    }
  }
  async function complete(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const draft = pending?.products[selected];
    if (!draft || locked.current || !form.price.trim() || !form.reviewed) return;
    const price = Number(form.price);
    if (!Number.isSafeInteger(price) || price < 0 || price > 2147483647) { setError("Introduce un precio entero válido."); return; }
    locked.current = true; setBusy(true); onBusy(true); setError("");
    try {
      await apiRequest(`/products/${draft.id}/complete`, { method: "PUT", body: JSON.stringify({ name: form.name.trim(), price,
        categoryId: form.categoryId || null, description: form.description.trim(), reviewed: true }), signal: AbortSignal.timeout(30_000) });
      // Keep the remaining local queue, so saving advances instead of restarting at the first draft.
      const remaining = pending.products.filter(product => product.id !== draft.id);
      const nextIndex = Math.max(0, Math.min(selected, remaining.length - 1));
      const nextDraft = remaining[nextIndex];
      setPending({ ...pending, products: remaining });
      choose(nextDraft, nextIndex);
      onRefresh();
      await refreshPending(pending.page, nextDraft?.id);
      nameInput.current?.focus();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "No se pudo completar el producto. Revisa el listado antes de repetir."); if (failure instanceof ApiError && failure.status === 401) setExpired(true); }
    finally { locked.current = false; setBusy(false); onBusy(false); }
  }
  const draft = pending?.products[selected];
  return <section aria-labelledby="photo-title" className="mt-6 min-w-0 rounded-2xl border border-[#d6dfd7] bg-white p-4 sm:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="photo-title" ref={title} tabIndex={-1} className="text-xl font-semibold">Cargar varias fotos</h2><Button variant="ghost" type="button"  disabled={busy || loading} onClick={() => { if (mayLeave()) onClose(); }}>Cerrar</Button></div>
    <p className="mt-2 text-sm">Una foto crea un producto distinto. Varias vistas del mismo artículo no se agrupan. Se guardan inactivos hasta que los completes y publiques.</p>
    <p className="mt-2 text-sm">Hasta 30 fotos. JPG, PNG o WebP; original hasta 20 MiB y 40 megapíxeles. Se preparan una a una a un máximo de 1.800 px y 2 MiB, intentando llegar a 300 KB.</p>
    <p className="mt-2 text-sm">El reporte no se recupera tras recargar. Si se pierde una respuesta, el producto puede estar creado: comprueba el listado antes de subirlo otra vez.</p>
    {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {expired && <p role="alert" className="mt-3 text-sm">La sesión ha expirado. El reporte se perderá al salir, pero los productos guardados se conservan. <a href="/login" className="inline-flex min-h-11 items-center underline focus-visible:outline-2">Iniciar sesión de nuevo</a></p>}
    <fieldset disabled={busy || loading} className="mt-4"><legend className="sr-only">Seleccionar fotografías</legend><label className="block text-sm font-semibold">Fotografías<input className={control} type="file" multiple accept="image/jpeg,image/png,image/webp" onChange={event => {
      const chosen = Array.from(event.target.files ?? []);
      if (chosen.length > 30) { setError("Selecciona como máximo 30 fotos."); setFiles([]); event.target.value = ""; return; }
      setFiles(chosen); setError("");
    }} /></label><Button variant="primary" type="button" className="mt-3" disabled={!files.length} onClick={() => void upload()}>Cargar {files.length || "las"} fotos</Button></fieldset>
    {uploading && <div className="mt-3"><p role="status">Subiendo {Math.min(index + 1, files.length)} de {files.length}</p><progress aria-label="Fotografías procesadas" max={Math.max(1, files.length)} value={results.length} className="mt-2 w-full" /><Button variant="outline" className="mt-2" type="button" onClick={() => { stop.current = true; }}>Detener después de la foto actual</Button></div>}
    {results.length > 0 && <div className="mt-4" role="status"><p>{results.filter(row => row.status === "created").length} creados · {results.filter(row => row.status !== "created").length} sin confirmar</p><ul className="mt-2 max-h-52 space-y-1 overflow-auto text-sm">{results.map((row, item) => <li key={item} className="break-words">{row.name}: {row.status === "created" ? "Creado, sin completar" : row.status === "not_processed" ? "No procesado" : row.status === "failed" ? "No se pudo preparar" : "Resultado sin confirmar"}{row.message ? ` · ${row.message}` : ""}</li>)}</ul></div>}
    <div className="mt-6 border-t border-[#d6dfd7] pt-4"><h3 className="font-semibold">Completar productos</h3><p aria-live="polite" className="mt-1 text-sm">{pending ? `Faltan ${pending.count} productos por completar (total del servidor).` : "Consultando pendientes…"}</p>
      <Button variant="secondary" type="button" disabled={busy || loading} className="mt-2" onClick={() => { if (mayLeave()) { setError(""); void refreshPending(pending?.page); } }}>Actualizar pendientes</Button>
      <p className="mt-2 text-sm">Guardar los deja completos e inactivos. Después podrás publicarlos desde el listado. Categoría y descripción son opcionales.</p>
      {draft && <div className="mt-4 grid min-w-0 gap-5 md:grid-cols-2"><div className="relative aspect-square min-w-0 rounded-xl bg-[var(--brand-emerald-soft)]">{draft.images[0] ? <Image src={draft.images[0].url} alt={draft.name} fill unoptimized className="object-contain" sizes="(max-width: 768px) 90vw, 40vw" /> : <span>Sin imagen disponible</span>}</div>
        <form onSubmit={event => void complete(event)} className="min-w-0 space-y-3"><fieldset disabled={busy || loading} className="space-y-3"><legend className="sr-only">Datos del producto</legend>
          <label className="block text-sm">Nombre revisado<Input ref={nameInput} required maxLength={150} className="mt-1" value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} /></label>
          <label className="block text-sm">Precio en COP<Input required type="number" min="0" max="2147483647" step="1" className="mt-1" value={form.price} onChange={event => setForm({ ...form, price: event.target.value })} /></label>
          <label className="block text-sm">Categoría (opcional)<select className={control} value={form.categoryId} onChange={event => setForm({ ...form, categoryId: event.target.value })}><option value="">Sin categoría</option>{categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
          <label className="block text-sm">Descripción (opcional)<Textarea className="mt-1" maxLength={2000} rows={3} value={form.description} onChange={event => setForm({ ...form, description: event.target.value })} /></label>
          <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" required checked={form.reviewed} onChange={event => setForm({ ...form, reviewed: event.target.checked })} />He revisado el nombre y el precio, incluso si es 0.</label>
          <div className="flex flex-wrap gap-2"><Button variant="secondary"  type="button" disabled={selected === 0} onClick={() => { if (mayLeave()) { choose(pending.products[selected - 1], selected - 1); nameInput.current?.focus(); } }}>Anterior</Button><Button variant="primary"  type="submit">Guardar y siguiente</Button><Button variant="ghost"  type="button" disabled={selected >= pending.products.length - 1} onClick={() => { if (mayLeave()) choose(pending.products[selected + 1], selected + 1); }}>Omitir por ahora</Button></div>
        </fieldset></form></div>}
      {pending && pending.pages > 1 && <nav aria-label="Páginas de productos pendientes" className="mt-4 flex flex-wrap gap-2"><Button variant="secondary" type="button"  disabled={busy || loading || pending.page <= 1} onClick={() => { if (mayLeave()) void refreshPending(pending.page - 1); }}>Página anterior</Button><span className="self-center text-sm">Página {pending.page} de {pending.pages}</span><Button variant="secondary" type="button"  disabled={busy || loading || pending.page >= pending.pages} onClick={() => { if (mayLeave()) void refreshPending(pending.page + 1); }}>Página siguiente</Button></nav>}
    </div>
  </section>;
}
