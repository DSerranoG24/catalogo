"use client";

import { useRef, useState } from "react";
import { Plus, Search, User, X } from "lucide-react";
import { apiRequest, ApiError } from "@/lib/api";
import type { TicketCustomer } from "./useSellDraft";

export const focus = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--vy-blue-600)]";
const isCustomer = (value: unknown): value is TicketCustomer & { archivedAt: null } => {
  const v = value as Record<string, unknown> | null;
  return Boolean(v) && typeof v!.id === "string" && typeof v!.fullName === "string" && typeof v!.phone === "string" && v!.archivedAt === null;
};

/**
 * «Cliente (opcional) · Buscar o crear»: searches active customers (Enter or the button) and creates one with the
 * existing POST /customers (name and phone). Escape closes the results; the choice is optional.
 */
export default function CustomerField({ idPrefix, value, onChange, disabled }: { idPrefix: string; value: TicketCustomer | null; onChange: (customer: TicketCustomer | null) => void; disabled?: boolean }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TicketCustomer[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState(""), [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const version = useRef(0);

  async function search() {
    const current = ++version.current;
    setBusy(true); setError("");
    try {
      const reply = await apiRequest<{ customers?: unknown }>(`/customers?status=active&q=${encodeURIComponent(query.trim())}`);
      if (!Array.isArray(reply.customers) || !reply.customers.every(isCustomer)) throw new Error("No se pudo validar la lista de clientes.");
      if (current === version.current) setResults(reply.customers.map(c => ({ id: c.id, fullName: c.fullName, phone: c.phone })));
    } catch (cause) { if (current === version.current) setError(cause instanceof Error ? cause.message : "No se pudieron buscar clientes."); }
    finally { if (current === version.current) setBusy(false); }
  }
  async function create() {
    if (!name.trim() || !phone.trim()) { setError("Escribe el nombre y el teléfono del cliente."); return; }
    setBusy(true); setError("");
    try {
      const reply = await apiRequest<{ customer?: unknown }>("/customers", { method: "POST", body: JSON.stringify({ fullName: name, phone }) });
      if (!isCustomer(reply.customer)) throw new Error("No se pudo validar el cliente creado.");
      onChange({ id: reply.customer.id, fullName: reply.customer.fullName, phone: reply.customer.phone });
      setCreating(false); setName(""); setPhone(""); setResults(null); setQuery("");
    } catch (cause) {
      setError(cause instanceof ApiError && cause.status === 400 ? "Revisa el nombre y el teléfono (7 a 15 dígitos)." : cause instanceof Error ? cause.message : "No se pudo crear el cliente.");
    } finally { setBusy(false); }
  }

  if (value) return <div className="flex min-h-14 items-center gap-3 rounded-2xl border border-[var(--vy-border)] bg-[var(--vy-surface-soft)] px-3" data-ticket-customer>
    <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-full bg-white text-[var(--vy-blue-600)]"><User className="size-5" /></span>
    <span className="min-w-0 flex-1"><span className="block truncate font-semibold text-[var(--vy-text)]">{value.fullName}</span><span className="block text-sm text-[var(--vy-text-muted)]">{value.phone}</span></span>
    <button type="button" disabled={disabled} onClick={() => onChange(null)} aria-label={`Quitar al cliente ${value.fullName}`} className={`grid size-11 shrink-0 place-items-center rounded-xl text-[var(--vy-text-muted)] hover:bg-white disabled:opacity-50 ${focus}`}><X aria-hidden="true" className="size-5" /></button>
  </div>;

  // The form lives in the ticket column (22–27 rem) or the mobile sheet: one field per row, never side by side.
  return <div className="min-w-0 space-y-2" onKeyDown={event => { if (event.key === "Escape" && (results || creating)) { event.stopPropagation(); setResults(null); setCreating(false); } }}>
    <div className="flex items-center gap-2 rounded-2xl border border-[var(--vy-field-border)] bg-white pl-3 focus-within:border-[var(--vy-blue-600)] focus-within:ring-4 focus-within:ring-[#0450E5]/25">
      <User aria-hidden="true" className="size-5 shrink-0 text-[var(--vy-text-muted)]" />
      <label htmlFor={`${idPrefix}-customer-q`} className="sr-only">Cliente (opcional): buscar por nombre o teléfono</label>
      <input id={`${idPrefix}-customer-q`} maxLength={160} value={query} disabled={disabled} placeholder="Cliente (opcional) · Buscar o crear" autoComplete="off"
        onChange={event => { version.current++; setResults(null); setQuery(event.target.value); }}
        onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); void search(); } }}
        className="min-h-12 w-full min-w-0 bg-transparent text-[var(--vy-text)] outline-none placeholder:text-[var(--vy-text-subtle)]" />
      <button type="button" disabled={disabled || busy} onClick={() => void search()} aria-label="Buscar cliente" className={`grid size-11 shrink-0 place-items-center rounded-xl text-[var(--vy-text-muted)] hover:bg-[var(--vy-surface-soft)] ${focus}`}><Search aria-hidden="true" className="size-5" /></button>
      <button type="button" disabled={disabled || busy} onClick={() => { setCreating(open => !open); setResults(null); setName(query.trim()); }} aria-expanded={creating} aria-label="Crear cliente"
        className={`mr-1 grid size-10 shrink-0 place-items-center rounded-full bg-[var(--vy-blue-600)] text-white hover:bg-[var(--vy-blue-700)] ${focus}`}><Plus aria-hidden="true" className="size-5" /></button>
    </div>
    {results && <div role="group" aria-label="Clientes encontrados" className="rounded-2xl border border-[var(--vy-border)] bg-white p-1 shadow-[0_18px_40px_-28px_rgba(1,28,79,0.5)]">
      {results.length === 0 ? <p role="status" className="px-3 py-2 text-sm text-[var(--vy-text-muted)]">No hay clientes activos con esa búsqueda. Usa + para crearlo.</p>
        : results.map(c => <button key={c.id} type="button" onClick={() => { onChange(c); setResults(null); setQuery(""); }}
          className={`flex min-h-11 w-full items-center justify-between gap-3 rounded-xl px-3 text-left text-sm hover:bg-[var(--vy-surface-soft)] ${focus}`}>
          <span className="truncate font-semibold text-[var(--vy-text)]">{c.fullName}</span><span className="shrink-0 text-[var(--vy-text-muted)]">{c.phone}</span></button>)}
    </div>}
    {creating && <div role="group" aria-label="Crear cliente" className="grid min-w-0 gap-2 rounded-2xl border border-[var(--vy-border)] bg-white p-3">
      <label className="grid min-w-0 gap-1 text-sm font-medium text-[var(--vy-text)]">Nombre
        <input id={`${idPrefix}-new-name`} value={name} maxLength={160} onChange={e => setName(e.target.value)} className={`min-h-11 w-full min-w-0 rounded-xl border border-[var(--vy-field-border)] px-3 ${focus}`} /></label>
      <label className="grid min-w-0 gap-1 text-sm font-medium text-[var(--vy-text)]">Teléfono
        <input id={`${idPrefix}-new-phone`} value={phone} maxLength={40} inputMode="tel" onChange={e => setPhone(e.target.value)} className={`min-h-11 w-full min-w-0 rounded-xl border border-[var(--vy-field-border)] px-3 ${focus}`} /></label>
      <button type="button" disabled={busy} onClick={() => void create()} className={`min-h-11 rounded-xl bg-[var(--vy-blue-600)] px-4 font-semibold text-white hover:bg-[var(--vy-blue-700)] disabled:opacity-60 ${focus}`}>Crear y usar en la venta</button>
    </div>}
    {error && <p role="alert" className="text-sm text-[#B42318]">{error}</p>}
  </div>;
}
