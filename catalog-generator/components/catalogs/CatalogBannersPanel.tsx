"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Image from "next/image";
import { Button } from "@/components/ui/Button";
import { AlertDialog, AlertDialogCancel, DialogActions } from "@/components/ui/Dialog";
import { apiRequest, ApiError, type Category } from "@/lib/api";
import { readBanners, type CatalogBanner } from "@/lib/catalog-highlights";

const BannerEditor = dynamic(() => import("./CatalogBannerEditor"), { ssr: false, loading: () => <p role="status">Cargando editor de anuncios…</p> });
export default function CatalogBannersPanel({ catalogId, categories, archived }: { catalogId: string; categories: Category[]; archived: boolean }) {
  const [banners, setBanners] = useState<CatalogBanner[]>([]);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [editor, setEditor] = useState<{ banner: CatalogBanner | null } | null>(null);
  const [deleting, setDeleting] = useState<CatalogBanner | null>(null);
  const busyRef = useRef(false), mounted = useRef(false);
  const addButton = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null), returnFocus = useRef(false);
  useEffect(() => {
    if (!editor && !deleting && !busy && returnFocus.current) {
      returnFocus.current = false;
      if (addButton.current && !addButton.current.disabled) addButton.current.focus(); else heading.current?.focus();
    }
  }, [editor, deleting, busy]);
  const read = useCallback(async (signal?: AbortSignal) => readBanners(await apiRequest<unknown>(`/catalogs/${catalogId}/banners`, { signal })), [catalogId]);
  useEffect(() => {
    mounted.current = true; const controller = new AbortController();
    async function load() {
      try { const rows = await read(controller.signal); if (!controller.signal.aborted) { setBanners(rows); setReady(true); } }
      catch (failure) { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "No se pudieron cargar los anuncios."); }
    }
    void load(); return () => { mounted.current = false; controller.abort(); };
  }, [read]);
  async function refresh() {
    try { const rows = await read(); if (mounted.current) { setBanners(rows); setReady(true); } return rows; }
    catch (failure) { if (mounted.current) { setReady(false); setError(failure instanceof Error ? failure.message : "No se pudo confirmar el estado de los anuncios."); } return null; }
  }
  async function mutate(work: () => Promise<unknown>, success: string, creating = false) {
    if (busyRef.current || archived || !ready) return false;
    busyRef.current = true; setBusy(true); setError(""); setMessage("");
    try {
      await work(); await refresh();
      if (mounted.current) setMessage(success);
      return true;
    } catch (failure) {
      await refresh();
      if (mounted.current) {
        setError(failure instanceof Error ? failure.message : "No se pudo completar la operación.");
        // A lost POST response may have committed: require review before another creation.
        if (creating && (!(failure instanceof ApiError) || failure.status >= 500)) {
          setReady(false); setError("No se pudo confirmar la creación. Consulta los anuncios y revisa si se guardó antes de reintentar.");
        }
      }
      return false;
    } finally { busyRef.current = false; if (mounted.current) setBusy(false); }
  }
  function closeEditor() { returnFocus.current = true; setEditor(null); }
  async function save(data: FormData, id?: string) {
    const ok = await mutate(() => apiRequest<unknown>(`/catalogs/${catalogId}/banners${id ? `/${id}` : ""}`, { method: id ? "PUT" : "POST", body: data }), "Anuncio guardado.", !id);
    if (ok && mounted.current) closeEditor();
    return ok;
  }
  async function move(index: number, delta: number) {
    const ids = banners.map(banner => banner.id); const destination = index + delta;
    if (destination < 0 || destination >= ids.length) return;
    [ids[index], ids[destination]] = [ids[destination], ids[index]];
    await mutate(() => apiRequest<unknown>(`/catalogs/${catalogId}/banners/order`, { method: "PUT", body: JSON.stringify({ ids }) }), "Orden de anuncios actualizado.");
  }
  return <section aria-labelledby="catalog-banners-heading" className="min-w-0 rounded-3xl border border-[#e2e8e0] bg-white p-5 sm:p-7">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 ref={heading} tabIndex={-1} id="catalog-banners-heading" className="text-lg font-semibold">Anuncios destacados</h2><span className="text-sm">{ready ? `${banners.length} de 3 anuncios` : "Consultando anuncios…"}</span></div>
    <p className="mt-2 text-sm">Promociona productos, categorías o enlaces propios con imágenes 16:9.</p>
    {archived && <p className="mt-2 text-sm">Reactiva el catálogo para gestionar sus anuncios.</p>}
    {error && <p role="alert" className="mt-3 text-sm text-[#9f1239]">{error}</p>}
    {message && <p role="status" className="mt-3 text-sm">{message}</p>}
    {!ready && <Button variant="outline" disabled={busy} className="mt-3" onClick={() => void refresh()}>Consultar anuncios antes de reintentar</Button>}
    {ready && banners.length === 3 && <p id="banner-limit" className="mt-3 text-sm">Límite de 3 anuncios alcanzado. Elimina uno para añadir otro; los inactivos también cuentan.</p>}
    <Button ref={addButton} variant="outline" className="mt-4" disabled={archived || busy || !ready || banners.length >= 3 || editor !== null} aria-describedby={banners.length >= 3 ? "banner-limit" : undefined} onClick={() => setEditor({ banner: null })}>Añadir anuncio</Button>
    <ul className="mt-4 space-y-4">{banners.map((banner, index) => <li key={banner.id} className="min-w-0 rounded-xl border border-[#cbd5e1] p-3">
      <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-[#e2e8f0]"><Image src={banner.imageUrl} alt="" fill unoptimized sizes="(max-width: 640px) 90vw, 500px" className="object-cover object-center" /></div>
      <h3 className="mt-2 break-words font-semibold">{banner.title}</h3><p className="text-sm">Posición {index + 1} · {banner.active ? "Activo" : "Inactivo"}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="outline" size="sm" disabled={archived || busy || !ready || editor !== null || index === 0} aria-label={`Subir ${banner.title}`} onClick={() => void move(index, -1)}>Subir</Button>
        <Button variant="outline" size="sm" disabled={archived || busy || !ready || editor !== null || index === banners.length - 1} aria-label={`Bajar ${banner.title}`} onClick={() => void move(index, 1)}>Bajar</Button>
        <Button variant="secondary" size="sm" disabled={archived || busy || !ready || editor !== null} aria-label={`Editar ${banner.title}`} onClick={() => setEditor({ banner })}>Editar</Button>
        <Button variant="outline" size="sm" disabled={archived || busy || !ready || editor !== null} aria-label={`${banner.active ? "Desactivar" : "Activar"} ${banner.title}`} onClick={() => void mutate(() => apiRequest<unknown>(`/catalogs/${catalogId}/banners/${banner.id}`, { method: "PUT", body: JSON.stringify({ active: !banner.active }) }), "Estado del anuncio actualizado.")}>{banner.active ? "Desactivar" : "Activar"}</Button>
        <Button variant="destructive-ghost" size="sm" disabled={archived || busy || !ready || editor !== null} aria-label={`Eliminar ${banner.title}`} onClick={() => setDeleting(banner)}>Eliminar</Button>
      </div>
    </li>)}</ul>
    {editor && <BannerEditor key={editor.banner?.id ?? "new"} catalogId={catalogId} banner={editor.banner} categories={categories} disabled={busy || archived || !ready} onSave={save} onCancel={closeEditor} />}
    <AlertDialog open={deleting !== null} onOpenChange={open => { if (!busy && !open) setDeleting(null); }} busy={busy} title="Eliminar anuncio" description={`¿Eliminar “${deleting?.title ?? ""}”?`}>
      {error && <p role="alert">{error}</p>}
      <DialogActions><AlertDialogCancel disabled={busy} /><Button variant="destructive" disabled={busy || archived} onClick={async () => { if (!deleting) return; const ok = await mutate(() => apiRequest<unknown>(`/catalogs/${catalogId}/banners/${deleting.id}`, { method: "DELETE" }), "Anuncio eliminado."); if (ok) { returnFocus.current = true; setDeleting(null); } }}>Eliminar anuncio</Button></DialogActions>
    </AlertDialog>
  </section>;
}
