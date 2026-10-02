"use client";

import { FormEvent, useState } from "react";
import Image from "next/image";
import { ImagePlus, Trash2 } from "lucide-react";
import { apiRequest, Category, slugify } from "@/lib/api";

export default function CatalogCategories({
  catalogId,
  categories,
  onCreated,
}: {
  catalogId: string;
  categories: Category[];
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);

  async function uploadImage(categoryId: string, file: File) {
    const formData = new FormData();
    formData.append("image", file);
    await apiRequest(`/categories/${categoryId}/image`, { method: "POST", body: formData });
  }

  function readImage(file: File | undefined) {
    if (!file) return null;
    if (file.size > 5 * 1024 * 1024) {
      setError("La imagen de categoría supera el límite de 5 MB.");
      return null;
    }
    return file;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const categoryName = name.trim();
    const slug = slugify(categoryName);
    if (!slug) return;
    setBusy(true);
    setError("");
    try {
      const result = await apiRequest<{ category: Category }>(`/categories/catalog/${catalogId}`, {
        method: "POST",
        body: JSON.stringify({ name: categoryName, slug, position: categories.length }),
      });
      let imageError = "";
      if (imageFile) {
        try {
          await uploadImage(result.category.id, imageFile);
        } catch {
          imageError = "La categoría se creó, pero no se pudo subir su imagen.";
        }
      }
      setName("");
      setImageFile(null);
      onCreated();
      setError(imageError);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "No se pudo crear la categoría.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-lg border border-[#dce4dc] bg-white p-5 sm:p-6">
      <p className="text-xs font-semibold uppercase text-[#c65c3d]">Organización</p>
      <h2 className="mt-1 text-lg font-semibold text-[#202b27]">Categorías</h2>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {categories.length ? categories.map((category) => (
          <article key={category.id} className="min-w-0 border border-[#dce4dc] bg-white">
            <div className="relative aspect-[4/3] overflow-hidden bg-[#edf3ec]">
              {category.imageUrl ? <Image src={category.imageUrl} alt={category.name} fill unoptimized sizes="200px" className="object-cover" /> : <div className="absolute inset-0 grid place-items-center"><ImagePlus aria-hidden="true" size={22} className="text-[#789084]" /></div>}
            </div>
            <div className="flex items-center justify-between gap-2 px-2.5 py-2">
              <span className="min-w-0 truncate text-xs font-medium text-[#426257]">{category.name}</span>
              <label title={`Cambiar imagen de ${category.name}`} className="grid size-8 shrink-0 cursor-pointer place-items-center text-[#17665c] hover:bg-[#edf3ec]">
                <ImagePlus aria-hidden="true" size={16} />
                <input type="file" accept="image/jpeg,image/png,image/webp" aria-label={`Cambiar imagen de ${category.name}`} className="sr-only" onChange={async (event) => {
                  const file = readImage(event.target.files?.[0]);
                  event.target.value = "";
                  if (!file) return;
                  setError("");
                  try {
                    await uploadImage(category.id, file);
                    onCreated();
                  } catch (uploadError) {
                    setError(uploadError instanceof Error ? uploadError.message : "No se pudo subir la imagen.");
                  }
                }} />
              </label>
              {category.imageUrl && <button type="button" title={`Quitar imagen de ${category.name}`} aria-label={`Quitar imagen de ${category.name}`} onClick={async () => {
                setError("");
                try {
                  await apiRequest(`/categories/${category.id}/image`, { method: "DELETE" });
                  onCreated();
                } catch (deleteError) {
                  setError(deleteError instanceof Error ? deleteError.message : "No se pudo quitar la imagen.");
                }
              }} className="grid size-8 shrink-0 place-items-center text-[#a5432a] hover:bg-[#fff1ec]">
                <Trash2 aria-hidden="true" size={15} />
              </button>}
            </div>
          </article>
        )) : <p className="text-sm text-[#849087]">Todavía no hay categorías.</p>}
      </div>
      <form onSubmit={submit} className="mt-5 flex gap-2 border-t border-[#edf1ec] pt-4">
        <input required maxLength={100} value={name} onChange={(event) => setName(event.target.value)} placeholder="Nueva categoría" aria-label="Nombre de la nueva categoría" className="min-w-0 flex-1 rounded-md border border-[#d6dfd7] px-3 py-2.5 text-sm outline-none focus:border-[#17665c]" />
        <button type="submit" disabled={busy} className="rounded-md border border-[#bdd0c1] px-3 py-2.5 text-sm font-semibold text-[#17665c] transition hover:bg-[#edf3ec] disabled:opacity-60">Añadir</button>
      </form>
      <label className="mt-3 flex min-h-10 cursor-pointer items-center gap-2 text-xs font-medium text-[#52675b]">
        <ImagePlus aria-hidden="true" size={16} />
        {imageFile ? imageFile.name : "Imagen de categoría (opcional)"}
        <input type="file" accept="image/jpeg,image/png,image/webp" aria-label="Imagen para la nueva categoría" className="sr-only" onChange={(event) => setImageFile(readImage(event.target.files?.[0]))} />
      </label>
      {error && <p role="alert" className="mt-3 text-xs text-[#a5432a]">{error}</p>}
    </section>
  );
}
