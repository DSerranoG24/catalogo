"use client";

import Link from "next/link";
import { Clock, ShoppingCart, Store } from "lucide-react";
import { focus } from "./CustomerField";

const TABS = [
  { id: "new", href: "/dashboard/ventas", label: "Nueva venta", Icon: ShoppingCart },
  { id: "orders", href: "/dashboard/catalogos", label: "Pedidos", Icon: Store },
  { id: "history", href: "/dashboard/ventas/historial", label: "Historial", Icon: Clock },
] as const;

/** Header of Vender (Nueva venta and Historial): blue tile, title and the three tabs. «Pedidos» still opens Catálogos. */
export default function VenderHeader({ current, title, subtitle }: { current: "new" | "history"; title: string; subtitle: string }) {
  return <div className="flex flex-wrap items-center justify-between gap-4">
    <div className="flex min-w-0 items-center gap-4">
      <span aria-hidden="true" className="grid size-14 shrink-0 place-items-center rounded-2xl bg-[linear-gradient(135deg,#EEF3FF,#DCE6FF)] text-[var(--vy-blue-600)] shadow-[0_12px_24px_-16px_rgba(4,80,229,0.7)]">
        {current === "new" ? <ShoppingCart className="size-7" /> : <Clock className="size-7" />}</span>
      <div className="min-w-0"><h1 className="text-3xl font-bold tracking-tight text-[var(--vy-text)] sm:text-4xl">{title}</h1><p className="text-base text-[var(--vy-text-muted)]">{subtitle}</p></div>
    </div>
    <nav aria-label="Vender" className="flex w-full gap-1 rounded-2xl bg-white p-1 shadow-[0_12px_30px_-24px_rgba(1,28,79,0.6)] sm:w-auto">
      {TABS.map(({ id, href, label, Icon }) => <Link key={href} href={href} aria-current={id === current ? "page" : undefined}
        className={`flex min-h-12 min-w-0 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-xl px-1.5 text-[13px] font-semibold sm:flex-none sm:px-4 sm:text-sm ${id === current ? "bg-[var(--vy-blue-600)] text-white" : "text-[var(--vy-text)] hover:bg-[var(--vy-surface-soft)]"} ${focus}`}>
        <Icon aria-hidden="true" className="hidden size-5 sm:block" />{label}</Link>)}
    </nav>
  </div>;
}
