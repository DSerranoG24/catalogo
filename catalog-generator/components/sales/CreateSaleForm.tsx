"use client";

import { FormEvent, useRef, useState } from "react";
import { apiRequest } from "@/lib/api";

type Customer = { id: string; fullName: string; phone: string; archivedAt: null };
function isCustomer(value: unknown): value is Customer {
  return typeof value === "object" && value !== null && "id" in value && typeof value.id === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.id) && "fullName" in value && typeof value.fullName === "string"
    && "phone" in value && typeof value.phone === "string" && "archivedAt" in value && value.archivedAt === null;
}

export default function CreateSaleForm({ onCreated }: { onCreated: () => void }) {
  const [query, setQuery] = useState("");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [searching, setSearching] = useState(false);
  const [creating, setCreating] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [searched, setSearched] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const searchVersion = useRef(0);
  const createLock = useRef(false);
  const pending = useRef<{ customerId: string; operationId: string; requestId: string } | null>(null);

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const version = ++searchVersion.current;
    setSearching(true); setError("");
    try {
      const result = await apiRequest<unknown>(`/customers?status=active&q=${encodeURIComponent(query.trim())}`);
      if (typeof result !== "object" || result === null || !("customers" in result) || !Array.isArray(result.customers)
        || !result.customers.every(isCustomer) || !("hasMore" in result) || typeof result.hasMore !== "boolean") throw new Error("No se pudo validar la lista de clientes.");
      if (version !== searchVersion.current) return;
      setCustomers(result.customers); setCustomerId(""); setHasMore(result.hasMore === true); setSearched(true);
    } catch (error) {
      if (version === searchVersion.current) setError(error instanceof Error ? error.message : "No se pudieron buscar clientes.");
    } finally { if (version === searchVersion.current) setSearching(false); }
  }

  async function create() {
    if (createLock.current) return;
    createLock.current = true; setCreating(true); setError(""); setMessage("");
    if (!pending.current || pending.current.customerId !== customerId) pending.current = { customerId, operationId: crypto.randomUUID(), requestId: crypto.randomUUID() };
    const command = pending.current;
    try {
      await apiRequest("/sales", { method: "POST", body: JSON.stringify({ operationId: command.operationId, requestId: command.requestId, ...(command.customerId ? { customerId: command.customerId } : {}) }) });
      pending.current = null; setCustomerId(""); setMessage("Borrador de venta creado."); onCreated();
    } catch (error) {
      setError(error instanceof Error ? error.message : "No se pudo crear la venta.");
    } finally { createLock.current = false; setCreating(false); }
  }

  return <section aria-labelledby="new-sale-heading" className="space-y-3 rounded border p-4">
    <h2 id="new-sale-heading" className="font-semibold">Nueva venta</h2>
    <form onSubmit={search} className="flex flex-wrap items-end gap-2">
      <label className="grid gap-1">Buscar cliente (opcional)
        <input className="min-h-11 rounded border p-2 focus-visible:outline-2" maxLength={160} value={query} disabled={creating} onChange={event => { ++searchVersion.current; setSearching(false); setCustomers([]); setCustomerId(""); setSearched(false); setQuery(event.target.value); }} placeholder="Nombre o teléfono" />
      </label>
      <button className="min-h-11 rounded border p-2 focus-visible:outline-2" disabled={searching || creating}>{searching ? "Buscando..." : "Buscar clientes"}</button>
    </form>
    <label className="grid gap-1">Cliente de la venta
      <select className="min-h-11 rounded border p-2 focus-visible:outline-2" value={customerId} disabled={creating || searching} onChange={event => setCustomerId(event.target.value)}>
        <option value="">Sin cliente</option>
        {customers.map(customer => <option key={customer.id} value={customer.id}>{customer.fullName} · {customer.phone}</option>)}
      </select>
    </label>
    {searched && !customers.length && <p role="status">No se encontraron clientes activos.</p>}
    {hasMore && searched && <p>Se muestran los primeros 25 resultados. Afina la búsqueda para encontrar al cliente.</p>}
    <button type="button" className="min-h-11 rounded border p-2 focus-visible:outline-2" disabled={creating || searching} onClick={() => void create()}>{creating ? "Creando..." : "Crear borrador de venta"}</button>
    {message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}
  </section>;
}
