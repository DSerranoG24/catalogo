import type { Metadata } from "next";
import Link from "next/link";
import { requireAdminAccess } from "@/lib/admin.server";
import AdminMetricsPanel from "@/components/admin/AdminMetricsPanel";

// htmlLimitedBots blocks metadata for all UAs: deny before starting an HTML stream.
export async function generateMetadata(): Promise<Metadata> {
  await requireAdminAccess();
  return { title: "Administración | Vitrinaya" };
}
export default async function AdminPage() {
  await requireAdminAccess();
  return <main className="mx-auto w-full max-w-6xl px-5 py-12">
    <h1 className="text-2xl font-semibold text-[var(--brand-forest)]">Administración</h1>
    <p className="mt-3">Acceso autorizado.</p>
    <Link href="/dashboard" className="mt-5 inline-flex min-h-11 items-center rounded-lg font-semibold text-[var(--brand-emerald)] focus-visible:outline-2 focus-visible:outline-offset-4">Volver a mis catálogos</Link>
    <AdminMetricsPanel />
  </main>;
}
