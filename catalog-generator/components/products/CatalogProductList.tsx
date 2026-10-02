"use client";

import Image from "next/image";
import { Product } from "@/lib/api";
import { getDiscountPercent, getSellerPromotionStatus } from "@/lib/product-pricing";

export default function CatalogProductList({
  products,
  loading,
  onEdit,
  onDelete,
}: {
  products: Product[];
  loading: boolean;
  onEdit: (product: Product) => void;
  onDelete: (product: Product) => void;
}) {
  return (
    <section>
      <div className="flex items-end justify-between border-b border-[#dce4dc] pb-3">
        <div>
          <p className="text-xs font-semibold uppercase text-[#c65c3d]">Inventario</p>
          <h2 className="mt-1 text-lg font-semibold text-[#202b27]">Productos</h2>
        </div>
        <span className="text-xs tabular-nums text-[#849087]">{products.length} en total</span>
      </div>
      {loading ? <p className="py-8 text-sm text-[#849087]">Actualizando productos...</p> : products.length === 0 ? (
        <div className="mt-4 rounded-lg border border-dashed border-[#cbd7cc] bg-white/70 px-5 py-10 text-center">
          <h3 className="font-semibold text-[#202b27]">Aún no hay productos</h3>
          <p className="mt-1 text-sm text-[#68756e]">Completa el formulario para añadir el primero.</p>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {products.map((product) => (
            <article key={product.id} className="flex gap-4 rounded-lg border border-[#dce4dc] bg-white p-3.5">
              <div className="relative aspect-square size-20 shrink-0 overflow-hidden rounded-md bg-[#eef2ed] sm:size-24">
                {product.images[0] ? <Image src={product.images[0].url} alt={product.images[0].alt || product.name} fill unoptimized sizes="96px" className="object-cover" /> : <span className="absolute inset-0 grid place-items-center text-[10px] font-medium text-[#87928b]">Sin imagen</span>}
              </div>
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-[#202b27]">{product.name}</p>
                    <p className="mt-1 text-xs text-[#849087]">{product.category?.name || "Sin categoría"} · {product.stock} en inventario</p>
                  </div>
                  <div className="shrink-0 text-right">
                    {getSellerPromotionStatus(product) === "active" ? (
                      <>
                        <p className="text-sm font-bold tabular-nums text-[#c62828]">${product.salePrice!.toLocaleString("es-CO")}</p>
                        <p className="mt-0.5 text-xs tabular-nums text-[#7b8580] line-through">${product.price.toLocaleString("es-CO")}</p>
                        <p className="mt-1 text-[10px] font-bold uppercase text-[#c62828]">-{getDiscountPercent(product.price, product.salePrice!)}% activa</p>
                      </>
                    ) : <p className="text-sm font-semibold tabular-nums text-[#202b27]">${product.price.toLocaleString("es-CO")}</p>}
                  </div>
                </div>
                {product.description && <p className="mt-2 line-clamp-2 text-xs leading-5 text-[#68756e]">{product.description}</p>}
                {getSellerPromotionStatus(product) === "scheduled" && product.saleStartsAt && <p className="mt-2 text-xs font-semibold text-[#a24620]">Oferta programada para {new Date(product.saleStartsAt).toLocaleString("es-CO")}</p>}
                {getSellerPromotionStatus(product) === "expired" && product.salePrice !== null && <p className="mt-2 text-xs font-medium text-[#849087]">Oferta vencida · edítala para reactivarla</p>}
                <div className="mt-auto flex gap-4 pt-3 text-xs font-semibold">
                  <button type="button" onClick={() => onEdit(product)} className="text-[#17665c] hover:text-[#10554c]">Editar</button>
                  <button type="button" onClick={() => onDelete(product)} className="text-[#ad4d35] hover:text-[#853a28]">Eliminar</button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
