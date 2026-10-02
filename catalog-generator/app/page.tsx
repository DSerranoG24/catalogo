"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { apiRequest, Catalog, clearSession, getSession } from "@/lib/api";

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
    return <main className="mx-auto w-full max-w-6xl px-6 py-16 text-sm text-[#68756e]">Cargando tus catálogos...</main>;
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-8 sm:py-14">
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-semibold uppercase text-[#c65c3d]">Espacio de trabajo</p>
          <h1 className="mt-2 text-3xl font-semibold text-[#202b27] sm:text-4xl">Tus catálogos</h1>
          <p className="mt-2 text-sm text-[#68756e]">Organiza productos, categorías e imágenes desde un solo lugar.</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              setError("");
              setLoading(true);
              setReloadKey((key) => key + 1);
            }}
            className="rounded-md border border-[#d6dfd7] bg-white px-4 py-2.5 text-sm font-medium text-[#435047] transition hover:bg-[#f7f9f6]"
          >
            Actualizar
          </button>
          <Link
            href="/dashboard/catalogos/nuevo"
            className="rounded-md bg-[#17665c] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#10554c]"
          >
            Nuevo catálogo
          </Link>
        </div>
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

      <div className="mt-9 flex items-center justify-between border-b border-[#dce4dc] pb-3">
        <h2 className="text-sm font-semibold text-[#37443d]">Todos los catálogos</h2>
        <span className="text-xs tabular-nums text-[#849087]">{catalogs.length} {catalogs.length === 1 ? "catálogo" : "catálogos"}</span>
      </div>

      {catalogs.length === 0 ? (
        <section className="mt-8 flex min-h-72 flex-col items-center justify-center rounded-lg border border-dashed border-[#cbd7cc] bg-white/70 px-6 text-center">
          <span className="grid size-12 place-items-center rounded-lg bg-[#e8f0e8] text-2xl font-light text-[#17665c]">+</span>
          <h2 className="mt-5 text-lg font-semibold text-[#202b27]">Tu primer catálogo empieza aquí</h2>
          <p className="mt-2 max-w-sm text-sm leading-6 text-[#68756e]">Crea un espacio para tus productos y empieza a prepararlo para compartir.</p>
          <Link href="/dashboard/catalogos/nuevo" className="mt-5 rounded-md bg-[#17665c] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#10554c]">Crear catálogo</Link>
        </section>
      ) : (
        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {catalogs.map((catalog) => (
            <article key={catalog.id} className="group flex min-h-52 flex-col rounded-lg border border-[#dce4dc] bg-white p-5 transition hover:-translate-y-0.5 hover:border-[#9fb9a9] hover:shadow-[0_14px_35px_-27px_rgba(31,55,44,0.55)]">
              <div className="flex items-start justify-between gap-4">
                <div className="grid size-10 shrink-0 place-items-center rounded-md bg-[#e6efe7] text-sm font-bold text-[#17665c]">
                  {catalog.name.trim().charAt(0).toUpperCase()}
                </div>
                <button
                  type="button"
                  onClick={() => void removeCatalog(catalog)}
                  aria-label={`Eliminar ${catalog.name}`}
                  title="Eliminar catálogo"
                  className="rounded-md px-2 py-1 text-sm text-[#87928b] transition hover:bg-[#fff1ec] hover:text-[#a5432a]"
                >
                  Eliminar
                </button>
              </div>
              <h3 className="mt-5 text-lg font-semibold text-[#202b27]">{catalog.name}</h3>
              <p className="mt-1 line-clamp-2 min-h-10 text-sm leading-5 text-[#68756e]">{catalog.description || `/${catalog.slug}`}</p>
              <Link href={`/dashboard/catalogos/${catalog.id}`} className="mt-auto flex items-center justify-between border-t border-[#edf1ec] pt-4 text-sm font-semibold text-[#17665c]">
                Administrar productos <span aria-hidden="true">→</span>
              </Link>
            </article>
          ))}
        </div>
      )}
    </main>
  );
}