"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { apiRequest, Catalog, slugify } from "@/lib/api";
import { ArrowLeft, ArrowRight, Check, CircleHelp, PackagePlus, Sparkles, Store } from "lucide-react";

export default function NuevoCatalogo() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const result = await apiRequest<{ catalog: Catalog }>("/catalogs", {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), slug: slugify(slug), description: description.trim() || undefined }),
      });
      router.push(`/dashboard/catalogos/${result.catalog.id}`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "No se pudo crear el catálogo.");
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-8 sm:py-12">
      <Link href="/" className="inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-[#52675c] transition hover:text-[#173f36]"><ArrowLeft className="size-4" aria-hidden="true" /> Volver a catálogos</Link>
      <div className="mt-7 grid items-start gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)] lg:gap-10">
      <div>
        <div className="inline-flex items-center gap-2 rounded-full border border-[#dce7dc] bg-white/70 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-[#597565]"><Sparkles className="size-3.5" aria-hidden="true" /> Nuevo espacio</div>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight text-[#202b27] sm:text-4xl">Crea tu catálogo <span className="font-serif font-normal italic text-[#62816d]">en minutos.</span></h1>
        <p className="mt-3 max-w-xl text-sm leading-6 text-[#68756e]">Empieza con la identidad de tu tienda. Luego podrás elegir un diseño, subir tu logo y organizar el inventario.</p>

        <div className="mt-7 flex items-center gap-3 rounded-2xl border border-[#dce7dc] bg-[#edf3eb] p-4">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-white text-[#3f745a]"><span className="text-sm font-bold">1</span></span>
          <div className="min-w-0 flex-1"><p className="text-xs font-bold uppercase tracking-[0.1em] text-[#496856]">Paso 1 de 2</p><p className="mt-0.5 text-sm font-semibold text-[#263b31]">Datos básicos del catálogo</p></div>
          <div className="hidden h-1.5 w-24 overflow-hidden rounded-full bg-white sm:block"><div className="h-full w-1/2 rounded-full bg-[#5b896e]" /></div>
        </div>

      <form onSubmit={submit} className="mt-5 space-y-5 rounded-3xl border border-[#e1e8e0] bg-white p-5 shadow-[0_22px_60px_-45px_rgba(36,63,47,0.38)] sm:p-8">
        <div className="flex items-center gap-3 border-b border-[#edf1ec] pb-4"><span className="grid size-10 place-items-center rounded-xl bg-[#eaf2e9] text-[#315e4f]"><Store className="size-4" aria-hidden="true" /></span><div><h2 className="text-sm font-semibold text-[#263b31]">Identidad de tu tienda</h2><p className="mt-0.5 text-xs text-[#829087]">Puedes cambiar estos datos después.</p></div></div>
        <label className="block text-sm font-medium text-[#37443d]">
          Nombre del catálogo
          <input
            required
            maxLength={100}
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              if (!slugEdited) setSlug(slugify(event.target.value));
            }}
            placeholder="Colección de temporada"
            className="mt-2 min-h-12 w-full rounded-xl border border-[#d9e2d9] bg-[#fcfdfb] px-4 py-3 text-[#202b27] outline-none transition placeholder:text-[#a2aca5] focus:border-[#5a886c] focus:bg-white focus:ring-4 focus:ring-[#5a886c]/10"
          />
        </label>
        <label className="block text-sm font-medium text-[#37443d]">
          Dirección del catálogo
          <div className="mt-2 flex min-h-12 overflow-hidden rounded-xl border border-[#d9e2d9] bg-[#fcfdfb] transition focus-within:border-[#5a886c] focus-within:bg-white focus-within:ring-4 focus-within:ring-[#5a886c]/10">
            <span className="flex items-center border-r border-[#e5ebe4] bg-[#f3f6f1] px-4 text-sm text-[#849087]">/</span>
            <input
              required
              maxLength={100}
              pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
              value={slug}
              onChange={(event) => {
                setSlug(slugify(event.target.value));
                setSlugEdited(true);
              }}
              placeholder="coleccion-de-temporada"
              className="min-w-0 flex-1 bg-transparent px-4 py-3 text-[#202b27] outline-none"
            />
          </div>
          <span className="mt-1.5 block text-xs font-normal text-[#849087]">Solo minúsculas, números y guiones.</span>
        </label>
        <label className="block text-sm font-medium text-[#37443d]">
          Descripción <span className="font-normal text-[#849087]">(opcional)</span>
          <textarea
            maxLength={500}
            rows={4}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="¿Qué encontrarán las personas en este catálogo?"
            className="mt-2 w-full resize-y rounded-xl border border-[#d9e2d9] bg-[#fcfdfb] px-4 py-3 text-[#202b27] outline-none placeholder:text-[#a2aca5] transition focus:border-[#5a886c] focus:bg-white focus:ring-4 focus:ring-[#5a886c]/10"
          />
        </label>
        {error && <p role="alert" className="rounded-md bg-[#fff1ec] px-3.5 py-3 text-sm text-[#a5432a]">{error}</p>}
        <div className="flex flex-col-reverse justify-end gap-3 border-t border-[#edf1ec] pt-5 sm:flex-row">
          <Link href="/" className="inline-flex min-h-12 items-center justify-center rounded-xl px-5 text-sm font-semibold text-[#68756e] transition hover:bg-[#f4f7f2]">Cancelar</Link>
          <button type="submit" disabled={busy} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#245c4c] px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#173f36] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5a886c]/20 disabled:cursor-wait disabled:opacity-60">
            {busy ? "Creando..." : <>Crear catálogo <ArrowRight className="size-4" aria-hidden="true" /></>}
          </button>
        </div>
      </form>
      </div>
      <aside className="overflow-hidden rounded-3xl border border-[#e1e8e0] bg-white shadow-[0_22px_60px_-45px_rgba(36,63,47,0.38)] lg:sticky lg:top-8">
        <div className="flex items-center justify-between border-b border-[#edf1ec] px-5 py-4"><div className="flex items-center gap-2 text-xs font-semibold text-[#53645a]"><span className="size-2 rounded-full bg-[#71a783]" /> Vista previa</div><span className="rounded-full bg-[#f2f5ef] px-2.5 py-1 text-[10px] font-medium text-[#7e8b81]">Tu tienda</span></div>
        <div className="bg-[#f3f5ef] p-5 sm:p-6">
          <div className="overflow-hidden rounded-2xl border border-[#e5e8df] bg-white shadow-sm">
            <div className="flex items-center gap-1.5 border-b border-[#eef0eb] px-3 py-2"><span className="size-1.5 rounded-full bg-[#edb6a6]" /><span className="size-1.5 rounded-full bg-[#e9d79c]" /><span className="size-1.5 rounded-full bg-[#b8d1bd]" /><span className="ml-2 h-2 w-1/2 rounded-full bg-[#f0f2ed]" /></div>
            <div className="p-5"><div className="flex items-center gap-2 border-b border-[#edf1ec] pb-3"><span className="grid size-8 place-items-center rounded-lg bg-[#edf3ec] text-[#315e4f]"><Store className="size-4" /></span><span className="truncate text-sm font-semibold text-[#263b31]">{name.trim() || "Nombre de tu tienda"}</span></div><div className="py-7 text-center"><span className="mx-auto grid size-10 place-items-center rounded-full bg-[#edf3ec] text-[#557a62]"><PackagePlus className="size-5" /></span><div className="mx-auto mt-3 h-3 w-2/3 rounded-full bg-[#dce5dc]" /><div className="mx-auto mt-2 h-2 w-1/2 rounded-full bg-[#edf1ec]" /><div className="mx-auto mt-4 h-8 w-28 rounded-full bg-[#245c4c]" /></div><div className="border-t border-[#edf1ec] pt-3 text-[10px] text-[#89958b]">{slug ? "Tu enlace seguro estará listo al crear la tienda" : "Tu enlace aparecerá aquí"}</div></div>
          </div>
          <div className="mt-4 flex items-start gap-2 rounded-xl bg-white/75 p-3 text-xs leading-5 text-[#68756e]"><CircleHelp className="mt-0.5 size-4 shrink-0 text-[#73917c]" aria-hidden="true" /><p>El nombre y la dirección son visibles para tus clientes. La descripción ayuda a presentar tu negocio.</p></div>
        </div>
        <div className="space-y-3 px-5 py-5"><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#a46d52]">Después podrás</p><p className="flex items-center gap-2 text-xs text-[#526157]"><Check className="size-4 text-[#508260]" /> Elegir entre tres estilos de tienda</p><p className="flex items-center gap-2 text-xs text-[#526157]"><Check className="size-4 text-[#508260]" /> Añadir productos y categorías</p><p className="flex items-center gap-2 text-xs text-[#526157]"><Check className="size-4 text-[#508260]" /> Compartir tu catálogo por enlace</p></div>
      </aside>
      </div>
    </main>
  );
}
