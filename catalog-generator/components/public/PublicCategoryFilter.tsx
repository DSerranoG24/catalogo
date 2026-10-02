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
  variant: "editorial" | "grid" | "boutique";
  onSelect: (categoryId: string) => void;
  publicId: string;
  cartCount: number;
  cartTotal: number;
}) {
  const selectedClass = variant === "boutique"
    ? "border-[#bd4d36] bg-[#bd4d36] text-white"
    : variant === "grid"
      ? "border-[#315c53] bg-[#315c53] text-white"
      : "border-[#263b31] bg-[#263b31] text-white";

  return (
    <nav aria-label="Filtrar por categoría" className="sticky top-0 z-10 border-y border-[#d8ded6] bg-[#fbfcf9]/95 py-2 backdrop-blur-sm">
      <div className="mx-auto flex max-w-7xl items-center gap-2 px-3 sm:gap-4 sm:px-8">
        <div className="flex min-w-0 flex-1 snap-x gap-1 overflow-x-auto px-2 sm:gap-2">
          {[{ id: "", name: "Todos", imageUrl: null }, ...categories].map((category) => (
            <button
              key={category.id || "all"}
              type="button"
              onClick={() => onSelect(category.id)}
              aria-pressed={selectedId === category.id}
              className={`flex min-h-11 shrink-0 snap-start items-center gap-2 border px-3 text-xs font-semibold transition sm:px-4 ${selectedId === category.id ? selectedClass : "border-transparent bg-transparent text-[#526157] hover:border-[#cbd4cb] hover:bg-white"}`}
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
        <Link href={`/c/${encodeURIComponent(publicId)}/carrito`} aria-label={`Carrito de compras, ${cartCount} ${cartCount === 1 ? "producto" : "productos"}`} title="Abrir carrito" className="flex min-h-10 shrink-0 items-center gap-2 border-l border-[#d8ded6] pl-3 text-xs font-semibold text-[#263b31] transition hover:text-[#bd4d36] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#315c53] sm:pl-5">
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
