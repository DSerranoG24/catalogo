"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, LogOut, SlidersHorizontal } from "lucide-react";
import { isEnabled, PANEL_NAVIGATION } from "@/lib/panel-navigation";

/** Account disclosure: name/email, Ajustes and Cerrar sesión. Escape and clicking outside close it. */
export default function AvatarMenu({ name, email, signingOut, onSignOut }: { name: string | null; email: string; signingOut: boolean; onSignOut: () => void }) {
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const display = name?.trim() || email;
  const initial = display.trim().charAt(0).toLocaleUpperCase("es-CO") || "?";
  const settings = PANEL_NAVIGATION.find(entry => entry.id === "ajustes");

  useEffect(() => {
    if (!open) return;
    wrapper.current?.querySelector<HTMLElement>("#avatar-menu a, #avatar-menu button")?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); button.current?.focus(); } };
    const onPointer = (event: PointerEvent) => { if (!wrapper.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("pointerdown", onPointer); };
  }, [open]);

  return (
    <div ref={wrapper} className="relative" onBlur={event => { if (!wrapper.current?.contains(event.relatedTarget as Node | null)) setOpen(false); }}>
      <button ref={button} type="button" aria-expanded={open} aria-controls="avatar-menu" aria-label="Menú de cuenta" onClick={() => setOpen(value => !value)}
        className="flex min-h-11 items-center gap-1.5 rounded-full p-0.5 pr-2 text-[var(--vy-text)] transition hover:bg-[var(--vy-surface-soft)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--vy-blue-600)]">
        <span aria-hidden="true" className="grid size-10 place-items-center rounded-full bg-[var(--vy-blue-600)] text-base font-semibold text-white">{initial}</span>
        <ChevronDown aria-hidden="true" className={`size-4 transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div id="avatar-menu" className="absolute right-0 top-full z-50 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-2xl border border-[var(--vy-border)] bg-white p-2 text-[var(--vy-text)] shadow-[0_24px_60px_-24px_rgba(1,28,79,0.45)]">
          <div className="px-3 py-2">
            {name?.trim() && <p className="truncate font-semibold">{name}</p>}
            <p className="truncate text-sm text-[var(--vy-text-muted)]">{email}</p>
          </div>
          <div className="my-1 h-px bg-[var(--vy-border)]" />
          {settings && isEnabled("ajustes") && (
            <Link href={settings.href} onClick={() => setOpen(false)} className="flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium hover:bg-[var(--vy-surface-soft)] focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-[var(--vy-blue-600)]">
              <SlidersHorizontal aria-hidden="true" className="size-4" />Ajustes
            </Link>
          )}
          <button type="button" disabled={signingOut} onClick={onSignOut} className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-medium hover:bg-[var(--vy-surface-soft)] focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-[var(--vy-blue-600)] disabled:cursor-wait disabled:opacity-60">
            <LogOut aria-hidden="true" className="size-4" />{signingOut ? "Cerrando sesión…" : "Cerrar sesión"}
          </button>
        </div>
      )}
    </div>
  );
}
