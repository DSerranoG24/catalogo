"use client";

import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Input";
import uiStyles from "@/components/ui/ui.module.css";

import { FormEvent, useEffect, useState } from "react";
import { apiRequest, Category, ProductSuggestion } from "@/lib/api";

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
  catalogId,
  suggestionsDisabled,
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
  catalogId: string;
  suggestionsDisabled: boolean;
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
  const [suggestions, setSuggestions] = useState<{ query: string; products: ProductSuggestion[]; error: string }>({ query: "", products: [], error: "" });
  const sourceTerm = sourceQuery.trim();
  useEffect(() => {
    if (sourceTerm.length < 2 || editing || suggestionsDisabled) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const result = await apiRequest<{ products: ProductSuggestion[] }>(`/products/catalog/${catalogId}/suggestions?q=${encodeURIComponent(sourceTerm)}`, { signal: controller.signal });
        if (!controller.signal.aborted) setSuggestions({ query: sourceTerm, products: result.products, error: "" });
      } catch (error) {
        if (!controller.signal.aborted) setSuggestions({ query: sourceTerm, products: [], error: error instanceof Error ? error.message : "No se pudieron consultar las sugerencias." });
      }
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [catalogId, sourceTerm, editing, suggestionsDisabled]);
  const matches = suggestions.query === sourceTerm ? suggestions.products : [];

  function applyProduct(product: ProductSuggestion) {
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
        {editing && <Button variant="ghost" type="button" onClick={onCancel} >Cancelar</Button>}
      </div>
      {!editing && <div className="mt-5 space-y-4 rounded-2xl border border-[#dce8dc] bg-[#f7faf6] p-4">
        <form onSubmit={lookupBarcode}>
          <label htmlFor="product-barcode-search" className="block text-sm font-semibold text-[#37443d]">Buscar por código de barras</label>
          <p className="mt-1 text-xs leading-5 text-[#718076]">Consulta códigos EAN, UPC o GTIN para sugerir nombre y descripción.</p>
          <div className="mt-3 flex gap-2">
            <Input id="product-barcode-search" inputMode="numeric" autoComplete="off" value={barcodeQuery} onChange={(event) => setBarcodeQuery(event.target.value.replace(/\D/g, "").slice(0, 14))} placeholder="Ej. 7701234567890" className="min-w-0 flex-1" />
            <Button variant="primary" type="submit" disabled={barcodeLoading || !/^\d{8,14}$/.test(barcodeQuery)} className="shrink-0">{barcodeLoading ? "Buscando…" : "Buscar código"}</Button>
          </div>
          {barcodeMessage && <p role="status" className="mt-2 text-xs leading-5 text-[#52725e]">{barcodeMessage}</p>}
          <p className="mt-2 text-[11px] leading-4 text-[#849087]">La consulta usa un servicio externo gratuito con límite de solicitudes. Verifica los datos antes de guardar; los precios e inventario nunca se importan.</p>
        </form>
        <div className="border-t border-[#dce8dc] pt-4">
        <label htmlFor="product-source-search" className="block text-sm font-semibold text-[#37443d]">Completar desde un producto del catálogo</label>
        <p className="mt-1 text-xs leading-5 text-[#718076]">Busca por nombre, marca, modelo o código. Se copiarán solo los datos descriptivos.</p>
        <Input id="product-source-search" type="search" maxLength={150} value={sourceQuery} onChange={(event) => setSourceQuery(event.target.value)} placeholder="Ej. audífonos, Acme o ABC-123" autoComplete="off" className="mt-3 w-full" />
        {sourceQuery.trim().length >= 2 && <div className="mt-2 space-y-1" aria-live="polite">
          {suggestions.query !== sourceTerm ? <p role="status" className="text-xs text-[#52655a]">Buscando productos…</p> : suggestions.error ? <p role="alert" className="text-xs text-[#a5432a]">{suggestions.error}</p> : matches.length ? matches.map((product) => <Button variant="ghost" key={product.id} type="button" onClick={() => applyProduct(product)} className={uiStyles.suggestion}><span className="min-w-0"><span className="block truncate font-medium text-[#263b31]">{product.name}</span><span className="block truncate text-xs text-[#718076]">{[product.brand, product.model, product.sku].filter(Boolean).join(" · ") || "Sin marca, modelo ni código"}</span></span><span className="shrink-0 text-xs font-semibold text-[var(--brand-emerald)]">Usar datos</span></Button>) : <p className="px-3 py-2 text-xs text-[#718076]">No hay coincidencias en este catálogo.</p>}
        </div>}
        </div>
      </div>}
      <form onSubmit={onSubmit} className="mt-5 space-y-4">
        <label className="block text-sm font-medium text-[#37443d]">
          Nombre
          <Input required maxLength={150} value={value.name} onChange={(event) => onChange("name", event.target.value)} placeholder="Ej. Lámpara de mesa" className="mt-2 w-full" />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-medium text-[#37443d]">Marca <span className="font-normal text-[#849087]">(opcional)</span><Input maxLength={100} value={value.brand} onChange={(event) => onChange("brand", event.target.value)} className="mt-2 w-full" /></label>
          <label className="block text-sm font-medium text-[#37443d]">Modelo <span className="font-normal text-[#849087]">(opcional)</span><Input maxLength={100} value={value.model} onChange={(event) => onChange("model", event.target.value)} className="mt-2 w-full" /></label>
        </div>
        <label className="block text-sm font-medium text-[#37443d]">Código/SKU <span className="font-normal text-[#849087]">(opcional)</span><Input maxLength={100} value={value.sku} onChange={(event) => onChange("sku", event.target.value)} placeholder="Código único de este producto" className="mt-2 w-full" /></label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-medium text-[#37443d]">
            Precio
            <Input required type="number" min="0" step="1" value={value.price} onChange={(event) => onChange("price", event.target.value)} placeholder="25000" className="mt-2 w-full" />
          </label>
          <label className="block text-sm font-medium text-[#37443d]">
            Inventario
            <Input required type="number" min="0" step="1" value={value.stock} onChange={(event) => onChange("stock", event.target.value)} className="mt-2 w-full" />
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
                <Input required type="number" min="0" max={value.price || undefined} step="1" value={value.salePrice} onChange={(event) => onChange("salePrice", event.target.value)} placeholder="18000" className="mt-2 w-full" />
                <span className="mt-1.5 block text-xs font-normal text-[#7d6a66]">Debe ser menor al precio normal de ${Number(value.price || 0).toLocaleString("es-CO")}.</span>
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-sm font-medium text-[#37443d]">
                  Válido desde
                  <Input required type="datetime-local" value={value.saleStartsAt} onChange={(event) => onChange("saleStartsAt", event.target.value)} className="mt-2 w-full min-w-0" />
                </label>
                <label className="block text-sm font-medium text-[#37443d]">
                  Válido hasta
                  <Input required type="datetime-local" value={value.saleEndsAt} onChange={(event) => onChange("saleEndsAt", event.target.value)} className="mt-2 w-full min-w-0" />
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
          <Textarea maxLength={2000} rows={3} value={value.description} onChange={(event) => onChange("description", event.target.value)} className="mt-2 w-full" />
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
        <Button variant="primary" size="lg" type="submit" disabled={saving} className="w-full">
          {saving ? "Guardando..." : editing ? "Guardar cambios" : "Guardar producto"}
        </Button>
      </form>
    </section>
  );
}
