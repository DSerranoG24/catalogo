import { Category } from "@/lib/api";
import Link from "next/link";
import Image from "next/image";
import { ShoppingCart } from "lucide-react";

export default function PublicCategoryFilter({
  categories,
  selectedId,
  variant,
  onSelect,
  publicId,
  cartCount,
  cartTotal,
}: {
  categories: Category[];
  selectedId: string;
  variant: "editorial" | "grid" | "boutique" | "tech" | "fashion" | "beauty";
  onSelect: (categoryId: string) => void;
  publicId: string;
  cartCount: number;
  cartTotal: number;
}) {
  const selectedClass = variant === "tech"
    ? "border-[#56e0c0] bg-[#56e0c0] text-[#071421]"
    : variant === "fashion"
      ? "border-[#322c29] bg-[#322c29] text-white"
      : variant === "beauty"
        ? "border-[#b55271] bg-[#b55271] text-white"
        : variant === "boutique"
    ? "border-[#bd4d36] bg-[#bd4d36] text-white"
    : variant === "grid"
      ? "border-[#315c53] bg-[#315c53] text-white"
      : "border-[#263b31] bg-[#263b31] text-white";

  const barStyle = variant === "tech"
    ? "border-[#26394a] bg-[#101e2d]/95 text-[#e5f2ff]"
    : variant === "fashion"
      ? "border-[#e5d9d0] bg-[#fffdfa]/95 text-[#322c29]"
      : variant === "beauty"
        ? "border-[#eed5dc] bg-[#fffaf9]/95 text-[#552e48]"
        : "border-[#d8ded6] bg-[#fbfcf9]/95";
  const idleClass = variant === "tech"
    ? "border-transparent bg-transparent text-[#a9bccd] hover:border-[#56e0c0]/40 hover:bg-[#1b2c3d] hover:text-white"
    : "border-transparent bg-transparent text-[#526157] hover:border-[#cbd4cb] hover:bg-white";

  return (
    <nav aria-label="Filtrar por categoría" className={`sticky top-0 z-10 border-y py-2 backdrop-blur-sm ${barStyle}`}>
      <div className="mx-auto flex max-w-7xl items-center gap-2 px-3 sm:gap-4 sm:px-8">
        <div className="flex min-w-0 flex-1 snap-x gap-1 overflow-x-auto px-2 sm:gap-2">
          {[{ id: "", name: "Todos", imageUrl: null }, ...categories].map((category) => (
            <button
              key={category.id || "all"}
              type="button"
              onClick={() => onSelect(category.id)}
              aria-pressed={selectedId === category.id}
              className={`flex min-h-11 shrink-0 snap-start items-center gap-2 border px-3 text-xs font-semibold transition sm:px-4 ${selectedId === category.id ? selectedClass : idleClass}`}
            >
              {category.imageUrl && (
                <span className="relative size-8 shrink-0 overflow-hidden border border-black/10 bg-white/30">
                  <Image src={category.imageUrl} alt="" fill unoptimized sizes="32px" className="object-cover" />
                </span>
              )}
              <span>{category.name}</span>
            </button>
          ))}
        </div>
        <Link href={`/c/${encodeURIComponent(publicId)}/carrito`} aria-label={`Carrito de compras, ${cartCount} ${cartCount === 1 ? "producto" : "productos"}`} title="Abrir carrito" className={`flex min-h-10 shrink-0 items-center gap-2 border-l pl-3 text-xs font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 sm:pl-5 ${variant === "tech" ? "border-[#34495c] text-[#e5f2ff] hover:text-[#56e0c0] focus-visible:outline-[#56e0c0]" : "border-[#d8ded6] text-[#263b31] hover:text-[#bd4d36] focus-visible:outline-[#315c53]"}`}>
          <span className="relative grid size-8 place-items-center">
            <ShoppingCart aria-hidden="true" size={21} strokeWidth={2} />
            <span className="absolute -right-1 -top-1 grid min-w-4 place-items-center rounded-full bg-[#bd4d36] px-1 text-[9px] font-bold leading-4 text-white">{cartCount > 99 ? "99+" : cartCount}</span>
          </span>
          <span>Carrito</span>
          {cartCount > 0 && <span className="hidden tabular-nums text-[#647268] sm:inline">${cartTotal.toLocaleString("es-CO")}</span>}
        </Link>
      </div>
    </nav>
  );
}
