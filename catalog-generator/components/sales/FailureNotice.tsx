"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import type { CommandFailure } from "./useSaleCommand";

export default function FailureNotice({ failure, busy, onRetry, onReload, onRefreshPrices, reloadLabel = "Recargar", children }: {
  failure: Pick<CommandFailure, "title" | "detail" | "action">; busy: boolean; onRetry?: () => void; onReload?: () => void; onRefreshPrices?: () => void; reloadLabel?: string; children?: ReactNode;
}) {
  return <div role="alert" className="space-y-2 rounded-xl border border-[#efc2bd] bg-[#fdf0ee] p-4 text-[#5e1f17]">
    <p className="font-semibold">{failure.title}</p>
    <p className="text-sm">{failure.detail}</p>
    {children}
    <div className="flex flex-wrap gap-2">
      {failure.action === "retry" && onRetry && <Button variant="secondary" disabled={busy} onClick={onRetry}>Reintentar</Button>}
      {failure.action === "reload" && onReload && <Button variant="secondary" disabled={busy} onClick={onReload}>{reloadLabel}</Button>}
      {failure.action === "refreshPrices" && onRefreshPrices && <Button variant="secondary" disabled={busy} onClick={onRefreshPrices}>Recargar borrador con precios actuales</Button>}
      {failure.action === "login" && <Link href="/login" className="inline-flex min-h-11 items-center underline">Iniciar sesión</Link>}
    </div>
  </div>;
}
