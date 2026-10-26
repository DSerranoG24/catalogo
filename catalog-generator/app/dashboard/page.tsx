"use client";

import { Card } from "@/components/ui/Card";

import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { AlertDialog, AlertDialogCancel, Dialog, DialogActions, dialogStyles } from "@/components/ui/Dialog";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { apiRequest, Catalog, clearSession, getSession } from "@/lib/api";
import { Archive, ArrowUpRight, Box, CirclePlus, ExternalLink, LayoutDashboard, RefreshCw, RotateCcw, Store, Trash2 } from "lucide-react";

type PendingAction =
  | { type: "archive"; catalog: Catalog }
  | { type: "delete"; catalog: Catalog }
  | null;

export default function CatalogDashboard() {
  const router = useRouter();
  const [catalogs, setCatalogs] = useState<Catalog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [confirmChecked, setConfirmChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  async function signOut() {
    if (signingOut || busy) return;
    setSigningOut(true);
    setError("");
    if (await clearSession({ waitForServer: true })) {
      router.replace("/login");
      router.refresh();
    } else {
      setError("No se pudo cerrar la sesión del servidor. Comprueba tu conexión y vuelve a intentarlo.");
      setSigningOut(false);
    }
  }

  useEffect(() => {
    const session = getSession();
    if (!session) {
      router.replace("/login");
      return;
    }

    let active = true;
    apiRequest<{ catalogs: Catalog[] }>("/catalogs")
      .then((result) => {
        if (active) setCatalogs(result.catalogs);
      })
      .catch((requestError) => {
        if (!active) return;
        if (requestError instanceof Error && "status" in requestError && (requestError as { status: number }).status === 401) {
          clearSession();
          router.replace("/login");
          return;
        }
        setError(
          requestError instanceof Error
            ? requestError.message
            : "No se pudieron cargar los catálogos."
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [reloadKey, router]);

  const activeCatalogs = catalogs.filter((c) => !c.archivedAt);
  const archivedCatalogs = catalogs.filter((c) => c.archivedAt);

  function openArchiveConfirm(catalog: Catalog) {
    setNotice("");
    setPendingAction({ type: "archive", catalog });
  }

  function openDeleteConfirm(catalog: Catalog) {
    setNotice("");
    setPendingAction({ type: "delete", catalog });
    setConfirmChecked(false);
  }

  function closeModal() {
    if (busy) return;
    setPendingAction(null);
    setConfirmChecked(false);
  }

  async function confirmArchive() {
    if (!pendingAction || pendingAction.type !== "archive") return;
    const { catalog } = pendingAction;
    setBusy(true);
    try {
      await apiRequest(`/catalogs/${catalog.id}/archive`, { method: "POST" });
      setCatalogs((current) =>
        current.map((item) =>
          item.id === catalog.id ? { ...item, archivedAt: new Date().toISOString() } : item
        )
      );
      setNotice("Catálogo archivado. Sus productos y pedidos se conservan.");
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "No se pudo archivar el catálogo."
      );
    } finally {
      setBusy(false);
      setPendingAction(null);
    }
  }

  async function reactivateCatalog(catalog: Catalog) {
    setNotice("");
    setError("");
    try {
      await apiRequest(`/catalogs/${catalog.id}/reactivate`, { method: "POST" });
      setCatalogs((current) =>
        current.map((item) =>
          item.id === catalog.id ? { ...item, archivedAt: null } : item
        )
      );
      setNotice("Catálogo reactivado.");
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "No se pudo reactivar el catálogo."
      );
    }
  }

  async function confirmDelete() {
    if (!pendingAction || pendingAction.type !== "delete" || !confirmChecked) return;
    const { catalog } = pendingAction;
    setBusy(true);
    try {
      await apiRequest(`/catalogs/${catalog.id}`, { method: "DELETE" });
      setCatalogs((current) => current.filter((item) => item.id !== catalog.id));
      setNotice("Catálogo eliminado.");
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "No se pudo eliminar el catálogo."
      );
    } finally {
      setBusy(false);
      setPendingAction(null);
      setConfirmChecked(false);
    }
  }

  if (loading && catalogs.length === 0) {
    return <main role="status" aria-label="Cargando tus catálogos" className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-8 sm:py-14"><div className="h-48 animate-pulse rounded-3xl bg-[#dce8dc]" /><div className="mt-7 grid gap-3 sm:grid-cols-3">{[0, 1, 2].map((item) => <div key={item} className="h-20 animate-pulse rounded-2xl border border-[#e2e8e0] bg-white/80" />)}</div><div className="mt-10 h-7 w-44 animate-pulse rounded-full bg-[#dce8dc]" /><div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map((item) => <div key={item} className="h-60 animate-pulse rounded-2xl border border-[#e2e8e0] bg-white/80" />)}</div></main>;
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-8 sm:py-12">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs font-medium text-[#7b8780]"><LayoutDashboard className="size-4" aria-hidden="true" /><span>Panel de control</span><span className="text-[#c2cbc3]">/</span><span className="text-[#35473d]">Catálogos</span></div>
        <Button variant="secondary" type="button" onClick={() => { void signOut(); }} disabled={busy || signingOut} >{signingOut ? "Cerrando sesión…" : "Cerrar sesión"}</Button>
      </div>

      <section className="relative overflow-hidden rounded-3xl bg-[var(--brand-forest)] px-6 py-8 text-white shadow-[0_24px_60px_-38px_rgba(18,55,45,0.8)] sm:px-9 sm:py-10">
        <div className="pointer-events-none absolute -right-14 -top-24 size-72 rounded-full border border-white/10" /><div className="pointer-events-none absolute -right-2 -top-12 size-48 rounded-full border border-white/10" />
        <div className="relative flex flex-col justify-between gap-7 sm:flex-row sm:items-end">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#c3e5d4]"><Store className="size-3.5" aria-hidden="true" /> Espacio de trabajo</span>
            <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">Tus catálogos, <span className="font-serif font-normal italic text-[#b8dec8]">a tu manera.</span></h1>
            <p className="mt-3 max-w-lg text-sm leading-6 text-white/70">Organiza tus productos y comparte una tienda que represente tu negocio.</p>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="header-action"
              type="button"
              onClick={() => { setError(""); setNotice(""); setLoading(true); setReloadKey((key) => key + 1); }}

            >
              <RefreshCw className="size-4" aria-hidden="true" /> Actualizar
            </Button>
            <Link href="/dashboard/catalogos/nuevo" className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#c3e5d4] px-4 text-sm font-semibold text-[var(--brand-forest)] transition hover:bg-white">
              <CirclePlus className="size-4" aria-hidden="true" /> Nuevo catálogo
            </Link>
          </div>
        </div>
      </section>

      <div className="mt-7 grid gap-3 sm:grid-cols-3">
        <div className="flex items-center gap-3 rounded-2xl border border-[#e2e8e0] bg-white/85 p-4"><span className="grid size-10 place-items-center rounded-xl bg-[var(--brand-emerald-soft)] text-[#315e4f]"><Store className="size-4" aria-hidden="true" /></span><div><p className="text-xl font-semibold tracking-tight text-[#263b31]">{catalogs.length}</p><p className="text-xs text-[#78847d]">{catalogs.length === 1 ? "catálogo creado" : "catálogos creados"}</p></div></div>
        <div className="flex items-center gap-3 rounded-2xl border border-[#e2e8e0] bg-white/85 p-4"><span className="grid size-10 place-items-center rounded-xl bg-[#f4eee5] text-[#99734c]"><Box className="size-4" aria-hidden="true" /></span><div><p className="text-sm font-semibold text-[#263b31]">Todo organizado</p><p className="text-xs text-[#78847d]">Productos y pedidos en un lugar</p></div></div>
        <div className="flex items-center gap-3 rounded-2xl border border-[#e2e8e0] bg-white/85 p-4"><span className="grid size-10 place-items-center rounded-xl bg-[#f9ece8] text-[var(--brand-coral-text)]"><ExternalLink className="size-4" aria-hidden="true" /></span><div><p className="text-sm font-semibold text-[#263b31]">Listo para compartir</p><p className="text-xs text-[#78847d]">Cada tienda tiene su propio enlace</p></div></div>
      </div>

      {error && (
        <div role="alert" className="mt-7 flex items-center justify-between gap-4 rounded-md border border-[#f0c8b9] bg-[#fff4ef] px-4 py-3 text-sm text-[#a5432a]">
          <span>{error}</span>
          <Button variant="ghost" type="button" onClick={() => { setError(""); setLoading(true); setReloadKey((key) => key + 1); }} className="shrink-0">Reintentar</Button>
        </div>
      )}

      {notice && (
        <div role="status" className="mt-7 flex items-center justify-between gap-4 rounded-md border border-[#c9e0d1] bg-[#f2faf4] px-4 py-3 text-sm text-[#276749]">
          <span>{notice}</span>
          <Button variant="ghost" type="button" onClick={() => setNotice("")} className="shrink-0">Cerrar</Button>
        </div>
      )}

      <div className="mt-10 flex items-end justify-between border-b border-[#dce4dc] pb-4">
        <div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--brand-coral-text)]">Activos</p><h2 className="mt-1 text-lg font-semibold tracking-tight text-[#263b31]">Mis catálogos</h2></div>
        <span className="rounded-full bg-white px-3 py-1.5 text-xs font-medium tabular-nums text-[#66756b]">{activeCatalogs.length} {activeCatalogs.length === 1 ? "catálogo" : "catálogos"}</span>
      </div>

      {activeCatalogs.length === 0 && archivedCatalogs.length === 0 ? (
        <section className="mt-5 flex min-h-80 flex-col items-center justify-center rounded-3xl border border-dashed border-[#cbd7cc] bg-white/65 px-6 text-center">
          <span className="grid size-14 place-items-center rounded-2xl bg-[#e7f0e8] text-[#315e4f]"><CirclePlus className="size-6" aria-hidden="true" /></span>
          <h2 className="mt-5 text-xl font-semibold tracking-tight text-[#263b31]">Tu primer catálogo empieza aquí</h2>
          <p className="mt-2 max-w-sm text-sm leading-6 text-[#68756e]">Crea un espacio para tus productos y empieza a prepararlo para compartir.</p>
          <Link href="/dashboard/catalogos/nuevo" className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl bg-[var(--brand-emerald)] px-5 text-sm font-semibold text-white transition hover:bg-[var(--brand-emerald-hover)]">Crear catálogo <ArrowUpRight className="size-4" aria-hidden="true" /></Link>
        </section>
      ) : (
        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {activeCatalogs.map((catalog: Catalog) => (
            <Card as="article" variant="interactive" key={catalog.id} className="group relative flex min-h-60 flex-col overflow-hidden">
              <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#83b59a] via-[#d6bf92] to-[#d9947e] opacity-70 transition group-hover:opacity-100" />
              <div className="flex items-start justify-between gap-4">
                <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-[#edf3ec] text-sm font-bold text-[#315e4f]">
                  {catalog.name.trim().charAt(0).toUpperCase() || <Store className="size-4" />}
                </div>
                <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
                  <Button variant="ghost" size="sm"
                    type="button"
                    onClick={() => openArchiveConfirm(catalog)}
                    aria-label={`Archivar ${catalog.name}`}
                    title="Archivar catálogo"

                  >
                    <Archive className="size-3.5" aria-hidden="true" /> Archivar
                  </Button>
                  <Button variant="destructive-ghost" size="sm"
                    type="button"
                    onClick={() => openDeleteConfirm(catalog)}
                    aria-label={`Eliminar ${catalog.name} permanentemente`}
                    title="Eliminar catálogo permanentemente"

                  >
                    <Trash2 className="size-3.5" aria-hidden="true" /> Eliminar
                  </Button>
                </div>
              </div>
              <p className="mt-5 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--brand-coral-text)]">Tienda en línea</p><h3 className="mt-1 text-lg font-semibold tracking-tight text-[#202b27]">{catalog.name}</h3>
              <p className="mt-1 line-clamp-2 min-h-10 text-sm leading-5 text-[#68756e]">{catalog.description || `/${catalog.slug}`}</p>
              <Link href={`/dashboard/catalogos/${catalog.id}`} className="mt-auto flex min-h-11 items-center justify-between border-t border-[#edf1ec] pt-3 text-sm font-semibold text-[#315e4f]">
                Abrir panel <ArrowUpRight className="size-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden="true" />
              </Link>
            </Card>
          ))}
        </div>
      )}

      {archivedCatalogs.length > 0 && (
        <>
          <div className="mt-12 flex items-end justify-between border-b border-[#dce4dc] pb-4">
            <div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--brand-coral-text)]">Archivados</p><h2 className="mt-1 text-lg font-semibold tracking-tight text-[#263b31]">Catálogos archivados</h2></div>
            <span className="rounded-full bg-white px-3 py-1.5 text-xs font-medium tabular-nums text-[#66756b]">{archivedCatalogs.length} {archivedCatalogs.length === 1 ? "archivado" : "archivados"}</span>
          </div>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-[#68756e]">Los catálogos archivados no son visibles para tus clientes. Sus productos y pedidos se conservan.</p>
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {archivedCatalogs.map((catalog: Catalog) => (
              <Card as="article" variant="normal" key={catalog.id} className="group relative flex min-h-[220px] flex-col overflow-hidden">
                <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#83b59a]/30 via-[#d6bf92]/30 to-[#d9947e]/30 opacity-50" />
                <div className="flex items-start justify-between gap-4">
                  <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-[#e8f0e6] text-sm font-bold text-[#52725e]">
                    {catalog.name.trim().charAt(0).toUpperCase() || <Store className="size-4" />}
                  </div>
                  <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
                    <Button variant="ghost" size="sm"
                      type="button"
                      onClick={() => reactivateCatalog(catalog)}
                      aria-label={`Reactivar ${catalog.name}`}
                      title="Reactivar catálogo"

                    >
                      <RotateCcw className="size-3.5" aria-hidden="true" /> Reactivar
                    </Button>
                    <Button variant="destructive-ghost" size="sm"
                      type="button"
                      onClick={() => openDeleteConfirm(catalog)}
                      aria-label={`Eliminar ${catalog.name} permanentemente`}
                      title="Eliminar catálogo permanentemente"

                    >
                      <Trash2 className="size-3.5" aria-hidden="true" /> Eliminar
                    </Button>
                  </div>
                </div>
                <p className="mt-5 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--brand-coral-text)]">Archivado</p>
                <h3 className="mt-1 text-lg font-semibold tracking-tight text-[#5d6a63] line-through decoration-[#b9c4bb]">{catalog.name}</h3>
                <p className="mt-1 line-clamp-2 min-h-10 text-sm leading-5 text-[#68756e]">{catalog.description || `/${catalog.slug}`}</p>
                <Link href={`/dashboard/catalogos/${catalog.id}`} className="mt-auto flex min-h-11 items-center justify-between border-t border-[#edf1ec] pt-3 text-sm font-semibold text-[#52675b]">
                  Revisar catálogo <ArrowUpRight className="size-4" aria-hidden="true" />
                </Link>
              </Card>
            ))}
          </div>
        </>
      )}

      <Dialog open={pendingAction?.type === "archive"} onOpenChange={open => { if (!open) closeModal(); }} busy={busy}
        title="Archivar catálogo"
        description={<>«{pendingAction?.catalog.name}» dejará de ser visible para tus clientes. Sus productos, categorías y pedidos se conservan y puedes reactivarlo cuando quieras.</>}>
        <DialogActions>
          <Button variant="secondary" onClick={closeModal} disabled={busy}>Cancelar</Button>
          <Button onClick={confirmArchive} loading={busy}>{busy ? "Archivando…" : "Archivar"}</Button>
        </DialogActions>
      </Dialog>

      <AlertDialog open={pendingAction?.type === "delete"} onOpenChange={open => { if (!open) closeModal(); }} busy={busy}
        title="Eliminar catálogo"
        description={<>Esta acción es permanente y no se puede deshacer. Se eliminarán el catálogo «{pendingAction?.catalog.name}», sus productos y sus categorías.</>}>
        <p className={dialogStyles.warning}>Si este catálogo tiene pedidos registrados, la eliminación se bloqueará y se te pedirá archivarlo en su lugar. Así no pierdes tu historial de ventas.</p>
        <label className={dialogStyles.confirmation}>
          <input type="checkbox" checked={confirmChecked} onChange={event => setConfirmChecked(event.target.checked)} />
          <span>Entiendo que esta acción es permanente y quiero eliminar este catálogo.</span>
        </label>
        <DialogActions>
          <AlertDialogCancel disabled={busy} />
          <Button variant="destructive" onClick={confirmDelete} disabled={!confirmChecked} loading={busy}>{busy ? "Eliminando…" : "Eliminar permanentemente"}</Button>
        </DialogActions>
      </AlertDialog>
    </main>
  );
}
