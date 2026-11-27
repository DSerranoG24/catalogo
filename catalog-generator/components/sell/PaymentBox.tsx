"use client";

import { Banknote, CircleCheck, CreditCard, Heart, Landmark, Trash2 } from "lucide-react";
import { AmountInput } from "@/components/expenses/Sheet";
import { cashChange, formatPesos, METHOD_BUTTONS, METHOD_LABELS, TRANSFER_METHODS, type MethodButton, type PaymentRow, type PaymentStatus } from "@/lib/pos-ui.mjs";
import { focus } from "./CustomerField";

const ZERO = BigInt(0);
const ICONS = { CASH: Banknote, TRANSFER: Landmark, CARD: CreditCard, CREDIT: Heart } as const;
const buttonOf = (row: PaymentRow) => row.method === "CASH" ? "CASH" : row.method === "CARD" ? "CARD" : row.method === "CREDIT" ? "CREDIT" : "TRANSFER";

/**
 * «Cómo pagó»: tapping a method adds a row with what is still missing. Cash rows take «Recibido» and show «Cambio».
 * «Saldo a favor» only appears when the ticket's customer has some. Fiado is not offered until F2.
 * Used by Vender (against the ticket total) and by the sale detail (against the balance). The layout follows the
 * width of its own column (container queries), not the window: the ticket column is 22–27 rem on any desktop.
 * With more than what is due, «Pagar el total» trims the rows to exactly the amount due.
 */
export default function PaymentBox({ idPrefix, rows, status, credit, disabled, onAdd, onChange, onRemove, onPayTotal, legend = "¿Cómo pagó?" }: {
  idPrefix: string; rows: PaymentRow[]; status: PaymentStatus | null; credit: string | null; disabled: boolean;
  onAdd: (button: MethodButton) => void; onChange: (key: string, patch: Partial<PaymentRow>) => void; onRemove: (key: string) => void;
  onPayTotal?: () => void; legend?: string;
}) {
  const buttons = METHOD_BUTTONS.filter(b => b.id !== "CREDIT" || (credit !== null && BigInt(credit) > ZERO));
  return <fieldset disabled={disabled} className="@container min-w-0 space-y-3">
    <legend className="text-sm font-semibold text-[var(--vy-text)]">{legend}</legend>
    <div className={`grid gap-2 ${buttons.length === 4 ? "grid-cols-2 @md:grid-cols-4" : "grid-cols-2 @xs:grid-cols-3"}`} role="group" aria-label="Agregar pago">
      {buttons.map(button => {
        const Icon = ICONS[button.id], active = rows.some(row => buttonOf(row) === button.id);
        return <button key={button.id} type="button" onClick={() => onAdd(button)} aria-label={`Agregar pago: ${button.label}`}
          className={`flex min-h-16 flex-col items-center justify-center gap-1 rounded-2xl border text-sm font-semibold transition ${active ? "border-[var(--vy-blue-600)] bg-[#E8EFFE] text-[var(--vy-blue-700)]" : "border-[var(--vy-border)] bg-white text-[var(--vy-text)] hover:border-[var(--vy-blue-600)]"} disabled:opacity-60 ${focus}`}>
          <Icon aria-hidden="true" className="size-5" />{button.label}</button>;
      })}
    </div>
    {rows.length > 0 && <ul aria-label="Pagos" className="space-y-2">
      {rows.map((row, index) => {
        const change = cashChange(row), id = `${idPrefix}-pay-${row.key}`;
        return <li key={row.key} data-payment-row={row.method} className="min-w-0 space-y-2 rounded-2xl border border-[var(--vy-border)] bg-white p-3">
          <div className="flex items-end gap-2">
            <label htmlFor={id} className="grid min-w-0 flex-1 gap-1 text-sm font-medium text-[var(--vy-text)]">
              <span>{buttonOf(row) === "TRANSFER" ? "Transferencia" : METHOD_LABELS[row.method]} {rows.length > 1 && <span className="text-[var(--vy-text-muted)]">· pago {index + 1}</span>}</span>
              <AmountInput id={id} value={row.amount} placeholder="0" onChange={value => onChange(row.key, { amount: value })} />
            </label>
            <button type="button" onClick={() => onRemove(row.key)} aria-label={`Quitar pago ${index + 1} (${METHOD_LABELS[row.method]})`} className={`grid size-12 shrink-0 place-items-center rounded-xl text-[var(--vy-text-muted)] hover:bg-[var(--vy-surface-soft)] ${focus}`}><Trash2 aria-hidden="true" className="size-5" /></button>
          </div>
          {buttonOf(row) === "TRANSFER" && <div role="radiogroup" aria-label={`Medio de la transferencia del pago ${index + 1}`} className="flex flex-wrap gap-2">
            {TRANSFER_METHODS.map(method => <button key={method} type="button" role="radio" aria-checked={row.method === method} onClick={() => onChange(row.key, { method })}
              className={`min-h-11 rounded-xl border px-3 text-sm font-semibold ${row.method === method ? "border-[var(--vy-blue-600)] bg-[#E8EFFE] text-[var(--vy-blue-700)]" : "border-[var(--vy-border)] bg-white text-[var(--vy-text)]"} ${focus}`}>
              {method === "BANK_TRANSFER" ? "Banco" : METHOD_LABELS[method]}</button>)}
          </div>}
          {row.method === "CASH" && <div className="grid grid-cols-2 items-end gap-2">
            <label htmlFor={`${id}-received`} className="grid min-w-0 gap-1 text-sm font-medium text-[var(--vy-text)]">Recibido
              <AmountInput id={`${id}-received`} value={row.received} placeholder="Opcional" onChange={value => onChange(row.key, { received: value })} /></label>
            <p className="grid min-w-0 gap-1 text-sm font-medium text-[var(--vy-text)]">Cambio
              <output htmlFor={`${id}-received`} data-cash-change className="flex min-h-12 min-w-0 items-center overflow-hidden rounded-2xl bg-[#ECFDF3] px-4 text-xl font-bold text-[#067647]">{change === null ? "—" : formatPesos(change)}</output></p>
          </div>}
        </li>;
      })}
    </ul>}
    {status && <p role="status" data-payment-status className={`flex items-center justify-between rounded-2xl px-4 py-3 font-semibold ${status.complete ? "bg-[#ECFDF3] text-[#067647]" : status.excess > ZERO ? "bg-[#FEF3F2] text-[#B42318]" : "bg-[#FFF6ED] text-[#B93815]"}`}>
      {status.complete ? <span className="flex items-center gap-2"><CircleCheck aria-hidden="true" className="size-5" />Completo</span>
        : status.excess > ZERO ? <span>Sobran {formatPesos(status.excess)}</span> : <span>Falta {formatPesos(status.remaining)}</span>}
      <span className="text-sm font-medium">Pagado {formatPesos(status.paid)}</span>
    </p>}
    {status && status.excess > ZERO && onPayTotal && <button type="button" data-pay-total onClick={onPayTotal}
      className={`min-h-11 w-full rounded-xl border border-[var(--vy-blue-600)] bg-white px-3 font-semibold text-[var(--vy-blue-700)] hover:bg-[#E8EFFE] ${focus}`}>Pagar el total · {formatPesos(status.total)}</button>}
  </fieldset>;
}
