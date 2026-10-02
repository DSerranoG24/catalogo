"use client";

import Image from "next/image";
import Link from "next/link";
import { PublicProduct } from "@/lib/api";

export default function PublicProductCard({
  catalogPublicId,
  product,
  quantity,
  layout,
  featured = false,
  onAdd,
}: {
  catalogPublicId: string;
  product: PublicProduct;
  quantity: number;
  layout: "editorial" | "grid" | "boutique";
  featured?: boolean;
  onAdd: (product: PublicProduct) => void;
}) {
  const image = product.images[0];
  const detailHref = `/c/${encodeURIComponent(catalogPublicId)}/producto/${encodeURIComponent(product.slug)}`;
  const imageSize = layout === "grid" ? "aspect-square" : layout === "boutique" ? "aspect-[4/3] sm:aspect-auto sm:min-h-64 sm:w-[42%]" : "aspect-[4/3]";
  const imageTone = layout === "grid" ? "bg-[#eaf0ec]" : layout === "boutique" ? "bg-[#f1e9d8]" : "bg-[#edf0e6]";
  const cardTone = layout === "grid" ? "border-[#d9e1dc] bg-white" : layout === "boutique" ? "border-[#e8d9ba] bg-[#fffdf8]" : "border-[#dcded2] bg-[#fffefa]";
  const accent = layout === "grid" ? "text-[#315c53]" : layout === "boutique" ? "text-[#bd4d36]" : "text-[#ad553b]";
  const isBoutique = layout === "boutique";
  const isOnSale = product.regularPrice !== null && product.discountPercent !== null;

  return (
    <article className={`group flex min-w-0 flex-col overflow-hidden border transition duration-300 hover:-translate-y-1 hover:shadow-[0_18px_38px_-28px_rgba(25,45,36,0.55)] ${cardTone} ${featured ? "sm:col-span-2 sm:grid sm:grid-cols-2" : ""}`}>
      <Link href={detailHref} className={`block min-w-0 focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-[#315c53] ${isBoutique ? "sm:flex sm:min-w-0 sm:flex-1" : ""} ${featured ? "sm:col-span-2 sm:grid sm:grid-cols-2" : ""}`} aria-label={`Ver detalles de ${product.name}`}>
        <div className={`relative shrink-0 overflow-hidden ${imageSize} ${featured ? "sm:aspect-auto sm:min-h-80" : ""} ${imageTone}`}>
          {image ? (
            <Image src={image.url} alt={image.alt || product.name} fill unoptimized sizes="(max-width: 640px) 90vw, 40vw" className="object-cover transition duration-500 group-hover:scale-[1.035]" />
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[linear-gradient(135deg,transparent_49.5%,rgba(37,72,58,0.08)_50%,transparent_50.5%),linear-gradient(45deg,transparent_49.5%,rgba(37,72,58,0.06)_50%,transparent_50.5%)] bg-[length:34px_34px] px-5 text-center">
              <span className={`max-w-full text-balance font-serif text-2xl leading-tight text-[#45584d] sm:text-3xl ${layout === "grid" ? "line-clamp-2" : "line-clamp-3"}`}>{product.name}</span>
              <span className={`text-[10px] font-semibold uppercase text-[#677a6f]`}>Fotografía por añadir</span>
            </div>
          )}
          <span className={`absolute left-3 top-3 max-w-[calc(100%-1.5rem)] truncate bg-white/90 px-2.5 py-1.5 text-[10px] font-semibold uppercase text-[#33473c] backdrop-blur-sm`}>
            {product.category?.name || product.brand || "Colección"}
          </span>
          {isOnSale && <span className="absolute right-3 top-3 bg-[#c62828] px-2.5 py-1.5 text-xs font-bold tabular-nums text-white">-{product.discountPercent}%</span>}
        </div>
        <div className={`min-w-0 ${isBoutique ? "sm:flex sm:flex-1 sm:flex-col sm:justify-center" : ""} ${layout === "grid" ? "p-3.5 sm:p-4" : "p-5 sm:p-6"}`}>
          <p className={`text-[10px] font-semibold uppercase ${accent}`}>{product.brand || "Selección de la casa"}</p>
          <h3 className={`${layout === "editorial" ? "mt-2 font-serif text-xl text-[#263b31]" : layout === "grid" ? "mt-1.5 text-sm font-semibold text-[#25352e]" : "mt-2 font-serif text-2xl text-[#553b31]"}`}>{product.name}</h3>
          {product.description && <p className={`mt-2 text-sm leading-6 text-[#68756e] ${layout === "grid" ? "line-clamp-2 text-xs leading-5" : "line-clamp-3"}`}>{product.description}</p>}
          <span className={`mt-4 inline-flex items-center gap-2 text-xs font-semibold ${accent}`}>
            Ver detalles <span aria-hidden="true" className="transition-transform group-hover:translate-x-1">→</span>
          </span>
        </div>
      </Link>
      <div className={`mt-auto flex items-center justify-between gap-3 border-t border-black/5 ${layout === "grid" ? "px-3.5 py-3 sm:px-4" : "px-5 py-4 sm:px-6"}`}>
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <p className={`tabular-nums ${isOnSale ? "font-bold text-[#c62828]" : "font-semibold text-[#202b27]"} ${layout === "grid" ? "text-sm" : "text-lg"}`}>${product.price.toLocaleString("es-CO")}</p>
          {isOnSale && <p className="text-xs tabular-nums text-[#737d77] line-through">${product.regularPrice!.toLocaleString("es-CO")}</p>}
        </div>
        <button type="button" onClick={() => onAdd(product)} aria-label={`Añadir ${product.name} a la orden`} className={`min-h-10 rounded-sm px-3 py-2 text-xs font-semibold transition ${layout === "boutique" ? "bg-[#bd4d36] text-white hover:bg-[#a83f2c]" : layout === "grid" ? "bg-[#315c53] text-white hover:bg-[#24483f]" : "bg-[#263b31] text-white hover:bg-[#192b22]"}`}>
          {quantity > 0 ? `Añadir · ${quantity}` : "Añadir"}
        </button>
      </div>
    </article>
  );
}
