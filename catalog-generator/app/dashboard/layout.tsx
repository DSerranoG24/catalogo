"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { clearSession, getSession, useStoredSession } from "@/lib/api";
import BrandLogo from "@/components/brand/BrandLogo";
import EmailVerificationNotice from "@/components/auth/EmailVerificationNotice";
import PanelSidebar from "@/components/panel/PanelSidebar";
import AvatarMenu from "@/components/panel/AvatarMenu";
import MobileNav from "@/components/panel/MobileNav";
import { ACCOUNT_NAVIGATION } from "@/lib/account-navigation";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const accountNavigation = pathname === ACCOUNT_NAVIGATION.path ? ACCOUNT_NAVIGATION : null;
  const session = useStoredSession();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState("");
  // Inicio shows its own «Nueva venta»; on Vender it is redundant.
  const showNewSale = pathname !== "/dashboard" && !pathname.startsWith("/dashboard/ventas");

  useEffect(() => {
    // The server snapshot is null during hydration, even when browser metadata exists.
    if (!session && !getSession()) router.replace("/login");
  }, [router, session]);

  async function signOut() {
    if (signingOut) return;
    setSigningOut(true);
    setSignOutError("");
    if (await clearSession({ waitForServer: true })) {
      router.replace("/login");
      router.refresh();
    } else {
      setSignOutError("No se pudo cerrar la sesión del servidor. Comprueba tu conexión y vuelve a intentarlo.");
      setSigningOut(false);
    }
  }

  const backLink = accountNavigation && <nav aria-label="Volver desde cuenta" className="mx-auto mt-8 max-w-2xl px-5">
    <Link data-account-back-link href={accountNavigation.backHref} prefetch={false} className="inline-flex min-h-10 items-center gap-2 rounded text-sm font-semibold text-[#52675c] hover:text-[var(--brand-forest)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--brand-emerald)]">
      <span aria-hidden="true">←</span>{accountNavigation.backLabel}
    </Link>
  </nav>;

  // One stable tree: the account back link keeps its position before and after hydration (no remount).
  return (
    <div className={session ? "min-h-screen bg-[#F4F7FD]" : "min-h-screen"}>
      {session && <a href="#contenido" className="sr-only z-[60] rounded-xl bg-[var(--vy-blue-600)] px-4 py-3 font-semibold text-white focus:not-sr-only focus:fixed focus:left-4 focus:top-4">Saltar al contenido</a>}
      {session && <PanelSidebar pathname={pathname} />}
      <div className={session ? "min-w-0 pb-[calc(4rem+env(safe-area-inset-bottom))] lg:pb-0 lg:pl-64" : undefined}>
        {session && <header className="flex items-center justify-between gap-3 border-b border-[var(--vy-border)] bg-white/90 px-4 py-2.5 sm:px-8 lg:justify-end lg:border-b-0 lg:bg-transparent lg:pt-5">
          <Link href="/dashboard" aria-label="Vitrinaya, ir a Inicio" className="flex min-h-11 items-center rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--vy-blue-600)] lg:hidden">
            <BrandLogo variant="horizontal" theme="claro" iconSize={32} nameRatio={0.56} gapSize={8} />
          </Link>
          <div className="flex items-center gap-3">
            {showNewSale && <Link href="/dashboard/ventas" className="hidden min-h-11 items-center gap-2 rounded-xl bg-[var(--vy-blue-600)] px-4 text-sm font-semibold text-white shadow-[0_12px_24px_-14px_rgba(4,80,229,0.9)] transition hover:bg-[var(--vy-blue-700)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--vy-blue-600)] sm:inline-flex">
              <Plus aria-hidden="true" className="size-4" />Nueva venta
            </Link>}
            <AvatarMenu name={session.user.name} email={session.user.email} signingOut={signingOut} onSignOut={() => void signOut()} />
          </div>
        </header>}
        {session && signOutError && <p role="alert" className="mx-4 mt-4 rounded-xl border border-[#F4C7C2] bg-[#FEF3F2] px-4 py-3 text-sm text-[#B42318] sm:mx-8">{signOutError}</p>}
        {backLink}
        {session
          ? <div id="contenido" tabIndex={-1} className="outline-none"><EmailVerificationNotice />{children}</div>
          : <main className="mx-auto w-full max-w-6xl px-6 py-16 text-sm text-[#68756e]">Verificando sesión...</main>}
      </div>
      {session && <MobileNav pathname={pathname} signingOut={signingOut} onSignOut={() => void signOut()} />}
    </div>
  );
}
