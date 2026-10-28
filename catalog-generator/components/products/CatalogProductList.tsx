"use client";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import uiStyles from "@/components/ui/ui.module.css";

import Image from "next/image";
import type { RefObject } from "react";
import { Category, Product, ProductPage } from "@/lib/api";
import { productFiltersActive, type ProductListQuery } from "@/lib/product-list-query";
import ProductListControls from "./ProductListControls";
import ProductListPagination from "./ProductListPagination";
import { getDiscountPercent, getSellerPromotionStatus } from "@/lib/product-pricing";
import type { useCatalogFeatured } from "@/lib/use-catalog-featured";
import type { SelectedProduct } from "@/lib/product-bulk-selection";

export default function CatalogProductList({
  result,
  categories,
  query,
  onQueryChange,
  error,
  onRetry,
  loading,
  onEdit,
  onDelete,
  onImport,
  importOpen,
  importDisabled,
  mutationDisabled,
  importButtonRef,
  onPhotos, photoOpen, photosDisabled, photoButtonRef, onPublish,
  featured, archived,
  selected, selectionBusy, onSelect, onSelectPage,
}: {
  result: ProductPage;
  categories: Category[];
  query: ProductListQuery;
  onQueryChange: (patch: Partial<ProductListQuery>, replace?: boolean) => void;
  error: string;
  onRetry: () => void;
  loading: boolean;
  onEdit: (product: Product) => void;
  onDelete: (product: Product) => void;
  onImport: () => void;
  importOpen: boolean;
  importDisabled: boolean;
  mutationDisabled: boolean;
  importButtonRef: RefObject<HTMLButtonElement | null>;
  onPhotos: () => void;
  photoOpen: boolean;
  photosDisabled: boolean;
  photoButtonRef: RefObject<HTMLButtonElement | null>;
  onPublish: (product: Product) => void;
  featured: ReturnType<typeof useCatalogFeatured>;
  archived: boolean;
  selected: readonly SelectedProduct[];
  selectionBusy: boolean;
  onSelect: (product: Product) => void;
  onSelectPage: (products: Product[]) => void;
}) {
  const { products, totalProducts, totalFiltered } = result;
  const filtered = productFiltersActive(query);
  const clearFilters = () => onQueryChange({ q: "", category: "all", status: "all", stock: "all" });
  return (
    <section className="min-w-0" aria-busy={loading}>
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-2xl border border-[#e2e8e0] bg-white px-5 py-4 shadow-[0_14px_36px_-34px_rgba(36,63,47,0.5)]">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--brand-coral-text)]">Inventario</p>
          <h2 className="mt-1 text-lg font-semibold tracking-tight text-[#202b27]">Productos</h2>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-3"><span className="text-xs tabular-nums text-[#52655a]">{totalProducts} en total{filtered && !loading && !error ? ` · ${totalFiltered} coinciden` : ""}</span><Button variant="primary" ref={importButtonRef} type="button" onClick={onImport} disabled={importDisabled} aria-expanded={importOpen} aria-controls="product-import-panel" >Importar Excel</Button></div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3"><Button variant="outline" ref={photoButtonRef} type="button" onClick={onPhotos} disabled={photosDisabled} aria-expanded={photoOpen} aria-controls="product-photo-panel" >Cargar varias fotos</Button>{!loading && !error && Number.isSafeInteger(result.needsCompletionCount) && <span className="text-sm tabular-nums">{result.needsCompletionCount} sin completar (total)</span>}</div>
      <ProductListControls query={query} categories={categories} disabled={mutationDisabled} onChange={onQueryChange} />
      <label className="mt-3 flex min-h-11 items-center gap-2 text-sm text-[#263b31]"><input type="checkbox" disabled={selectionBusy || loading || !!error || !products.length} checked={!!products.length && products.every(product => selected.some(item => item.id === product.id))} ref={element => { if (element) element.indeterminate = products.some(product => selected.some(item => item.id === product.id)) && !products.every(product => selected.some(item => item.id === product.id)); }} onChange={() => onSelectPage(products)} />Seleccionar página actual ({products.length})</label>
      <div className="mt-3 space-y-2 text-sm" aria-live="polite" aria-atomic="true">
        <p data-featured-count>{featured.status ? `${featured.status.selectedCount} de 5 destacados` : "Consultando destacados…"}</p>
        {featured.status && featured.status.validCount < 3 && <p>Los destacados no se mostrarán en el catálogo público hasta tener al menos 3 productos activos seleccionados.</p>}
        {featured.status?.selectedCount === 5 && <p id="featured-limit">Límite de 5 alcanzado. Quita un destacado para seleccionar otro.</p>}
        {archived && <p>Reactiva el catálogo para gestionar sus destacados.</p>}
      </div>
      {featured.error && <div role="alert" className="mt-2 text-sm text-[#9f1239]"><p>{featured.error}</p><Button type="button" variant="outline" disabled={featured.pendingId !== null} onClick={() => void featured.refresh()}>Consultar contador</Button></div>}
      {error && <div role="alert" className="mt-4 rounded-xl bg-[#fff4ef] p-4 text-sm text-[#a5432a]"><p>{error}</p><Button variant="ghost" type="button" onClick={onRetry} className="mt-2">Reintentar</Button></div>}
      {loading ? <div role="status" aria-label="Cargando productos" className="mt-4 grid grid-cols-2 gap-3 animate-pulse xl:grid-cols-3">{[0, 1, 2, 3, 4, 5].map((item) => <div key={item} className="overflow-hidden rounded-2xl border border-[#e2e8e0] bg-white"><div className="aspect-square bg-[#e8eee5]" /><div className="space-y-2 p-3"><div className="h-3 w-3/4 rounded-full bg-[#e8eee5]" /><div className="h-3 w-1/2 rounded-full bg-[#f0f3ee]" /><div className="h-3 w-1/3 rounded-full bg-[#f0f3ee]" /></div></div>)}</div> : error ? null : products.length === 0 ? (
        <div className="mt-4 rounded-2xl border border-dashed border-[#cbd7cc] bg-white/70 px-5 py-10 text-center">
          <h3 className="font-semibold text-[#202b27]">{totalProducts === 0 ? "Aún no hay productos" : "No hay productos que coincidan"}</h3>
          <p className="mt-1 text-sm text-[#68756e]">{totalProducts === 0 ? "Completa el formulario para añadir el primero." : "Prueba otra búsqueda o limpia los filtros."}</p>{totalProducts > 0 && <Button variant="ghost" type="button" disabled={mutationDisabled} onClick={clearFilters} className="mt-3">Limpiar filtros</Button>}
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-3 xl:grid-cols-3">
          {products.map((product) => (
            <Card as="article" variant="interactive" key={product.id} className={`group flex min-w-0 flex-col overflow-hidden ${uiStyles.productCard}`}>
              <div className="relative aspect-square w-full shrink-0 overflow-hidden bg-[#eef2ed]">
                {product.images[0] ? <Image src={product.images[0].url} alt={product.images[0].alt || product.name} fill unoptimized sizes="(max-width: 640px) 48vw, (max-width: 1280px) 30vw, 20vw" className="object-cover transition duration-300 group-hover:scale-[1.03]" /> : <span className="absolute inset-0 grid place-items-center text-[10px] font-medium text-[#87928b]">Sin imagen</span>}
              </div>
              <div className="flex min-w-0 flex-1 flex-col p-3">
                <label className="mb-2 flex min-h-11 items-center gap-2 text-xs"><input data-product-selection={product.id} type="checkbox" disabled={selectionBusy || (selected.length === 96 && !selected.some(item => item.id === product.id))} checked={selected.some(item => item.id === product.id)} onChange={() => onSelect(product)} />Seleccionar {product.name}</label>
                <p className="truncate text-sm font-semibold text-[#202b27]">{product.name}</p>
                {product.needsCompletion ? <p className="mt-1 text-xs font-semibold text-[var(--brand-coral-text)]">Sin completar · Inactivo</p> : !product.active && <p className="mt-1 text-xs">Inactivo · Sin publicar</p>}
                <p className="mt-1 truncate text-[10px] text-[#849087]">{product.category?.name || "Sin categoría"} · {product.stock} en stock</p>
                <div className="mt-2 min-h-8">
                  {getSellerPromotionStatus(product) === "active" ? <><p className="text-xs font-bold tabular-nums text-[#c62828]">${product.salePrice!.toLocaleString("es-CO")} <span className="font-normal text-[#7b8580] line-through">${product.price.toLocaleString("es-CO")}</span></p><p className="mt-0.5 text-[9px] font-bold uppercase text-[#c62828]">-{getDiscountPercent(product.price, product.salePrice!)}% activa</p></> : <p className="text-xs font-semibold tabular-nums text-[#202b27]">${product.price.toLocaleString("es-CO")}</p>}
                  {getSellerPromotionStatus(product) === "scheduled" && product.saleStartsAt && <p className="mt-1 text-[9px] font-semibold text-[#a24620]">Oferta programada</p>}
                  {getSellerPromotionStatus(product) === "expired" && product.salePrice !== null && <p className="mt-1 text-[9px] font-medium text-[#849087]">Oferta vencida</p>}
                </div>
                {product.description && <p className="mt-1 line-clamp-2 min-h-8 text-[10px] leading-4 text-[#68756e]">{product.description}</p>}
                {!product.description && <span className="min-h-8" aria-hidden="true" />}
                {!product.needsCompletion && !product.active && <Button variant="primary" size="sm" type="button" disabled={mutationDisabled} onClick={() => onPublish(product)} className="my-2">Publicar</Button>}
                <div className="mt-auto flex flex-wrap gap-2 border-t border-[#edf1ec] pt-2.5 text-[10px] font-semibold">
                  <Button variant="outline" size="sm" type="button" className="w-full" aria-pressed={featured.status?.products.some(row => row.id === product.id) ?? product.featured ?? false} aria-label={`${featured.status?.products.some(row => row.id === product.id) ? "Quitar destacado" : "Destacar"}: ${product.name}`} aria-describedby={featured.status?.selectedCount === 5 ? "featured-limit" : undefined} disabled={archived || mutationDisabled || !featured.available || (featured.status?.selectedCount === 5 && !featured.status.products.some(row => row.id === product.id))} onClick={() => void featured.toggle(product)}>
                    {featured.pendingId === product.id ? "Guardando destacado…" : featured.status?.products.some(row => row.id === product.id) ? "Quitar destacado" : "Destacar"}
                  </Button>
                  <Button variant="secondary" size="sm" type="button" disabled={mutationDisabled} onClick={() => onEdit(product)} className="flex-1">Editar</Button>
                  <Button variant="destructive-ghost" size="sm" type="button" disabled={mutationDisabled} onClick={() => onDelete(product)} className="shrink-0">Eliminar</Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
      {!error && <ProductListPagination result={result} disabled={loading || mutationDisabled} onPageChange={page => onQueryChange({ page })} />}
    </section>
  );
}
