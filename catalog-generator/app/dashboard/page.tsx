"use client";

import Link from "next/link";
import { CircleDollarSign, Package, Plus } from "lucide-react";
import { useStoredSession } from "@/lib/api";
import { isEnabled } from "@/lib/panel-navigation";

/** Long date in Spanish for Bogotá, e.g. «Miércoles 25 de noviembre de 2026». */
function longBogotaDate(now = new Date()) {
  const text = new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(now).replace(",", "");
  return text.charAt(0).toLocaleUpperCase("es-CO") + text.slice(1);
}

/** Provisional Inicio: greeting, date and quick actions. Data cards arrive in a later phase. */
export default function HomePage() {
  const session = useStoredSession();
  const firstName = session?.user.name?.trim().split(/\s+/)[0];
  const actions = [
    ...(isEnabled("gastos") ? [{ href: "/dashboard/gastos", label: "Registrar gasto", Icon: CircleDollarSign }] : []),
    { href: "/dashboard/inventario", label: "Agregar producto", Icon: Package },
  ];
  return (
    <main className="mx-auto w-full max-w-6xl px-5 py-6 sm:px-8 lg:py-4">
      <div className="flex flex-wrap items-center justify-between gap-5">
        <div className="flex items-center gap-4">
          <span aria-hidden="true" className="text-4xl sm:text-5xl">👋</span>
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-[var(--vy-text)] sm:text-4xl">{firstName ? `Hola, ${firstName}` : "Hola"}</h1>
            <p className="mt-1 text-base text-[var(--vy-text-muted)] sm:text-lg">{longBogotaDate()}</p>
          </div>
        </div>
        <Link href="/dashboard/ventas" className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-[var(--vy-blue-600)] px-5 text-base font-semibold text-white shadow-[0_14px_28px_-14px_rgba(4,80,229,0.9)] transition hover:bg-[var(--vy-blue-700)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--vy-blue-600)]">
          <Plus aria-hidden="true" className="size-5" />Nueva venta
        </Link>
      </div>
      <section aria-labelledby="quick-actions" className="mt-8">
        <h2 id="quick-actions" className="sr-only">Acciones rápidas</h2>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {actions.map(({ href, label, Icon }) => (
            <li key={href}>
              <Link href={href} className="flex min-h-14 items-center gap-3 rounded-2xl border border-[var(--vy-border)] bg-white px-5 font-semibold text-[var(--vy-text)] shadow-[0_8px_24px_-18px_rgba(1,28,79,0.5)] transition hover:border-[var(--vy-blue-600)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--vy-blue-600)]">
                <Icon aria-hidden="true" className="size-6 text-[var(--vy-blue-600)]" />{label}
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
