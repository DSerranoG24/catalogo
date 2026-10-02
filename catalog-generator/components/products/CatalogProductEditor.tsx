"use client";

import { FormEvent } from "react";
import { Category } from "@/lib/api";

export type ProductFormState = {
  name: string;
  price: string;
  saleEnabled: boolean;
  salePrice: string;
  saleStartsAt: string;
  saleEndsAt: string;
  stock: string;
  categoryId: string;
  description: string;
};

export default function CatalogProductEditor({
  value,
  categories,
  editing,
  imageFile,
  saving,
  onChange,
  onImageChange,
  onSubmit,
  onCancel,
}: {
  value: ProductFormState;
  categories: Category[];
  editing: boolean;
  imageFile: File | null;
  saving: boolean;
  onChange: (field: keyof ProductFormState, value: string | boolean) => void;
  onImageChange: (file: File | null) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
}) {
  return (
    <section className="rounded-lg border border-[#dce4dc] bg-white p-5 sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase text-[#c65c3d]">{editing ? "Edición" : "Producto"}</p>
          <h2 className="mt-1 text-lg font-semibold text-[#202b27]">{editing ? "Actualizar producto" : "Añadir producto"}</h2>
        </div>
        {editing && <button type="button" onClick={onCancel} className="text-sm font-medium text-[#68756e] hover:text-[#202b27]">Cancelar</button>}
      </div>
      <form onSubmit={onSubmit} className="mt-5 space-y-4">
        <label className="block text-sm font-medium text-[#37443d]">
          Nombre
          <input required maxLength={150} value={value.name} onChange={(event) => onChange("name", event.target.value)} placeholder="Ej. Lámpara de mesa" className="mt-2 w-full rounded-md border border-[#d6dfd7] px-3.5 py-2.5 outline-none focus:border-[#17665c] focus:ring-2 focus:ring-[#17665c]/15" />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-medium text-[#37443d]">
            Precio
            <input required type="number" min="0" step="1" value={value.price} onChange={(event) => onChange("price", event.target.value)} placeholder="25000" className="mt-2 w-full rounded-md border border-[#d6dfd7] px-3.5 py-2.5 outline-none focus:border-[#17665c] focus:ring-2 focus:ring-[#17665c]/15" />
          </label>
          <label className="block text-sm font-medium text-[#37443d]">
            Inventario
            <input required type="number" min="0" step="1" value={value.stock} onChange={(event) => onChange("stock", event.target.value)} className="mt-2 w-full rounded-md border border-[#d6dfd7] px-3.5 py-2.5 outline-none focus:border-[#17665c] focus:ring-2 focus:ring-[#17665c]/15" />
          </label>
        </div>
        <fieldset className="border border-[#ead2ce] bg-[#fff8f6] p-4">
          <label className="flex min-h-8 items-center gap-3 text-sm font-semibold text-[#9f2828]">
            <input type="checkbox" checked={value.saleEnabled} onChange={(event) => onChange("saleEnabled", event.target.checked)} className="size-4 accent-[#c62828]" />
            Programar descuento
          </label>
          {value.saleEnabled && (
            <div className="mt-4 space-y-4 border-t border-[#f0d9d4] pt-4">
              <label className="block text-sm font-medium text-[#37443d]">
                Precio de oferta
                <input required type="number" min="0" max={value.price || undefined} step="1" value={value.salePrice} onChange={(event) => onChange("salePrice", event.target.value)} placeholder="18000" className="mt-2 w-full border border-[#e3c5c0] bg-white px-3.5 py-2.5 outline-none focus:border-[#c62828] focus:ring-2 focus:ring-[#c62828]/10" />
                <span className="mt-1.5 block text-xs font-normal text-[#7d6a66]">Debe ser menor al precio normal de ${Number(value.price || 0).toLocaleString("es-CO")}.</span>
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-sm font-medium text-[#37443d]">
                  Válido desde
                  <input required type="datetime-local" value={value.saleStartsAt} onChange={(event) => onChange("saleStartsAt", event.target.value)} className="mt-2 w-full min-w-0 border border-[#e3c5c0] bg-white px-2.5 py-2.5 text-sm outline-none focus:border-[#c62828]" />
                </label>
                <label className="block text-sm font-medium text-[#37443d]">
                  Válido hasta
                  <input required type="datetime-local" value={value.saleEndsAt} onChange={(event) => onChange("saleEndsAt", event.target.value)} className="mt-2 w-full min-w-0 border border-[#e3c5c0] bg-white px-2.5 py-2.5 text-sm outline-none focus:border-[#c62828]" />
                </label>
              </div>
              <p className="text-xs leading-5 text-[#7d6a66]">La etiqueta roja y el precio tachado solo se verán durante este periodo.</p>
            </div>
          )}
        </fieldset>
        <label className="block text-sm font-medium text-[#37443d]">
          Categoría
          <select value={value.categoryId} onChange={(event) => onChange("categoryId", event.target.value)} className="mt-2 w-full rounded-md border border-[#d6dfd7] bg-white px-3.5 py-2.5 outline-none focus:border-[#17665c] focus:ring-2 focus:ring-[#17665c]/15">
            <option value="">Sin categoría</option>
            {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
          </select>
        </label>
        <label className="block text-sm font-medium text-[#37443d]">
          Descripción <span className="font-normal text-[#849087]">(opcional)</span>
          <textarea maxLength={2000} rows={3} value={value.description} onChange={(event) => onChange("description", event.target.value)} className="mt-2 w-full resize-y rounded-md border border-[#d6dfd7] px-3.5 py-2.5 outline-none focus:border-[#17665c] focus:ring-2 focus:ring-[#17665c]/15" />
        </label>
        <label className="block text-sm font-medium text-[#37443d]">
          Imagen <span className="font-normal text-[#849087]">(JPG, PNG o WebP; máximo 5 MB)</span>
          <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => {
            const file = event.target.files?.[0] ?? null;
            if (file && file.size > 5 * 1024 * 1024) {
              event.target.value = "";
              onImageChange(null);
              return;
            }
            onImageChange(file);
          }} className="mt-2 block w-full text-sm text-[#68756e] file:mr-3 file:rounded-md file:border-0 file:bg-[#e8f0e8] file:px-3 file:py-2 file:text-xs file:font-semibold file:text-[#17665c]" />
          {imageFile && <span className="mt-1 block text-xs font-normal text-[#17665c]">{imageFile.name}</span>}
        </label>
        <button type="submit" disabled={saving} className="w-full rounded-md bg-[#17665c] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#10554c] disabled:cursor-wait disabled:opacity-60">
          {saving ? "Guardando..." : editing ? "Guardar cambios" : "Guardar producto"}
        </button>
      </form>
    </section>
  );
}
