"use client";

import Link from "next/link";
import * as Sheet from "@radix-ui/react-dialog";
import { useState } from "react";
import { LogOut, Menu, X } from "lucide-react";
import { enabledEntries, isActive } from "@/lib/panel-navigation";

/** Mobile (< lg) bottom bar: the mobileBar entries plus «Más», a sheet with the rest and Cerrar sesión. */
export default function MobileNav({ pathname, signingOut, onSignOut }: { pathname: string; signingOut: boolean; onSignOut: () => void }) {
  const [open, setOpen] = useState(false);
  const entries = enabledEntries();
  const bar = entries.filter(entry => entry.mobileBar), more = entries.filter(entry => !entry.mobileBar);
  const moreActive = more.some(entry => isActive(entry, pathname));
  const item = "flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl text-xs font-medium transition focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--vy-blue-600)]";
  return (
    <nav aria-label="Principal" className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--vy-border)] bg-white/95 backdrop-blur lg:hidden" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
      <ul className="mx-auto grid max-w-xl grid-cols-4 px-2">
        {bar.map(entry => {
          const active = isActive(entry, pathname), Icon = entry.icon;
          return <li key={entry.id}><Link href={entry.href} aria-current={active ? "page" : undefined} className={`${item} ${active ? "text-[var(--vy-blue-600)]" : "text-[var(--vy-text-muted)]"}`}>
            <Icon aria-hidden="true" className="size-6" strokeWidth={active ? 2.25 : 1.9} />{entry.label}
          </Link></li>;
        })}
        <li>
          <Sheet.Root open={open} onOpenChange={setOpen}>
            <Sheet.Trigger className={`${item} w-full ${moreActive ? "text-[var(--vy-blue-600)]" : "text-[var(--vy-text-muted)]"}`}>
              <Menu aria-hidden="true" className="size-6" strokeWidth={moreActive ? 2.25 : 1.9} />Más
            </Sheet.Trigger>
            <Sheet.Portal>
              <Sheet.Overlay className="fixed inset-0 z-50 bg-[#011C4F]/40" />
              <Sheet.Content aria-describedby={undefined} className="fixed inset-x-0 bottom-0 z-50 max-h-[85vh] overflow-y-auto rounded-t-3xl bg-white px-4 pt-3 text-[var(--vy-text)] shadow-[0_-20px_60px_-30px_rgba(1,28,79,0.5)]" style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom))" }}>
                <div className="flex items-center justify-between px-2 pb-2">
                  <Sheet.Title className="text-lg font-semibold">Más opciones</Sheet.Title>
                  <Sheet.Close aria-label="Cerrar" className="grid size-11 place-items-center rounded-xl hover:bg-[var(--vy-surface-soft)] focus-visible:outline-2 focus-visible:outline-[var(--vy-blue-600)]"><X aria-hidden="true" className="size-5" /></Sheet.Close>
                </div>
                <ul className="space-y-1">
                  {more.map(entry => {
                    const active = isActive(entry, pathname), Icon = entry.icon;
                    return <li key={entry.id}><Link href={entry.href} aria-current={active ? "page" : undefined} onClick={() => setOpen(false)}
                      className={`flex min-h-12 items-center gap-3 rounded-xl px-3 font-medium focus-visible:outline-2 focus-visible:outline-[var(--vy-blue-600)] ${active ? "bg-[var(--vy-blue-600)] text-white" : "hover:bg-[var(--vy-surface-soft)]"}`}>
                      <Icon aria-hidden="true" className="size-5" />{entry.label}
                    </Link></li>;
                  })}
                  <li className="border-t border-[var(--vy-border)] pt-1">
                    <button type="button" disabled={signingOut} onClick={onSignOut} className="flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left font-medium hover:bg-[var(--vy-surface-soft)] focus-visible:outline-2 focus-visible:outline-[var(--vy-blue-600)] disabled:opacity-60">
                      <LogOut aria-hidden="true" className="size-5" />{signingOut ? "Cerrando sesión…" : "Cerrar sesión"}
                    </button>
                  </li>
                </ul>
              </Sheet.Content>
            </Sheet.Portal>
          </Sheet.Root>
        </li>
      </ul>
    </nav>
  );
}
