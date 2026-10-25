"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { clearSession, getSession, useStoredSession } from "@/lib/api";
import BrandLogo from "@/components/brand/BrandLogo";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const isCatalogList = usePathname() === "/dashboard";
  const session = useStoredSession();

  useEffect(() => {
    // The server snapshot is null during hydration, even when browser metadata exists.
    if (!session && !getSession()) router.replace("/login");
  }, [router, session]);

  function signOut() {
    clearSession();
    router.replace("/login");
  }

  if (!session) {
    return <main className="mx-auto w-full max-w-6xl px-6 py-16 text-sm text-[#68756e]">Verificando sesión...</main>;
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-[#dce4dc] bg-white/90">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-4 sm:px-8">
          <Link href="/dashboard" className="inline-flex items-center gap-3">
            <BrandLogo variant="horizontal" theme="claro" iconSize={36} nameRatio={14 / 36} gapSize={12} />
          </Link>
          <div className="flex min-w-0 items-center gap-4">
            <span className="hidden max-w-56 truncate text-sm text-[#68756e] sm:block">{session.user.name || session.user.email}</span>
            {!isCatalogList && <button type="button" onClick={signOut} className="rounded-md border border-[#d6dfd7] px-3 py-2 text-xs font-semibold text-[#435047] transition hover:bg-[#f4f7f2] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-emerald)]">Cerrar sesión</button>}
          </div>
        </div>
      </header>
      {children}
    </div>
  );
}
