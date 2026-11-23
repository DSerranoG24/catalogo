"use client";

import { useRef, useState } from "react";
import { ApiError, apiRequest } from "@/lib/api";
import { orderCustomerCommand, parseOrderCustomerMatches, parseOrderCustomerPreview, parseOrderCustomerResult, type CustomerPreview, type CustomerMatch, type ReviewFields } from "@/lib/order-customer-review.mjs";

export default function OrderCustomerReview({ orderId, onSaved }: { orderId: string; onSaved: () => void }) {
  const [preview, setPreview] = useState<CustomerPreview | null>(null);
  const [fields, setFields] = useState<ReviewFields | null>(null);
  const [matches, setMatches] = useState<CustomerMatch[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [matchPage, setMatchPage] = useState(1);
  const [matchingPhone, setMatchingPhone] = useState("");
  const [associateSale, setAssociateSale] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const lock = useRef(false);
  const pending = useRef<{ signature: string; operationId: string } | null>(null);
  const inputClass = "min-h-11 w-full rounded-lg border border-[#cbd7cc] bg-white p-2 text-[#202b27] focus-visible:outline-2 focus-visible:outline-[#167158]";

  async function open() {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(""); setMessage("");
    try {
      const response = await apiRequest<unknown>(`/orders/${orderId}/customer-preview`, { method: "POST", body: "{}" });
      if (typeof response !== "object" || response === null || !("result" in response)) throw new Error("No se pudo validar la revisión del pedido.");
      const result = parseOrderCustomerPreview(response.result);
      setPreview(result); setFields(result.fields); setMatches(result.matches); setHasMore(result.hasMore); setMatchPage(1); setMatchingPhone(result.matches[0]?.phone ?? ""); setAssociateSale(false); pending.current = null;
    } catch (error) { setError(error instanceof Error ? error.message : "No se pudo revisar el cliente del pedido."); }
    finally { lock.current = false; setBusy(false); }
  }
  async function confirm(selected: CustomerMatch | null = null) {
    if (!fields || lock.current) return;
    lock.current = true; setBusy(true); setError("");
    const command = orderCustomerCommand(fields, associateSale, selected);
    const signature = JSON.stringify(command);
    if (!pending.current || pending.current.signature !== signature) pending.current = { signature, operationId: crypto.randomUUID() };
    try {
      const response = await apiRequest<unknown>(`/orders/${orderId}/customer-confirm`, { method: "POST", body: JSON.stringify({ ...command, operationId: pending.current.operationId }) });
      if (typeof response !== "object" || response === null || !("result" in response)) throw new Error("No se pudo validar la confirmación. Reintenta con los mismos datos.");
      parseOrderCustomerResult(response.result, orderId);
      pending.current = null; setPreview(null); setFields(null); setMessage(selected ? "Cliente existente asociado al pedido." : "Cliente creado y asociado al pedido."); onSaved();
    } catch (error) {
      if (error instanceof ApiError && error.code === "CUSTOMER_PHONE_MATCH") {
        try {
          const details = error.details;
          if (typeof details !== "object" || details === null || !("matches" in details)) throw new Error("Respuesta inválida");
          const found = parseOrderCustomerMatches(details.matches);
          setMatches(found); setMatchingPhone(found[0]?.phone ?? ""); setMatchPage(1); setHasMore("hasMore" in details && details.hasMore === true);
        } catch { setError("No se pudieron validar las coincidencias. Cancela y vuelve a revisar el pedido."); return; }
      }
      setError(error instanceof Error ? error.message : "No se pudo guardar el cliente.");
    } finally { lock.current = false; setBusy(false); }
  }
  function edit(field: keyof ReviewFields, value: string) {
    setFields(current => current ? { ...current, [field]: value } : null); setMatches([]); setHasMore(false); setMatchPage(1); setMatchingPhone(""); setError("");
  }
  async function loadMatches(page: number) {
    if (lock.current || !matchingPhone) return;
    lock.current = true; setBusy(true); setError("");
    try {
      const response = await apiRequest<unknown>(`/orders/${orderId}/customer-matches?phone=${encodeURIComponent(matchingPhone)}&page=${page}`);
      if (typeof response !== "object" || response === null || !("result" in response) || typeof response.result !== "object" || response.result === null
        || !("matches" in response.result) || !("hasMore" in response.result) || typeof response.result.hasMore !== "boolean") throw new Error("No se pudo validar la página de coincidencias.");
      setMatches(parseOrderCustomerMatches(response.result.matches)); setHasMore(response.result.hasMore); setMatchPage(page);
    } catch (error) { setError(error instanceof Error ? error.message : "No se pudieron cargar las coincidencias."); }
    finally { lock.current = false; setBusy(false); }
  }
  const choices = preview?.existingCustomer && !preview.existingCustomer.archivedAt
    ? [preview.existingCustomer, ...matches.filter(customer => customer.id !== preview.existingCustomer?.id)] : matches;

  return <section className="mt-4 rounded-xl border border-[#e2e8e0] p-3" aria-label="Guardar comprador como cliente">
    {!preview && <button type="button" className="min-h-11 rounded-lg border px-3 font-semibold focus-visible:outline-2" disabled={busy} onClick={() => void open()}>{busy ? "Preparando revisión..." : "Guardar comprador como cliente"}</button>}
    {preview && fields && <form onSubmit={event => { event.preventDefault(); void confirm(); }} className="space-y-3">
      <h4 className="font-semibold">Revisar datos antes de guardar</h4>
      <p className="text-sm">Estos datos proceden del pedido. Corregirlos aquí no cambia el pedido ni los snapshots de la venta.</p>
      {preview.invalidFields.length > 0 && <p role="status" className="text-sm">Revisa especialmente: {preview.invalidFields.join(", ")}. El nombre y teléfono son obligatorios.</p>}
      <fieldset disabled={busy} className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm">Nombre completo<input required maxLength={160} className={inputClass} value={fields.fullName} onChange={event => edit("fullName", event.target.value)} /></label>
        <label className="grid gap-1 text-sm">Teléfono<input required type="tel" maxLength={40} className={inputClass} value={fields.phone} onChange={event => edit("phone", event.target.value)} /></label>
        <label className="grid gap-1 text-sm">Correo (opcional)<input type="email" maxLength={254} className={inputClass} value={fields.email ?? ""} onChange={event => edit("email", event.target.value)} /></label>
        <label className="grid gap-1 text-sm">Dirección (opcional)<input maxLength={300} className={inputClass} value={fields.address ?? ""} onChange={event => edit("address", event.target.value)} /></label>
        <label className="grid gap-1 text-sm sm:col-span-2">Notas (opcional)<textarea maxLength={2000} className={inputClass} value={fields.notes ?? ""} onChange={event => edit("notes", event.target.value)} /></label>
      </fieldset>
      {preview.sale && <label className="flex items-start gap-2 text-sm"><input type="checkbox" disabled={busy} checked={associateSale} onChange={event => setAssociateSale(event.target.checked)} />Asociar también a la venta existente, conservando sus snapshots históricos.</label>}
      {preview.existingCustomer?.archivedAt && <p role="status">El cliente ya guardado está archivado. Reactívalo en Clientes antes de usarlo.</p>}
      {choices.length > 0 && <p className="text-sm">Usar un cliente existente no sobrescribe su ficha con los datos revisados.</p>}
      {(choices.length > 0 || matchPage > 1) && <div className="space-y-2 rounded-lg border p-3"><p className="font-semibold">Cliente guardado o coincidencias de teléfono</p>{choices.map(customer => <div key={customer.id} className="flex flex-wrap items-center justify-between gap-2 text-sm"><span>{customer.fullName} · {customer.phone}{customer.email ? ` · ${customer.email}` : ""}</span><button type="button" disabled={busy} className="min-h-11 rounded border px-3 focus-visible:outline-2" onClick={() => void confirm(customer)}>Usar cliente existente</button></div>)}{(hasMore || matchPage > 1) && <nav aria-label="Páginas de coincidencias" className="flex gap-2"><button type="button" disabled={busy || matchPage === 1} className="min-h-11 rounded border px-3" onClick={() => void loadMatches(matchPage - 1)}>Anterior</button><span>Página {matchPage}</span><button type="button" disabled={busy || !hasMore} className="min-h-11 rounded border px-3" onClick={() => void loadMatches(matchPage + 1)}>Más coincidencias</button></nav>}</div>}
      <div className="flex flex-wrap gap-2"><button type="submit" disabled={busy || Boolean(preview.customerId) || Boolean(matchingPhone)} className="min-h-11 rounded-lg border px-3 font-semibold focus-visible:outline-2">{busy ? "Guardando..." : "Crear cliente"}</button><button type="button" disabled={busy} className="min-h-11 rounded-lg border px-3 focus-visible:outline-2" onClick={() => { setPreview(null); setFields(null); setError(""); pending.current = null; }}>Cancelar</button></div>
    </form>}
    {error && <p role="alert" className="mt-2 text-sm text-[#a5432a]">{error}</p>}{message && <p role="status" className="mt-2 text-sm">{message}</p>}
  </section>;
}
