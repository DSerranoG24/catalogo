"use client";

import { ArrowDownWideNarrow, Search, X } from "lucide-react";

export type ProductSortOrder = "store" | "price-asc" | "price-desc" | "name-asc";

export default function PublicProductToolbar({
  searchQuery,
  sortOrder,
  totalProducts,
  onSearchChange,
  onSortChange,
}: {
  searchQuery: string;
  sortOrder: ProductSortOrder;
  totalProducts: number;
  onSearchChange: (value: string) => void;
  onSortChange: (value: ProductSortOrder) => void;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-y border-[#d8ded6] py-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:gap-5">
      <label className="relative block min-w-0">
        <span className="sr-only">Buscar productos</span>
        <Search aria-hidden="true" size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#66756b]" />
        <input
          type="search"
          value={searchQuery}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Buscar producto, marca o categoría"
          className="h-11 w-full border border-[#cbd4cb] bg-white pl-10 pr-10 text-sm text-[#263b31] outline-none transition placeholder:text-[#7f8b82] focus:border-[#315c53] focus:ring-2 focus:ring-[#315c53]/10"
        />
        {searchQuery && (
          <button type="button" onClick={() => onSearchChange("")} aria-label="Limpiar búsqueda" title="Limpiar búsqueda" className="absolute right-2 top-1/2 grid size-8 -translate-y-1/2 place-items-center text-[#66756b] hover:text-[#bd4d36]">
            <X aria-hidden="true" size={16} />
          </button>
        )}
      </label>
      <label className="flex h-11 items-center gap-2 border border-[#cbd4cb] bg-white px-2.5 text-[#435047] sm:px-3">
        <ArrowDownWideNarrow aria-hidden="true" size={17} className="shrink-0" />
        <span className="sr-only">Ordenar productos</span>
        <select aria-label="Ordenar productos" value={sortOrder} onChange={(event) => onSortChange(event.target.value as ProductSortOrder)} className="max-w-32 bg-transparent text-xs font-semibold outline-none sm:max-w-none sm:text-sm">
          <option value="store">Orden de la tienda</option>
          <option value="price-asc">Menor precio</option>
          <option value="price-desc">Mayor precio</option>
          <option value="name-asc">Nombre A–Z</option>
        </select>
      </label>
      <p aria-live="polite" className="col-span-2 text-xs text-[#647268] sm:col-span-1 sm:text-right">
        {totalProducts} {totalProducts === 1 ? "producto" : "productos"}
      </p>
    </div>
  );
}