"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { formatAmountInput } from "@/lib/expenses-ui.mjs";

export const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--vy-blue-600)]";

/** Modal of the Gastos page (Radix: focus trap, Escape, focus return). Bottom sheet on mobile, centered from sm. */
export function Sheet({ open, onOpenChange, title, description, children }: { open: boolean; onOpenChange: (open: boolean) => void; title: string; description?: string; children: ReactNode }) {
  return <Dialog.Root open={open} onOpenChange={onOpenChange}>
    <Dialog.Portal>
      <Dialog.Overlay className="vy-theme fixed inset-0 z-50 bg-[#011C4F]/40" />
      <Dialog.Content {...(description ? {} : { "aria-describedby": undefined })} className="vy-theme fixed inset-x-0 bottom-0 z-50 max-h-[92vh] overflow-y-auto rounded-t-3xl bg-white p-5 text-[var(--vy-text)] shadow-[0_-20px_60px_-30px_rgba(1,28,79,0.5)] sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-[min(42rem,calc(100vw-2rem))] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-3xl sm:p-7"
        style={{ paddingBottom: "calc(1.25rem + env(safe-area-inset-bottom))" }}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <div><Dialog.Title className="text-xl font-semibold">{title}</Dialog.Title>{description && <Dialog.Description className="mt-1 text-sm text-[var(--vy-text-muted)]">{description}</Dialog.Description>}</div>
          <Dialog.Close aria-label="Cerrar" className={`grid size-11 shrink-0 place-items-center rounded-xl hover:bg-[var(--vy-surface-soft)] ${focusRing}`}><X aria-hidden="true" className="size-5" /></Dialog.Close>
        </div>
        {children}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}

/** Amount in pesos with Colombian thousands separators while typing; the caret stays after the same digit. */
export function AmountInput({ id, value, onChange, placeholder = "150.000", large = false }: { id: string; value: string; onChange: (value: string) => void; placeholder?: string; large?: boolean }) {
  const ref = useRef<HTMLInputElement>(null), caret = useRef<number | null>(null);
  useLayoutEffect(() => {
    const input = ref.current, position = caret.current;
    caret.current = null;
    if (input && position !== null && document.activeElement === input) input.setSelectionRange(position, position);
  });
  return <span className="flex items-center gap-2 rounded-2xl border border-[var(--vy-field-border)] bg-white px-4 focus-within:border-[var(--vy-blue-600)] focus-within:ring-4 focus-within:ring-[#0450E5]/25">
    <span aria-hidden="true" className={`${large ? "text-3xl" : "text-xl"} font-bold text-[var(--vy-text-muted)]`}>$</span>
    <input ref={ref} id={id} inputMode="numeric" autoComplete="off" placeholder={placeholder} value={value}
      onChange={e => { const next = formatAmountInput(e.target.value, e.target.selectionStart ?? e.target.value.length, value, (e.nativeEvent as InputEvent).inputType); caret.current = next.caret; onChange(next.value); }}
      className={`${large ? "min-h-16 text-3xl" : "min-h-12 text-xl"} w-full min-w-0 bg-transparent font-bold tracking-tight text-[var(--vy-text)] outline-none placeholder:text-[var(--vy-text-subtle)]`} />
  </span>;
}

/** Select styled for the panel (blue focus, no old palette). */
export const panelSelect = "min-h-11 w-full rounded-xl border border-[var(--vy-field-border)] bg-white px-3 text-base text-[var(--vy-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--vy-blue-600)]";
