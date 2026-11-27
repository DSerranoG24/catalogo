import Link from "next/link";
import { CheckCircle2, Circle, History, ShieldCheck } from "lucide-react";
import { STATUS_LABELS, STATUS_TONES } from "@/lib/sales-ui.mjs";
import { bogotaTime, formatCop, movementTime, type DashboardSummary } from "@/lib/dashboard-ui.mjs";
import { isEnabled } from "@/lib/panel-navigation";

const card = "rounded-2xl border border-[var(--vy-border)] bg-white p-5 shadow-[0_10px_30px_-24px_rgba(1,28,79,0.5)]";

/** Latest sales. Ventas has no direct link to one sale, so rows are not links; the header links to Vender. */
export function RecentSales({ recent, today }: { recent: DashboardSummary["recent"]; today: string }) {
  return <section aria-labelledby="recent-title" className={card}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 id="recent-title" className="flex items-center gap-3 text-lg font-semibold text-[var(--vy-text)]"><History aria-hidden="true" className="size-6 text-[var(--vy-blue-600)]" />Últimos movimientos</h2>
      {isEnabled("vender") && <Link href="/dashboard/ventas/historial" className="inline-flex min-h-11 items-center text-sm font-semibold text-[var(--vy-blue-600)] underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--vy-blue-600)]">Ver ventas</Link>}
    </div>
    {recent.length ? <ul className="mt-2 divide-y divide-[var(--vy-border)]">
      {recent.map(sale => <li key={sale.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3">
        <span className={`inline-flex min-h-7 items-center rounded-full border px-2.5 text-xs font-semibold ${STATUS_TONES[sale.status]}`}>{STATUS_LABELS[sale.status]}</span>
        <span className="min-w-0 flex-1 truncate font-medium text-[var(--vy-text)]">{sale.customerName ?? "Sin cliente"}</span>
        <span className="text-sm text-[var(--vy-text-muted)]">{movementTime(sale.at, today)}</span>
        <span className={`w-full text-right font-semibold sm:w-auto ${sale.status === "CANCELLED" ? "text-[var(--vy-text-muted)] line-through" : "text-[var(--vy-text)]"}`}>{formatCop(sale.total)}</span>
      </li>)}
    </ul> : <p className="mt-3 text-[var(--vy-text-muted)]">Todavía no hay ventas confirmadas.</p>}
  </section>;
}

/** Shown while any setup task is pending; figures stay visible below. */
export function FirstSteps({ setup }: { setup: DashboardSummary["setup"] }) {
  const tasks = [
    isEnabled("inventario") && { key: "inventory", done: setup.hasInventoryItems, text: "Registra tu primer artículo en Inventario", href: "/dashboard/inventario" },
    isEnabled("catalogo") && { key: "catalog", done: setup.hasPublishedCatalog, text: "Publica un catálogo con productos activos", href: "/dashboard/catalogos" },
    isEnabled("vender") && { key: "sale", done: setup.hasSales, text: "Registra tu primera venta", href: "/dashboard/ventas" },
  ].filter(task => task !== false);
  if (tasks.every(task => task.done)) return null;
  return <section aria-labelledby="first-steps-title" className={`${card} border-[#D6E2FF] bg-[linear-gradient(135deg,#FFFFFF,#F3F7FF)]`}>
    <h2 id="first-steps-title" className="text-lg font-semibold text-[var(--vy-text)]">Primeros pasos</h2>
    <p className="mt-1 text-sm text-[var(--vy-text-muted)]">Completa estas tareas para empezar a ver cifras de tu negocio.</p>
    <ol className="mt-3 grid gap-2 md:grid-cols-3">
      {tasks.map(task => <li key={task.key}>
        <Link href={task.href} className="flex min-h-14 items-center gap-3 rounded-xl border border-[var(--vy-border)] bg-white px-4 py-2 transition hover:border-[var(--vy-blue-600)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--vy-blue-600)]">
          {task.done ? <CheckCircle2 aria-hidden="true" className="size-6 shrink-0 text-[#15803D]" /> : <Circle aria-hidden="true" className="size-6 shrink-0 text-[var(--vy-text-muted)]" />}
          <span className="min-w-0 flex-1">
            <span className="block font-medium text-[var(--vy-text)]">{task.text}</span>
            <span className={`text-xs font-semibold ${task.done ? "text-[#166534]" : "text-[var(--vy-text-muted)]"}`}>{task.done ? "Hecho" : "Pendiente"}</span>
          </span>
        </Link>
      </li>)}
    </ol>
  </section>;
}

/** Footer with the connection state and the time of the figures shown (Bogotá). */
export function HomeFooter({ generatedAt, connected }: { generatedAt: string | null; connected: boolean }) {
  return <footer className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--vy-border)] bg-white/80 px-5 py-3 text-sm text-[var(--vy-text-muted)]">
    <p className="flex items-center gap-2 text-[var(--vy-text)]"><ShieldCheck aria-hidden="true" className="size-5 text-[#15803D]" />Tu negocio está seguro con Vitrinaya</p>
    <p className="flex flex-wrap items-center gap-3">
      <span className="flex items-center gap-1.5"><span aria-hidden="true" className={`size-2.5 rounded-full ${connected ? "bg-[#16A34A]" : "bg-[#DC2626]"}`} />{connected ? "Conectado" : "Sin conexión"}</span>
      {generatedAt && <><span aria-hidden="true" className="h-4 w-px bg-[var(--vy-border)]" /><span>Última actualización: {bogotaTime(generatedAt)}</span></>}
    </p>
  </footer>;
}
