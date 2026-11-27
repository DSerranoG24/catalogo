import { Suspense } from "react";
import HistoryPanel from "@/components/history/HistoryPanel";

// Vender › Historial (F2a-3b). The detail of a sale has its own link: ?venta=<id>. useSearchParams needs Suspense.
export default function SalesHistoryPage() {
  return <Suspense fallback={<main className="vy-theme mx-auto w-full max-w-7xl px-4 pt-5 sm:px-8"><p role="status" className="text-sm text-[var(--vy-text-muted)]">Cargando historial…</p></main>}><HistoryPanel /></Suspense>;
}
