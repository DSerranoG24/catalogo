"use client";

import { Button } from "@/components/ui/Button";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { clearSession, getSession, useStoredSession } from "@/lib/api";
import BrandLogo from "@/components/brand/BrandLogo";
import EmailVerificationNotice from "@/components/auth/EmailVerificationNotice";

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
            <Link href="/dashboard/cuenta" className="inline-flex min-h-11 items-center text-sm text-[#263b31] underline">Cuenta</Link>
            <span className="hidden max-w-56 truncate text-sm text-[#68756e] sm:block">{session.user.name || session.user.email}</span>
            {!isCatalogList && <Button variant="secondary" type="button" onClick={signOut} >Cerrar sesión</Button>}
          </div>
        </div>
      </header>
      <EmailVerificationNotice />
      {children}
    </div>
  );
}
