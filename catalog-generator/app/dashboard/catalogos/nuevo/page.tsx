"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { apiRequest, Catalog, slugify } from "@/lib/api";

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
    <main className="mx-auto w-full max-w-3xl px-5 py-10 sm:px-8 sm:py-14">
      <Link href="/" className="text-sm font-medium text-[#17665c] hover:text-[#10554c]">← Volver a catálogos</Link>
      <div className="mt-8 max-w-xl">
        <p className="text-xs font-semibold uppercase text-[#c65c3d]">Nuevo espacio</p>
        <h1 className="mt-2 text-3xl font-semibold text-[#202b27]">Crea un catálogo</h1>
        <p className="mt-2 text-sm leading-6 text-[#68756e]">Ponle nombre y una dirección corta. Después podrás organizar categorías y productos.</p>
      </div>

      <form onSubmit={submit} className="mt-8 space-y-5 rounded-lg border border-[#dce4dc] bg-white p-6 sm:p-8">
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
            className="mt-2 w-full rounded-md border border-[#d6dfd7] px-3.5 py-3 text-[#202b27] outline-none focus:border-[#17665c] focus:ring-2 focus:ring-[#17665c]/15"
          />
        </label>
        <label className="block text-sm font-medium text-[#37443d]">
          Dirección del catálogo
          <div className="mt-2 flex overflow-hidden rounded-md border border-[#d6dfd7] focus-within:border-[#17665c] focus-within:ring-2 focus-within:ring-[#17665c]/15">
            <span className="flex items-center border-r border-[#e5ebe4] bg-[#f7f9f6] px-3 text-sm text-[#849087]">/</span>
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
              className="min-w-0 flex-1 px-3.5 py-3 text-[#202b27] outline-none"
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
            className="mt-2 w-full resize-y rounded-md border border-[#d6dfd7] px-3.5 py-3 text-[#202b27] outline-none placeholder:text-[#a2aca5] focus:border-[#17665c] focus:ring-2 focus:ring-[#17665c]/15"
          />
        </label>
        {error && <p role="alert" className="rounded-md bg-[#fff1ec] px-3.5 py-3 text-sm text-[#a5432a]">{error}</p>}
        <div className="flex flex-col-reverse justify-end gap-3 border-t border-[#edf1ec] pt-5 sm:flex-row">
          <Link href="/" className="rounded-md px-4 py-3 text-center text-sm font-semibold text-[#68756e] hover:bg-[#f4f7f2]">Cancelar</Link>
          <button type="submit" disabled={busy} className="rounded-md bg-[#17665c] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#10554c] disabled:opacity-60">
            {busy ? "Creando..." : "Crear catálogo"}
          </button>
        </div>
      </form>
    </main>
  );
}