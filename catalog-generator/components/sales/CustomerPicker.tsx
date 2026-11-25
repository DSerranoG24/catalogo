"use client";

import { useRef, useState } from "react";
import { apiRequest } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

export type PickedCustomer = { id: string; fullName: string; phone: string };
function isCustomer(value: unknown): value is PickedCustomer & { archivedAt: null } {
  return typeof value === "object" && value !== null && "id" in value && typeof value.id === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.id) && "fullName" in value && typeof value.fullName === "string"
    && "phone" in value && typeof value.phone === "string" && "archivedAt" in value && value.archivedAt === null;
}
export const selectClass = "min-h-11 w-full rounded-[var(--radius-medium)] border border-[var(--field-border)] bg-white px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-emerald)]";

/** Searches active customers on demand; "Sin cliente" is always available. */
export default function CustomerPicker({ idPrefix, value, onChange, disabled }: { idPrefix: string; value: PickedCustomer | null; onChange: (customer: PickedCustomer | null) => void; disabled?: boolean }) {
  const [query, setQuery] = useState("");
  const [customers, setCustomers] = useState<PickedCustomer[]>([]);
  const [searched, setSearched] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const version = useRef(0);

  async function search() {
    const current = ++version.current;
    setSearching(true); setError("");
    try {
      const result = await apiRequest<unknown>(`/customers?status=active&q=${encodeURIComponent(query.trim())}`);
      if (typeof result !== "object" || result === null || !("customers" in result) || !Array.isArray(result.customers)
        || !result.customers.every(isCustomer) || !("hasMore" in result) || typeof result.hasMore !== "boolean") throw new Error("No se pudo validar la lista de clientes.");
      if (current !== version.current) return;
      setCustomers(result.customers); setHasMore(result.hasMore); setSearched(true);
    } catch (cause) { if (current === version.current) setError(cause instanceof Error ? cause.message : "No se pudieron buscar clientes."); }
    finally { if (current === version.current) setSearching(false); }
  }
  const options = value && !customers.some(c => c.id === value.id) ? [value, ...customers] : customers;
  return <div className="space-y-2">
    <div className="flex flex-wrap items-end gap-2">
      <label htmlFor={`${idPrefix}-customer-q`} className="grid min-w-0 flex-1 gap-1 text-sm font-medium">Buscar cliente (opcional)
        <Input id={`${idPrefix}-customer-q`} maxLength={160} value={query} disabled={disabled} placeholder="Nombre o teléfono"
          onChange={event => { version.current++; setSearching(false); setSearched(false); setCustomers([]); setQuery(event.target.value); }}
          onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); void search(); } }} />
      </label>
      <Button variant="secondary" disabled={disabled || searching} loading={searching} onClick={() => void search()}>Buscar clientes</Button>
    </div>
    <label htmlFor={`${idPrefix}-customer`} className="grid gap-1 text-sm font-medium">Cliente de la venta
      <select id={`${idPrefix}-customer`} className={selectClass} disabled={disabled || searching} value={value?.id ?? ""}
        onChange={event => onChange(options.find(c => c.id === event.target.value) ?? null)}>
        <option value="">Sin cliente</option>
        {options.map(customer => <option key={customer.id} value={customer.id}>{customer.fullName} · {customer.phone}</option>)}
      </select>
    </label>
    {searched && !customers.length && <p role="status" className="text-sm">No se encontraron clientes activos.</p>}
    {searched && hasMore && <p className="text-sm">Se muestran los primeros 25 resultados. Afina la búsqueda para encontrar al cliente.</p>}
    {error && <p role="alert" className="text-sm text-[#8a2b20]">{error}</p>}
  </div>;
}
