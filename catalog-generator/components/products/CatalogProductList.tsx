"use client";

import Image from "next/image";
import type { RefObject } from "react";
import { Product } from "@/lib/api";
import { getDiscountPercent, getSellerPromotionStatus } from "@/lib/product-pricing";

export default function CatalogProductList({
  products,
  loading,
  onEdit,
  onDelete,
  onImport,
  importOpen,
  importDisabled,
  mutationDisabled,
  importButtonRef,
}: {
  products: Product[];
  loading: boolean;
  onEdit: (product: Product) => void;
  onDelete: (product: Product) => void;
  onImport: () => void;
  importOpen: boolean;
  importDisabled: boolean;
  mutationDisabled: boolean;
  importButtonRef: RefObject<HTMLButtonElement | null>;
}) {
  return (
    <section>
      <div className="flex items-end justify-between rounded-2xl border border-[#e2e8e0] bg-white px-5 py-4 shadow-[0_14px_36px_-34px_rgba(36,63,47,0.5)]">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--brand-coral-text)]">Inventario</p>
          <h2 className="mt-1 text-lg font-semibold tracking-tight text-[#202b27]">Productos</h2>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-3"><span className="text-xs tabular-nums text-[#52655a]">{products.length} en total</span><button ref={importButtonRef} type="button" onClick={onImport} disabled={importDisabled} aria-expanded={importOpen} aria-controls="product-import-panel" className="min-h-11 rounded-lg bg-[var(--brand-emerald)] px-3 py-2 text-sm font-semibold text-white hover:bg-[var(--brand-emerald-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-emerald)] disabled:cursor-not-allowed disabled:opacity-50">Importar Excel</button></div>
      </div>
      {loading ? <div role="status" aria-label="Cargando productos" className="mt-4 grid grid-cols-2 gap-3 animate-pulse xl:grid-cols-3">{[0, 1, 2, 3, 4, 5].map((item) => <div key={item} className="overflow-hidden rounded-2xl border border-[#e2e8e0] bg-white"><div className="aspect-square bg-[#e8eee5]" /><div className="space-y-2 p-3"><div className="h-3 w-3/4 rounded-full bg-[#e8eee5]" /><div className="h-3 w-1/2 rounded-full bg-[#f0f3ee]" /><div className="h-3 w-1/3 rounded-full bg-[#f0f3ee]" /></div></div>)}</div> : products.length === 0 ? (
        <div className="mt-4 rounded-2xl border border-dashed border-[#cbd7cc] bg-white/70 px-5 py-10 text-center">
          <h3 className="font-semibold text-[#202b27]">Aún no hay productos</h3>
          <p className="mt-1 text-sm text-[#68756e]">Completa el formulario para añadir el primero.</p>
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-3 xl:grid-cols-3">
          {products.map((product) => (
            <article key={product.id} className="group flex min-w-0 flex-col overflow-hidden rounded-2xl border border-[#e2e8e0] bg-white shadow-[0_14px_36px_-34px_rgba(36,63,47,0.5)] transition hover:-translate-y-0.5 hover:shadow-md">
              <div className="relative aspect-square w-full shrink-0 overflow-hidden bg-[#eef2ed]">
                {product.images[0] ? <Image src={product.images[0].url} alt={product.images[0].alt || product.name} fill unoptimized sizes="(max-width: 640px) 48vw, (max-width: 1280px) 30vw, 20vw" className="object-cover transition duration-300 group-hover:scale-[1.03]" /> : <span className="absolute inset-0 grid place-items-center text-[10px] font-medium text-[#87928b]">Sin imagen</span>}
              </div>
              <div className="flex min-w-0 flex-1 flex-col p-3">
                <p className="truncate text-sm font-semibold text-[#202b27]">{product.name}</p>
                <p className="mt-1 truncate text-[10px] text-[#849087]">{product.category?.name || "Sin categoría"} · {product.stock} en stock</p>
                <div className="mt-2 min-h-8">
                  {getSellerPromotionStatus(product) === "active" ? <><p className="text-xs font-bold tabular-nums text-[#c62828]">${product.salePrice!.toLocaleString("es-CO")} <span className="font-normal text-[#7b8580] line-through">${product.price.toLocaleString("es-CO")}</span></p><p className="mt-0.5 text-[9px] font-bold uppercase text-[#c62828]">-{getDiscountPercent(product.price, product.salePrice!)}% activa</p></> : <p className="text-xs font-semibold tabular-nums text-[#202b27]">${product.price.toLocaleString("es-CO")}</p>}
                  {getSellerPromotionStatus(product) === "scheduled" && product.saleStartsAt && <p className="mt-1 text-[9px] font-semibold text-[#a24620]">Oferta programada</p>}
                  {getSellerPromotionStatus(product) === "expired" && product.salePrice !== null && <p className="mt-1 text-[9px] font-medium text-[#849087]">Oferta vencida</p>}
                </div>
                {product.description && <p className="mt-1 line-clamp-2 min-h-8 text-[10px] leading-4 text-[#68756e]">{product.description}</p>}
                {!product.description && <span className="min-h-8" aria-hidden="true" />}
                <div className="mt-auto flex gap-2 border-t border-[#edf1ec] pt-2.5 text-[10px] font-semibold">
                  <button type="button" disabled={mutationDisabled} onClick={() => onEdit(product)} className="min-h-8 flex-1 rounded-lg bg-[var(--brand-emerald-soft)] px-2 text-[#315e4f] transition hover:bg-[#e1ece1] disabled:opacity-50">Editar</button>
                  <button type="button" disabled={mutationDisabled} onClick={() => onDelete(product)} className="min-h-8 rounded-lg px-2 text-[#ad4d35] transition hover:bg-[#fff1ec] disabled:opacity-50">Eliminar</button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
