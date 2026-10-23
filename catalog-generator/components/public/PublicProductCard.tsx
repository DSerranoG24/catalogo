"use client";

import Image from "next/image";
import Link from "next/link";
import { PublicProduct } from "@/lib/api";

export default function PublicProductCard({
  catalogPublicId,
  product,
  quantity,
  layout,
  onAdd,
}: {
  catalogPublicId: string;
  product: PublicProduct;
  quantity: number;
  layout: "editorial" | "grid" | "boutique" | "tech" | "fashion" | "beauty";
  onAdd: (product: PublicProduct) => void;
}) {
  const image = product.images[0];
  const detailHref = `/c/${encodeURIComponent(catalogPublicId)}/producto/${encodeURIComponent(product.slug)}`;
  const imageSize = "aspect-square";
  const imageTone = layout === "grid" ? "bg-[#eaf0ec]" : layout === "tech" ? "bg-[#dceaf3]" : layout === "beauty" ? "bg-[#f5dfe6]" : layout === "fashion" ? "bg-[#e9ddd2]" : layout === "boutique" ? "bg-[#f1e9d8]" : "bg-[#edf0e6]";
  const cardTone = layout === "grid" ? "border-[#d9e1dc] bg-white" : layout === "tech" ? "border-[#26394a] bg-[#101e2d] text-white" : layout === "beauty" ? "border-[#eed5dc] bg-[#fffaf9]" : layout === "fashion" ? "border-[#e5d9d0] bg-[#fffdfa]" : layout === "boutique" ? "border-[#e8d9ba] bg-[#fffdf8]" : "border-[#dcded2] bg-[#fffefa]";
  const accent = layout === "grid" ? "text-[#315c53]" : layout === "tech" ? "text-[#56e0c0]" : layout === "beauty" ? "text-[#b55271]" : layout === "fashion" ? "text-[#9a554b]" : layout === "boutique" ? "text-[#bd4d36]" : "text-[#ad553b]";
  const isOnSale = product.regularPrice !== null && product.discountPercent !== null;
  const titleTone = layout === "fashion" || layout === "editorial" || layout === "beauty" || layout === "boutique" ? "font-serif" : "font-semibold";

  return (
    <article className={`group flex min-w-0 flex-col overflow-hidden rounded-2xl border transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_18px_38px_-28px_rgba(25,45,36,0.55)] ${cardTone}`}>
      <Link href={detailHref} className="block min-w-0 focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-[#315c53]" aria-label={`Ver detalles de ${product.name}`}>
        <div className={`relative shrink-0 overflow-hidden ${imageSize} ${imageTone}`}>
          {image ? (
            <Image src={image.url} alt={image.alt || product.name} fill unoptimized sizes="(max-width: 640px) 48vw, (max-width: 1280px) 30vw, 20vw" className="object-cover transition duration-500 group-hover:scale-[1.035]" />
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[linear-gradient(135deg,transparent_49.5%,rgba(37,72,58,0.08)_50%,transparent_50.5%),linear-gradient(45deg,transparent_49.5%,rgba(37,72,58,0.06)_50%,transparent_50.5%)] bg-[length:34px_34px] px-5 text-center">
              <span className={`max-w-full text-balance font-serif text-2xl leading-tight text-[#45584d] sm:text-3xl ${layout === "grid" ? "line-clamp-2" : "line-clamp-3"}`}>{product.name}</span>
              <span className={`text-[10px] font-semibold uppercase text-[#677a6f]`}>Fotografía por añadir</span>
            </div>
          )}
          <span className={`absolute left-2 top-2 max-w-[calc(100%-1rem)] truncate bg-white/90 px-2 py-1 text-[9px] font-semibold uppercase text-[#33473c] backdrop-blur-sm ${layout === "beauty" ? "rounded-full" : "rounded-md"}`}>
            {product.category?.name || product.brand || "Colección"}
          </span>
          {isOnSale && <span className="absolute right-2 top-2 rounded-md bg-[#c62828] px-2 py-1 text-[10px] font-bold tabular-nums text-white">-{product.discountPercent}%</span>}
        </div>
        <div className="min-w-0 p-3 sm:p-3.5">
          <p className={`truncate text-[9px] font-bold uppercase tracking-[0.12em] ${accent}`}>{product.brand || (layout === "tech" ? "TECH / LAB" : layout === "beauty" ? "BEAUTY EDIT" : "Selección de la casa")}</p>
          <h3 className={`mt-1.5 line-clamp-2 min-h-9 text-sm leading-[1.15rem] ${titleTone} ${layout === "tech" ? "text-white" : layout === "beauty" ? "text-[#552e48]" : layout === "fashion" ? "text-[#322c29]" : "text-[#263b31]"}`}>{product.name}</h3>
          {product.description && <p className={`mt-1.5 line-clamp-2 min-h-8 text-[11px] leading-4 ${layout === "tech" ? "text-[#a9bccd]" : layout === "beauty" ? "text-[#896879]" : "text-[#68756e]"}`}>{product.description}</p>}
          {!product.description && <span className="mt-1.5 block h-8" aria-hidden="true" />}
          <span className={`mt-1 inline-flex items-center gap-1 text-[10px] font-semibold ${accent}`}>
            Ver detalles <span aria-hidden="true" className="transition-transform group-hover:translate-x-1">→</span>
          </span>
        </div>
      </Link>
      <div className="mt-auto flex items-center justify-between gap-2 border-t border-current/10 px-3 py-2.5 sm:px-3.5">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <p className={`text-xs tabular-nums ${isOnSale ? "font-bold text-[#c62828]" : `font-semibold ${layout === "tech" ? "text-white" : "text-[#202b27]"}`}`}>${product.price.toLocaleString("es-CO")}</p>
          {isOnSale && <p className="text-[10px] tabular-nums text-[#737d77] line-through">${product.regularPrice!.toLocaleString("es-CO")}</p>}
        </div>
        <button type="button" onClick={() => onAdd(product)} aria-label={`Añadir ${product.name} a la orden`} className={`min-h-8 shrink-0 rounded-lg px-2.5 text-[10px] font-semibold transition sm:text-[11px] ${layout === "boutique" ? "bg-[#bd4d36] text-white hover:bg-[#a83f2c]" : layout === "beauty" ? "rounded-full bg-[#b55271] text-white hover:bg-[#94425c]" : layout === "tech" ? "bg-[#56e0c0] text-[#071421] hover:bg-[#35cbaa]" : layout === "fashion" ? "bg-[#322c29] text-white hover:bg-[#4c3f39]" : layout === "grid" ? "bg-[#315c53] text-white hover:bg-[#24483f]" : "bg-[#263b31] text-white hover:bg-[#192b22]"}`}>
          {quantity > 0 ? `Agregar · ${quantity}` : "Agregar"}
        </button>
      </div>
    </article>
  );
}
