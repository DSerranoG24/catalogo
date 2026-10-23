"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { apiRequest, Catalog, clearSession, getSession } from "@/lib/api";
import { ArrowUpRight, Box, CirclePlus, ExternalLink, LayoutDashboard, RefreshCw, Store, Trash2 } from "lucide-react";

export default function Home() {
  const router = useRouter();
  const [catalogs, setCatalogs] = useState<Catalog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

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
        if ("status" in (requestError as object) && (requestError as { status: number }).status === 401) {
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

  async function removeCatalog(catalog: Catalog) {
    if (!window.confirm(`¿Eliminar el catálogo “${catalog.name}” y su contenido?`)) return;
    const session = getSession();
    if (!session) return router.replace("/login");

    try {
      await apiRequest(`/catalogs/${catalog.id}`, {
        method: "DELETE",
      });
      setCatalogs((current) => current.filter((item) => item.id !== catalog.id));
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "No se pudo eliminar el catálogo."
      );
    }
  }

  if (loading && catalogs.length === 0) {
    return <main role="status" aria-label="Cargando tus catálogos" className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-8 sm:py-14"><div className="h-48 animate-pulse rounded-3xl bg-[#dce8dc]" /><div className="mt-7 grid gap-3 sm:grid-cols-3">{[0, 1, 2].map((item) => <div key={item} className="h-20 animate-pulse rounded-2xl border border-[#e2e8e0] bg-white/80" />)}</div><div className="mt-10 h-7 w-44 animate-pulse rounded-full bg-[#dce8dc]" /><div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map((item) => <div key={item} className="h-60 animate-pulse rounded-2xl border border-[#e2e8e0] bg-white/80" />)}</div></main>;
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-8 sm:py-12">
      <div className="mb-8 flex items-center gap-2 text-xs font-medium text-[#7b8780]"><LayoutDashboard className="size-4" aria-hidden="true" /><span>Panel de control</span><span className="text-[#c2cbc3]">/</span><span className="text-[#35473d]">Catálogos</span></div>
      <section className="relative overflow-hidden rounded-3xl bg-[#173f36] px-6 py-8 text-white shadow-[0_24px_60px_-38px_rgba(18,55,45,0.8)] sm:px-9 sm:py-10">
        <div className="pointer-events-none absolute -right-14 -top-24 size-72 rounded-full border border-white/10" /><div className="pointer-events-none absolute -right-2 -top-12 size-48 rounded-full border border-white/10" />
        <div className="relative flex flex-col justify-between gap-7 sm:flex-row sm:items-end">
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#c3e5d4]"><Store className="size-3.5" aria-hidden="true" /> Espacio de trabajo</span>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">Tus catálogos, <span className="font-serif font-normal italic text-[#b8dec8]">a tu manera.</span></h1>
          <p className="mt-3 max-w-lg text-sm leading-6 text-white/70">Organiza tus productos y comparte una tienda que represente tu negocio.</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              setError("");
              setLoading(true);
              setReloadKey((key) => key + 1);
            }}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-4 text-sm font-semibold text-white transition hover:bg-white/15"
          >
            <RefreshCw className="size-4" aria-hidden="true" /> Actualizar
          </button>
          <Link
            href="/dashboard/catalogos/nuevo"
            className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#c3e5d4] px-4 text-sm font-semibold text-[#173f36] transition hover:bg-white"
          >
            <CirclePlus className="size-4" aria-hidden="true" /> Nuevo catálogo
          </Link>
        </div>
      </div>
        </div>
      </section>

      <div className="mt-7 grid gap-3 sm:grid-cols-3">
        <div className="flex items-center gap-3 rounded-2xl border border-[#e2e8e0] bg-white/85 p-4"><span className="grid size-10 place-items-center rounded-xl bg-[#eaf2e9] text-[#315e4f]"><Store className="size-4" aria-hidden="true" /></span><div><p className="text-xl font-semibold tracking-tight text-[#263b31]">{catalogs.length}</p><p className="text-xs text-[#78847d]">{catalogs.length === 1 ? "catálogo creado" : "catálogos creados"}</p></div></div>
        <div className="flex items-center gap-3 rounded-2xl border border-[#e2e8e0] bg-white/85 p-4"><span className="grid size-10 place-items-center rounded-xl bg-[#f4eee5] text-[#99734c]"><Box className="size-4" aria-hidden="true" /></span><div><p className="text-sm font-semibold text-[#263b31]">Todo organizado</p><p className="text-xs text-[#78847d]">Productos y pedidos en un lugar</p></div></div>
        <div className="flex items-center gap-3 rounded-2xl border border-[#e2e8e0] bg-white/85 p-4"><span className="grid size-10 place-items-center rounded-xl bg-[#f9ece8] text-[#a95f4c]"><ExternalLink className="size-4" aria-hidden="true" /></span><div><p className="text-sm font-semibold text-[#263b31]">Listo para compartir</p><p className="text-xs text-[#78847d]">Cada tienda tiene su propio enlace</p></div></div>
      </div>

      {error && (
        <div role="alert" className="mt-7 flex items-center justify-between gap-4 rounded-md border border-[#f0c8b9] bg-[#fff4ef] px-4 py-3 text-sm text-[#a5432a]">
          <span>{error}</span>
          <button type="button" onClick={() => {
            setError("");
            setLoading(true);
            setReloadKey((key) => key + 1);
          }} className="shrink-0 font-semibold underline underline-offset-4">Reintentar</button>
        </div>
      )}

      <div className="mt-10 flex items-end justify-between border-b border-[#dce4dc] pb-4">
        <div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#a46d52]">Tu contenido</p><h2 className="mt-1 text-lg font-semibold tracking-tight text-[#263b31]">Todos los catálogos</h2></div>
        <span className="rounded-full bg-white px-3 py-1.5 text-xs font-medium tabular-nums text-[#66756b]">{catalogs.length} {catalogs.length === 1 ? "catálogo" : "catálogos"}</span>
      </div>

      {catalogs.length === 0 ? (
        <section className="mt-5 flex min-h-80 flex-col items-center justify-center rounded-3xl border border-dashed border-[#cbd7cc] bg-white/65 px-6 text-center">
          <span className="grid size-14 place-items-center rounded-2xl bg-[#e7f0e8] text-[#315e4f]"><CirclePlus className="size-6" aria-hidden="true" /></span>
          <h2 className="mt-5 text-xl font-semibold tracking-tight text-[#263b31]">Tu primer catálogo empieza aquí</h2>
          <p className="mt-2 max-w-sm text-sm leading-6 text-[#68756e]">Crea un espacio para tus productos y empieza a prepararlo para compartir.</p>
          <Link href="/dashboard/catalogos/nuevo" className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#245c4c] px-5 text-sm font-semibold text-white transition hover:bg-[#173f36]">Crear catálogo <ArrowUpRight className="size-4" aria-hidden="true" /></Link>
        </section>
      ) : (
        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {catalogs.map((catalog) => (
            <article key={catalog.id} className="group relative flex min-h-60 flex-col overflow-hidden rounded-2xl border border-[#e2e8e0] bg-white p-5 transition duration-200 hover:-translate-y-1 hover:border-[#a8c2af] hover:shadow-[0_20px_44px_-28px_rgba(31,55,44,0.45)]">
              <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#83b59a] via-[#d6bf92] to-[#d9947e] opacity-70 transition group-hover:opacity-100" />
              <div className="flex items-start justify-between gap-4">
                <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-[#edf3ec] text-sm font-bold text-[#315e4f]">
                  {catalog.name.trim().charAt(0).toUpperCase() || <Store className="size-4" />}
                </div>
                <button
                  type="button"
                  onClick={() => void removeCatalog(catalog)}
                  aria-label={`Eliminar ${catalog.name}`}
                  title="Eliminar catálogo"
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-[#87928b] transition hover:bg-[#fff1ec] hover:text-[#a5432a]"
                >
                  <Trash2 className="size-3.5" aria-hidden="true" /> Eliminar
                </button>
              </div>
              <p className="mt-5 text-[10px] font-bold uppercase tracking-[0.14em] text-[#a46d52]">Tienda en línea</p><h3 className="mt-1 text-lg font-semibold tracking-tight text-[#202b27]">{catalog.name}</h3>
              <p className="mt-1 line-clamp-2 min-h-10 text-sm leading-5 text-[#68756e]">{catalog.description || `/${catalog.slug}`}</p>
              <Link href={`/dashboard/catalogos/${catalog.id}`} className="mt-auto flex min-h-11 items-center justify-between border-t border-[#edf1ec] pt-3 text-sm font-semibold text-[#315e4f]">
                Abrir panel <ArrowUpRight className="size-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden="true" />
              </Link>
            </article>
          ))}
        </div>
      )}
    </main>
  );
}
