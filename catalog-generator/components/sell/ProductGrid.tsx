"use client";

import Link from "next/link";
import { forwardRef } from "react";
import { AlertTriangle, Ban, Check, Minus, Package, Plus, Search, ShoppingCart } from "lucide-react";
import { availability, formatPesos, type PosItem } from "@/lib/pos-ui.mjs";
import { focus } from "./CustomerField";

const TONES = { out: "bg-[#FEF3F2] text-[#B42318]", low: "bg-[#FFF6ED] text-[#B93815]", ok: "text-[var(--vy-blue-700)]" } as const;

export const ProductSearch = forwardRef<HTMLInputElement, { value: string; onChange: (value: string) => void }>(function ProductSearch({ value, onChange }, ref) {
  return <div className="flex min-w-0 flex-1 items-center gap-2 rounded-2xl border border-[var(--vy-field-border)] bg-white px-4 focus-within:border-[var(--vy-blue-600)] focus-within:ring-4 focus-within:ring-[#0450E5]/25">
    <Search aria-hidden="true" className="size-5 shrink-0 text-[var(--vy-text-muted)]" />
    <label htmlFor="sell-search" className="sr-only">Buscar producto por nombre o SKU (F1)</label>
    <input ref={ref} id="sell-search" type="search" value={value} maxLength={160} autoComplete="off" placeholder="Buscar por nombre o SKU"
      onChange={event => onChange(event.target.value)} className="min-h-12 w-full min-w-0 bg-transparent text-[var(--vy-text)] outline-none placeholder:text-[var(--vy-text-subtle)]" />
    <kbd aria-hidden="true" className="hidden shrink-0 rounded-md border border-[var(--vy-border)] px-1.5 text-xs font-semibold text-[var(--vy-text-muted)] sm:inline">F1</kbd>
  </div>;
});

/** Thumbnail: the inventory list has no image URL yet, so the card shows the product's initial on a soft tile. */
function Thumb({ name, size = "lg" }: { name: string; size?: "lg" | "sm" }) {
  return <span aria-hidden="true" className={`grid shrink-0 place-items-center rounded-2xl bg-[linear-gradient(135deg,#EEF3FF,#DCE6FF)] font-bold text-[var(--vy-blue-600)] ${size === "lg" ? "h-24 w-full text-3xl" : "size-12 text-lg"}`}>
    {name.trim().charAt(0).toUpperCase() || <Package className="size-6" />}</span>;
}
export { Thumb };

export default function ProductGrid({ items, quantities, onAdd, onStep, disabled }: {
  items: PosItem[]; quantities: Map<string, number>; disabled: boolean;
  onAdd: (item: PosItem) => void; onStep: (item: PosItem, delta: number) => void;
}) {
  return <ul aria-label="Productos" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3">
    {items.map(item => {
      const inTicket = quantities.get(item.id) ?? 0, stock = availability(item.stock, item.minimumStock);
      const canAdd = !disabled && item.price !== null && item.stock > inTicket;
      // The ticket asks for more than there is now (another sale took it): the availability fact wins over «En el ticket».
      const short = inTicket > 0 && inTicket > item.stock;
      return <li key={item.id} data-product={item.sku} className={`relative flex flex-col gap-2 rounded-3xl border bg-white p-3 shadow-[0_18px_40px_-34px_rgba(1,28,79,0.6)] ${inTicket ? "border-2 border-[var(--vy-blue-600)]" : "border-[var(--vy-border)]"}`}>
        {inTicket > 0 && <span aria-hidden="true" className="absolute right-3 top-3 grid size-7 place-items-center rounded-full bg-[var(--vy-blue-600)] text-white"><Check className="size-4" /></span>}
        <Thumb name={item.name} />
        <h3 className="min-w-0 break-words font-semibold leading-snug text-[var(--vy-text)]">{item.name}</h3>
        <p className="-mt-1 truncate text-xs text-[var(--vy-text-muted)]">SKU {item.sku}</p>
        <div className="mt-auto flex flex-wrap items-end justify-between gap-2">
          <div className="min-w-0 space-y-1">
          <p className="text-lg font-bold text-[var(--vy-blue-600)]">{item.price === null ? <span className="text-sm font-semibold text-[var(--vy-text-muted)]">Sin precio</span> : formatPesos(item.price)}</p>
          {inTicket > 0 && !short
            ? <span className="flex items-center gap-1 text-xs font-semibold text-[var(--vy-blue-700)]"><ShoppingCart aria-hidden="true" className="size-4" />En el ticket: {inTicket}</span>
            : <span data-availability={stock.tone} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${TONES[stock.tone]}`}>
              {stock.tone === "out" ? <Ban aria-hidden="true" className="size-3.5" /> : stock.tone === "low" ? <AlertTriangle aria-hidden="true" className="size-3.5" /> : <Package aria-hidden="true" className="size-3.5" />}{stock.label}</span>}
          </div>
          {inTicket > 0
            ? <span className="flex items-center gap-1 rounded-full bg-[var(--vy-surface-soft)] p-0.5">
              <button type="button" disabled={disabled} onClick={() => onStep(item, -1)} aria-label={`Quitar una unidad de ${item.name}`} className={`grid size-9 place-items-center rounded-full text-[var(--vy-text)] hover:bg-white ${focus}`}><Minus aria-hidden="true" className="size-4" /></button>
              <span className="min-w-5 text-center font-semibold" aria-label={`${inTicket} en el ticket`}>{inTicket}</span>
              <button type="button" disabled={!canAdd} onClick={() => onStep(item, 1)} aria-label={`Agregar una unidad de ${item.name}`} className={`grid size-9 place-items-center rounded-full bg-[var(--vy-blue-600)] text-white disabled:opacity-40 ${focus}`}><Plus aria-hidden="true" className="size-4" /></button>
            </span>
            : <button type="button" disabled={!canAdd} onClick={() => onAdd(item)} aria-label={item.price === null ? `${item.name}: sin precio, configúralo en Inventario` : item.stock <= 0 ? `${item.name}: agotado` : `Agregar ${item.name} al ticket`}
              className={`grid size-11 place-items-center rounded-full bg-[var(--vy-blue-600)] text-white shadow-[0_10px_20px_-12px_rgba(4,80,229,0.9)] hover:bg-[var(--vy-blue-700)] disabled:bg-[#A9B5CC] disabled:shadow-none ${focus}`}><Plus aria-hidden="true" className="size-5" /></button>}
        </div>
      </li>;
    })}
    <li className="flex">
      <Link href="/dashboard/inventario" className={`flex min-h-48 w-full flex-col items-center justify-center gap-2 rounded-3xl border-2 border-dashed border-[#A9B5CC] bg-white/60 p-4 text-center hover:border-[var(--vy-blue-600)] ${focus}`}>
        <span aria-hidden="true" className="grid size-14 place-items-center rounded-full bg-[#E8EFFE] text-[var(--vy-blue-600)]"><Plus className="size-7" /></span>
        <span className="font-semibold text-[var(--vy-text)]">Producto nuevo</span><span className="text-sm text-[var(--vy-text-muted)]">Agregar al inventario</span>
      </Link>
    </li>
  </ul>;
}
