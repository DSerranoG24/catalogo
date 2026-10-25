"use client";

import { FormEvent, useMemo, useState } from "react";
import { Category, Product } from "@/lib/api";

export type ProductFormState = {
  name: string;
  brand: string;
  model: string;
  sku: string;
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
  products,
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
  products: Product[];
  editing: boolean;
  imageFile: File | null;
  saving: boolean;
  onChange: (field: keyof ProductFormState, value: string | boolean) => void;
  onImageChange: (file: File | null) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
}) {
  const [sourceQuery, setSourceQuery] = useState("");
  const [barcodeQuery, setBarcodeQuery] = useState("");
  const [barcodeLoading, setBarcodeLoading] = useState(false);
  const [barcodeMessage, setBarcodeMessage] = useState("");
  const matches = useMemo(() => {
    const query = sourceQuery.trim().toLocaleLowerCase();
    if (!query || query.length < 2) return [];
    return products
      .map((product) => {
        const fields = [product.name, product.brand, product.model, product.sku].filter(Boolean).map((item) => item!.toLocaleLowerCase());
        const exactCode = Boolean(product.sku && product.sku.toLocaleLowerCase() === query);
        const exactName = product.name.toLocaleLowerCase() === query;
        const score = exactCode ? 0 : exactName ? 1 : fields.some((field) => field.startsWith(query)) ? 2 : fields.some((field) => field.includes(query)) ? 3 : 99;
        return { product, score };
      })
      .filter(({ score }) => score < 99)
      .sort((a, b) => a.score - b.score || a.product.name.localeCompare(b.product.name))
      .slice(0, 5)
      .map(({ product }) => product);
  }, [products, sourceQuery]);

  function applyProduct(product: Product) {
    onChange("name", product.name);
    onChange("brand", product.brand ?? "");
    onChange("model", product.model ?? "");
    onChange("categoryId", product.categoryId ?? "");
    onChange("description", product.description ?? "");
    setSourceQuery("");
  }

  async function lookupBarcode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBarcodeMessage("");
    setBarcodeLoading(true);
    try {
      const response = await fetch(`/api/product-lookup?code=${encodeURIComponent(barcodeQuery.trim())}`, {
        credentials: "same-origin",
        cache: "no-store",
        signal: AbortSignal.timeout(12_000),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.message ?? "No se pudo consultar el código.");
      const product = result?.product as { name?: string; brand?: string; model?: string; description?: string; code?: string } | undefined;
      if (!product?.name) throw new Error("El código no tiene un nombre de producto disponible.");
      onChange("name", product.name);
      onChange("brand", product.brand ?? "");
      onChange("model", product.model ?? "");
      onChange("description", product.description ?? "");
      onChange("sku", product.code ?? barcodeQuery.trim());
      setBarcodeMessage("Datos encontrados. Revísalos y completa manualmente el precio, inventario y categoría.");
    } catch (error) {
      setBarcodeMessage(error instanceof Error ? error.message : "No se pudo consultar el código.");
    } finally {
      setBarcodeLoading(false);
    }
  }

  return (
    <section className="rounded-3xl border border-[#e2e8e0] bg-white p-5 shadow-[0_16px_44px_-38px_rgba(36,63,47,0.35)] sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--brand-coral-text)]">{editing ? "Edición" : "Inventario"}</p>
          <h2 className="mt-1 text-lg font-semibold tracking-tight text-[#202b27]">{editing ? "Actualizar producto" : "Añadir producto"}</h2>
        </div>
        {editing && <button type="button" onClick={onCancel} className="text-sm font-medium text-[#68756e] hover:text-[#202b27]">Cancelar</button>}
      </div>
      {!editing && <div className="mt-5 space-y-4 rounded-2xl border border-[#dce8dc] bg-[#f7faf6] p-4">
        <form onSubmit={lookupBarcode}>
          <label htmlFor="product-barcode-search" className="block text-sm font-semibold text-[#37443d]">Buscar por código de barras</label>
          <p className="mt-1 text-xs leading-5 text-[#718076]">Consulta códigos EAN, UPC o GTIN para sugerir nombre y descripción.</p>
          <div className="mt-3 flex gap-2">
            <input id="product-barcode-search" inputMode="numeric" autoComplete="off" value={barcodeQuery} onChange={(event) => setBarcodeQuery(event.target.value.replace(/\D/g, "").slice(0, 14))} placeholder="Ej. 7701234567890" className="min-h-10 min-w-0 flex-1 rounded-xl border border-[#d6dfd7] bg-white px-3.5 py-2 outline-none focus:border-[#5a886c] focus:ring-4 focus:ring-[#5a886c]/10" />
            <button type="submit" disabled={barcodeLoading || !/^\d{8,14}$/.test(barcodeQuery)} className="shrink-0 rounded-xl bg-[var(--brand-emerald)] px-3.5 text-xs font-semibold text-white transition hover:bg-[var(--brand-emerald)] disabled:cursor-not-allowed disabled:opacity-50">{barcodeLoading ? "Buscando…" : "Buscar código"}</button>
          </div>
          {barcodeMessage && <p role="status" className="mt-2 text-xs leading-5 text-[#52725e]">{barcodeMessage}</p>}
          <p className="mt-2 text-[11px] leading-4 text-[#849087]">La consulta usa un servicio externo gratuito con límite de solicitudes. Verifica los datos antes de guardar; los precios e inventario nunca se importan.</p>
        </form>
        <div className="border-t border-[#dce8dc] pt-4">
        <label htmlFor="product-source-search" className="block text-sm font-semibold text-[#37443d]">Completar desde un producto del catálogo</label>
        <p className="mt-1 text-xs leading-5 text-[#718076]">Busca por nombre, marca, modelo o código. Se copiarán solo los datos descriptivos.</p>
        <input id="product-source-search" type="search" value={sourceQuery} onChange={(event) => setSourceQuery(event.target.value)} placeholder="Ej. audífonos, Acme o ABC-123" autoComplete="off" className="mt-3 min-h-10 w-full rounded-xl border border-[#d6dfd7] bg-white px-3.5 py-2 outline-none focus:border-[#5a886c] focus:ring-4 focus:ring-[#5a886c]/10" />
        {sourceQuery.trim().length >= 2 && <div className="mt-2 space-y-1" aria-live="polite">
          {matches.length ? matches.map((product) => <button key={product.id} type="button" onClick={() => applyProduct(product)} className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm transition hover:bg-[var(--brand-emerald-soft)]"><span className="min-w-0"><span className="block truncate font-medium text-[#263b31]">{product.name}</span><span className="block truncate text-xs text-[#718076]">{[product.brand, product.model, product.sku].filter(Boolean).join(" · ") || "Sin marca, modelo ni código"}</span></span><span className="shrink-0 text-xs font-semibold text-[var(--brand-emerald)]">Usar datos</span></button>) : <p className="px-3 py-2 text-xs text-[#718076]">No hay coincidencias en este catálogo.</p>}
        </div>}
        </div>
      </div>}
      <form onSubmit={onSubmit} className="mt-5 space-y-4">
        <label className="block text-sm font-medium text-[#37443d]">
          Nombre
          <input required maxLength={150} value={value.name} onChange={(event) => onChange("name", event.target.value)} placeholder="Ej. Lámpara de mesa" className="mt-2 min-h-11 w-full rounded-xl border border-[#d6dfd7] bg-[#fcfdfb] px-3.5 py-2.5 outline-none transition focus:border-[#5a886c] focus:bg-white focus:ring-4 focus:ring-[#5a886c]/10" />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-medium text-[#37443d]">Marca <span className="font-normal text-[#849087]">(opcional)</span><input maxLength={100} value={value.brand} onChange={(event) => onChange("brand", event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-[#d6dfd7] bg-[#fcfdfb] px-3.5 py-2.5 outline-none focus:border-[#5a886c] focus:ring-4 focus:ring-[#5a886c]/10" /></label>
          <label className="block text-sm font-medium text-[#37443d]">Modelo <span className="font-normal text-[#849087]">(opcional)</span><input maxLength={100} value={value.model} onChange={(event) => onChange("model", event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-[#d6dfd7] bg-[#fcfdfb] px-3.5 py-2.5 outline-none focus:border-[#5a886c] focus:ring-4 focus:ring-[#5a886c]/10" /></label>
        </div>
        <label className="block text-sm font-medium text-[#37443d]">Código/SKU <span className="font-normal text-[#849087]">(opcional)</span><input maxLength={100} value={value.sku} onChange={(event) => onChange("sku", event.target.value)} placeholder="Código único de este producto" className="mt-2 min-h-11 w-full rounded-xl border border-[#d6dfd7] bg-[#fcfdfb] px-3.5 py-2.5 outline-none focus:border-[#5a886c] focus:ring-4 focus:ring-[#5a886c]/10" /></label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-medium text-[#37443d]">
            Precio
            <input required type="number" min="0" step="1" value={value.price} onChange={(event) => onChange("price", event.target.value)} placeholder="25000" className="mt-2 min-h-11 w-full rounded-xl border border-[#d6dfd7] bg-[#fcfdfb] px-3.5 py-2.5 outline-none transition focus:border-[#5a886c] focus:bg-white focus:ring-4 focus:ring-[#5a886c]/10" />
          </label>
          <label className="block text-sm font-medium text-[#37443d]">
            Inventario
            <input required type="number" min="0" step="1" value={value.stock} onChange={(event) => onChange("stock", event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-[#d6dfd7] bg-[#fcfdfb] px-3.5 py-2.5 outline-none transition focus:border-[#5a886c] focus:bg-white focus:ring-4 focus:ring-[#5a886c]/10" />
          </label>
        </div>
        <fieldset className="rounded-2xl border border-[#ead2ce] bg-[#fff8f6] p-4">
          <label className="flex min-h-8 items-center gap-3 text-sm font-semibold text-[#9f2828]">
            <input type="checkbox" checked={value.saleEnabled} onChange={(event) => onChange("saleEnabled", event.target.checked)} className="size-4 accent-[#c62828]" />
            Programar descuento
          </label>
          {value.saleEnabled && (
            <div className="mt-4 space-y-4 border-t border-[#f0d9d4] pt-4">
              <label className="block text-sm font-medium text-[#37443d]">
                Precio de oferta
                <input required type="number" min="0" max={value.price || undefined} step="1" value={value.salePrice} onChange={(event) => onChange("salePrice", event.target.value)} placeholder="18000" className="mt-2 min-h-11 w-full rounded-xl border border-[#e3c5c0] bg-white px-3.5 py-2.5 outline-none focus:border-[#c62828] focus:ring-2 focus:ring-[#c62828]/10" />
                <span className="mt-1.5 block text-xs font-normal text-[#7d6a66]">Debe ser menor al precio normal de ${Number(value.price || 0).toLocaleString("es-CO")}.</span>
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-sm font-medium text-[#37443d]">
                  Válido desde
                  <input required type="datetime-local" value={value.saleStartsAt} onChange={(event) => onChange("saleStartsAt", event.target.value)} className="mt-2 min-h-11 w-full min-w-0 rounded-xl border border-[#e3c5c0] bg-white px-2.5 py-2.5 text-sm outline-none focus:border-[#c62828]" />
                </label>
                <label className="block text-sm font-medium text-[#37443d]">
                  Válido hasta
                  <input required type="datetime-local" value={value.saleEndsAt} onChange={(event) => onChange("saleEndsAt", event.target.value)} className="mt-2 min-h-11 w-full min-w-0 rounded-xl border border-[#e3c5c0] bg-white px-2.5 py-2.5 text-sm outline-none focus:border-[#c62828]" />
                </label>
              </div>
              <p className="text-xs leading-5 text-[#7d6a66]">La etiqueta roja y el precio tachado solo se verán durante este periodo.</p>
            </div>
          )}
        </fieldset>
        <label className="block text-sm font-medium text-[#37443d]">
          Categoría
          <select value={value.categoryId} onChange={(event) => onChange("categoryId", event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-[#d6dfd7] bg-[#fcfdfb] px-3.5 py-2.5 outline-none focus:border-[#5a886c] focus:ring-4 focus:ring-[#5a886c]/10">
            <option value="">Sin categoría</option>
            {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
          </select>
        </label>
        <label className="block text-sm font-medium text-[#37443d]">
          Descripción <span className="font-normal text-[#849087]">(opcional)</span>
          <textarea maxLength={2000} rows={3} value={value.description} onChange={(event) => onChange("description", event.target.value)} className="mt-2 w-full resize-y rounded-xl border border-[#d6dfd7] bg-[#fcfdfb] px-3.5 py-2.5 outline-none focus:border-[#5a886c] focus:bg-white focus:ring-4 focus:ring-[#5a886c]/10" />
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
          }} className="mt-2 block w-full text-sm text-[#68756e] file:mr-3 file:rounded-md file:border-0 file:bg-[#e8f0e8] file:px-3 file:py-2 file:text-xs file:font-semibold file:text-[var(--brand-emerald)]" />
          {imageFile && <span className="mt-1 block text-xs font-normal text-[var(--brand-emerald)]">{imageFile.name}</span>}
        </label>
        <button type="submit" disabled={saving} className="w-full rounded-md bg-[var(--brand-emerald)] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[var(--brand-emerald-hover)] disabled:cursor-wait disabled:opacity-60">
          {saving ? "Guardando..." : editing ? "Guardar cambios" : "Guardar producto"}
        </button>
      </form>
    </section>
  );
}
