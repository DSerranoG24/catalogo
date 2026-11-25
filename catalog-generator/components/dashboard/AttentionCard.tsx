import Link from "next/link";
import { AlertTriangle, Bell, CheckCircle2, PackageX, PlusCircle } from "lucide-react";
import { plural, type DashboardSummary } from "@/lib/dashboard-ui.mjs";
import { isEnabled } from "@/lib/panel-navigation";

/** Rows only for modules that exist; zero rows are hidden. Fiados and equipos are not shown (no module). */
export default function AttentionCard({ attention, ordersHref }: { attention: DashboardSummary["attention"]; ordersHref: string }) {
  const rows = [
    isEnabled("inventario") && attention.lowStockCount > 0 && { key: "low", icon: <AlertTriangle className="size-6 text-[#B45309]" />, text: plural(attention.lowStockCount, "producto con stock bajo", "productos con stock bajo"), href: "/dashboard/inventario", action: "Ver" },
    isEnabled("inventario") && attention.outOfStockCount > 0 && { key: "out", icon: <PackageX className="size-6 text-[#B42318]" />, text: plural(attention.outOfStockCount, "producto agotado", "productos agotados"), href: "/dashboard/inventario", action: "Ver" },
    isEnabled("catalogo") && attention.pendingOrdersCount > 0 && { key: "orders", icon: <PlusCircle className="size-6 text-[#15803D]" />, text: plural(attention.pendingOrdersCount, "pedido nuevo", "pedidos nuevos"), href: ordersHref, action: "Revisar" },
  ].filter(row => row !== false);
  return <section aria-labelledby="attention-title" className="rounded-2xl border border-[var(--vy-border)] bg-white p-5 shadow-[0_10px_30px_-24px_rgba(1,28,79,0.5)]">
    <h2 id="attention-title" className="flex items-center gap-3 text-lg font-semibold text-[var(--vy-text)]"><Bell aria-hidden="true" className="size-6 text-[var(--vy-blue-600)]" />Requiere tu atención</h2>
    {rows.length ? <ul className="mt-3 divide-y divide-[var(--vy-border)]">
      {rows.map(row => <li key={row.key} className="flex items-center gap-3 py-2.5">
        <span aria-hidden="true" className="shrink-0">{row.icon}</span>
        <span className="min-w-0 flex-1 font-medium text-[var(--vy-text)]">{row.text}</span>
        <Link href={row.href} aria-label={`${row.action}: ${row.text}`} className="inline-flex min-h-11 min-w-20 items-center justify-center rounded-full bg-[#E6EEFF] px-4 text-sm font-semibold text-[var(--vy-blue-600)] transition hover:bg-[#D6E2FF] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--vy-blue-600)]">{row.action}</Link>
      </li>)}
    </ul> : <p className="mt-4 flex items-center gap-3 rounded-xl bg-[#F2FBF5] px-4 py-4 font-medium text-[#166534]"><CheckCircle2 aria-hidden="true" className="size-6 shrink-0" />Todo en orden</p>}
  </section>;
}
