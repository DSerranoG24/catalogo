"use client";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

import { useEffect, useRef, useState } from "react";
import type { Category } from "@/lib/api";
import { defaultProductQuery, productQueryString, type ProductListQuery } from "@/lib/product-list-query";

const field = "min-h-11 min-w-0 w-full rounded-xl border border-[#d6dfd7] bg-white px-3 py-2 text-sm text-[#37443d] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-emerald)]";

export default function ProductListControls({ query, categories, disabled, onChange }: {
  query: ProductListQuery; categories: Category[]; disabled: boolean;
  onChange: (patch: Partial<ProductListQuery>, replace?: boolean) => void;
}) {
  const signature = productQueryString(query);
  const [draft, setDraft] = useState({ signature, value: query.q });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, [signature, disabled]);
  const chips: { label: string; clear: Partial<ProductListQuery> }[] = [];
  if (query.q) chips.push({ label: `Búsqueda: ${query.q}`, clear: { q: "" } });
  if (query.category !== "all") chips.push({ label: query.category === "none" ? "Sin categoría" : categories.find(c => c.id === query.category)?.name ?? "Categoría no disponible", clear: { category: "all" } });
  if (query.status !== "all") chips.push({ label: query.status === "active" ? "Activos" : "Inactivos", clear: { status: "all" } });
  if (query.stock !== "all") chips.push({ label: query.stock === "in" ? "Con stock" : "Sin stock", clear: { stock: "all" } });
  return <fieldset disabled={disabled} className="mt-4 min-w-0 rounded-2xl border border-[#e2e8e0] bg-white p-4">
    <legend className="sr-only">Buscar, filtrar y ordenar productos</legend>
    <label htmlFor="product-list-search" className="block text-xs font-semibold text-[#37443d]">Buscar productos</label>
    <Input id="product-list-search" type="search" maxLength={150} placeholder="Nombre, SKU, marca o modelo" className="mt-2" value={draft.signature === signature ? draft.value : query.q} onChange={event => {
      const value = event.target.value;
      setDraft({ signature, value });
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => onChange({ q: value.trim() }, true), 300);
    }} />
    <div className="mt-3 grid min-w-0 gap-3 sm:grid-cols-2">
      <label className="min-w-0 text-xs font-semibold text-[#37443d]">Categoría<select className={`${field} mt-1`} value={query.category} onChange={e => onChange({ category: e.target.value })}><option value="all">Todas las categorías</option><option value="none">Sin categoría</option>{categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <label className="min-w-0 text-xs font-semibold text-[#37443d]">Estado<select className={`${field} mt-1`} value={query.status} onChange={e => onChange({ status: e.target.value === "active" ? "active" : e.target.value === "inactive" ? "inactive" : "all" })}><option value="all">Todos los estados</option><option value="active">Activos</option><option value="inactive">Inactivos</option></select></label>
      <label className="min-w-0 text-xs font-semibold text-[#37443d]">Stock informativo<select className={`${field} mt-1`} value={query.stock} onChange={e => onChange({ stock: e.target.value === "in" ? "in" : e.target.value === "out" ? "out" : "all" })}><option value="all">Todo el stock</option><option value="in">Con stock</option><option value="out">Sin stock</option></select></label>
      <label className="min-w-0 text-xs font-semibold text-[#37443d]">Ordenar por<select className={`${field} mt-1`} value={query.sort} onChange={e => { const sort = e.target.value; onChange({ sort: sort === "name" || sort === "price" || sort === "stock" || sort === "category" ? sort : "createdAt" }); }}><option value="createdAt">Fecha de creación</option><option value="name">Nombre</option><option value="price">Precio base</option><option value="stock">Stock</option><option value="category">Categoría</option></select></label>
      <label className="min-w-0 text-xs font-semibold text-[#37443d]">Dirección<select className={`${field} mt-1`} value={query.order} onChange={e => onChange({ order: e.target.value === "asc" ? "asc" : "desc" })}><option value="desc">Descendente</option><option value="asc">Ascendente</option></select></label>
      <label className="min-w-0 text-xs font-semibold text-[#37443d]">Productos por página<select className={`${field} mt-1`} value={query.pageSize} onChange={e => onChange({ pageSize: Number(e.target.value) })}>{[24, 48, 96].map(n => <option key={n} value={n}>{n}</option>)}</select></label>
    </div>
    {chips.length > 0 && <div className="mt-3 flex min-w-0 flex-wrap gap-2" aria-label="Filtros activos">{chips.map(chip => <Button variant="chip" selected key={chip.label} type="button" className="max-w-full break-words" aria-label={`Quitar filtro ${chip.label}`} onClick={() => onChange(chip.clear)}>{chip.label} ×</Button>)}<Button variant="ghost" type="button"  onClick={() => onChange({ q: "", category: defaultProductQuery.category, status: "all", stock: "all" })}>Limpiar filtros</Button></div>}
  </fieldset>;
}
