"use client";

import { Button } from "@/components/ui/Button";
import Link from "next/link";

import { useEffect, useState } from "react";
import { apiRequest, OrderStatus } from "@/lib/api";
import OrderCustomerReview from "./OrderCustomerReview";
import { canReviewOrderCustomer } from "@/lib/order-customer-review.mjs";
import OrderPrivacyActions from "./OrderPrivacyActions";

type OrderItem = { productName: string; quantity: number; unitPrice: number; subtotal: number };
type ConversionMode = "DRAFT" | "CONFIRMED" | "DELIVERED";
type ConvertedSale = { id: string; status: string; version: number; total: string | number; lines: { itemName: string; quantity: number; unitPrice: string | number; unitDiscount: string | number; lineTotal: string | number }[] };
type CustomerOrder = {
  id: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string | null;
  customerAddress: string | null;
  customerConsentAt: string | null;
  customerConsentVersion: string | null;
  anonymizedAt: string | null;
  quotationSellerSnapshot: unknown;
  notes: string | null;
  status: OrderStatus;
  total: number;
  createdAt: string;
  quotationNumber: number | null;
  items: OrderItem[];
  convertedSale: ConvertedSale | null;
};

const labels: Record<OrderStatus, string> = {
  PENDING: "Pendiente",
  CONFIRMED: "Confirmada",
  COMPLETED: "Completada",
  CANCELLED: "Cancelada",
};

export default function OrdersPanel({ catalogId }: { catalogId: string }) {
  const [orders, setOrders] = useState<CustomerOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [updatingId, setUpdatingId] = useState("");
  const [convertingId, setConvertingId] = useState("");
  const [conversionOrderId, setConversionOrderId] = useState("");
  const [conversionMode, setConversionMode] = useState<ConversionMode>("DRAFT");
  const [priceConfirmationId, setPriceConfirmationId] = useState("");
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const cursor = cursors.at(-1);

  useEffect(() => {
    let active = true;
    apiRequest<{ orders: CustomerOrder[]; nextCursor?: string | null }>(`/orders/catalog/${catalogId}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`)
      .then((result) => {
        if (active) { setOrders(result.orders); setNextCursor(result.nextCursor ?? null); }
      })
      .catch((requestError) => {
        if (active) setError(requestError instanceof Error ? requestError.message : "No se pudieron cargar las órdenes.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [catalogId, cursor, reloadKey]);

  async function changeStatus(order: CustomerOrder, status: OrderStatus) {
    setUpdatingId(order.id);
    setError("");
    try {
      await apiRequest(`/orders/${order.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      setOrders((current) => current.map((item) => item.id === order.id ? { ...item, status } : item));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "No se pudo actualizar la orden.");
    } finally {
      setUpdatingId("");
    }
  }

  function conversionErrorMessage(code: string) {
    if (code.includes("STOCK_INSUFFICIENT")) return "No hay existencias suficientes para confirmar esta venta. Puedes convertirla como borrador o corregir el inventario.";
    if (code.includes("ORDER_ITEM_NOT_INVENTORY")) return "Uno o más productos del pedido no están vinculados al inventario.";
    if (code.includes("ORDER_STATUS_NOT_CONVERTIBLE")) return "Este pedido ya no se puede convertir por su estado actual.";
    if (code.includes("IDEMPOTENCY_CONFLICT")) return "La solicitud ya fue procesada con datos diferentes. Actualiza los pedidos antes de reintentar.";
    return code || "No se pudo convertir el pedido.";
  }

  async function convert(order: CustomerOrder, acceptPriceDifference = false) {
    setConvertingId(order.id); setError("");
    try {
      const response = await apiRequest<{ sale: ConvertedSale; idempotent: boolean }>(`/orders/${order.id}/convert-to-sale`, { method: "POST", body: JSON.stringify({ operationId: crypto.randomUUID(), requestId: crypto.randomUUID(), mode: conversionMode, acceptPriceDifference }) });
      setOrders(current => current.map(value => value.id === order.id ? { ...value, convertedSale: response.sale } : value));
      setConversionOrderId(""); setPriceConfirmationId("");
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : "No se pudo convertir el pedido.";
      if (message.includes("PRICE_DIFFERENCE_REQUIRES_CONFIRMATION")) setPriceConfirmationId(order.id);
      else setError(conversionErrorMessage(message));
    } finally { setConvertingId(""); }
  }

  function whatsappReceipt(order: CustomerOrder) {
    if (!order.convertedSale) return "";
    const lines = order.convertedSale.lines.map(item => `${item.quantity} × ${item.itemName}: $${Number(item.lineTotal).toLocaleString("es-CO")}`).join("\n");
    return `Comprobante de venta\nCliente: ${order.customerName}\n${lines}\nTotal: $${Number(order.convertedSale.total).toLocaleString("es-CO")} COP\nEstado: ${order.convertedSale.status}\nVenta: ${order.convertedSale.id}`;
  }

  if (loading) return <div aria-label="Cargando órdenes" className="mt-5 grid gap-3 animate-pulse">{[0, 1].map((item) => <div key={item} className="rounded-2xl border border-[#e2e8e0] bg-white p-5"><div className="h-4 w-40 rounded-full bg-[#e8eee5]" /><div className="mt-3 h-3 w-28 rounded-full bg-[#edf1ec]" /><div className="mt-6 h-16 rounded-xl bg-[#f2f5f0]" /></div>)}</div>;

  return (
    <section>
      <div className="flex items-end justify-between rounded-3xl border border-[#e2e8e0] bg-white p-5 shadow-[0_16px_44px_-38px_rgba(36,63,47,0.35)] sm:p-6">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--brand-coral-text)]">Solicitudes de clientes</p>
          <h2 className="mt-1 text-lg font-semibold tracking-tight text-[#202b27]">Órdenes recibidas</h2>
        </div>
        <Button variant="secondary" type="button" onClick={() => { setLoading(true); setReloadKey((key) => key + 1); }} >Actualizar</Button>
      </div>
      {error && <p role="alert" className="mt-4 rounded-md bg-[#fff1ec] px-4 py-3 text-sm text-[#a5432a]">{error}</p>}
      {orders.length === 0 ? (
        <div className="mt-4 rounded-3xl border border-dashed border-[#cbd7cc] bg-white/70 px-5 py-14 text-center">
          <h3 className="font-semibold text-[#202b27]">Aún no hay órdenes</h3>
          <p className="mt-1 text-sm text-[#68756e]">Las solicitudes enviadas desde tu catálogo aparecerán aquí.</p>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {orders.map((order) => (
            <article key={order.id} className="rounded-2xl border border-[#e2e8e0] bg-white p-4 shadow-[0_14px_36px_-34px_rgba(36,63,47,0.5)] sm:p-5">
              <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold text-[#202b27]">{order.customerName}</h3>
                    <span className="rounded-sm bg-[#edf3ec] px-2 py-1 text-[10px] font-semibold uppercase text-[#426257]">{labels[order.status]}</span>
                  </div>
                  <p className="mt-1 text-xs text-[#68756e]">{new Date(order.createdAt).toLocaleString("es-CO")}</p>
                  <p className="mt-1 text-xs text-[#68756e]">{order.quotationNumber != null ? `COT-${String(order.quotationNumber).padStart(6, "0")}` : "Sin cotización"}</p>
                  {order.customerPhone && <a href={`tel:${order.customerPhone}`} className="mt-2 inline-block text-sm font-medium text-[var(--brand-emerald)]">{order.customerPhone}</a>}
                  {order.customerEmail && <p className="mt-1 text-xs text-[#68756e]">{order.customerEmail}</p>}
                </div>
                <p className="text-lg font-semibold tabular-nums text-[#202b27]">${order.total.toLocaleString("es-CO")}</p>
              </div>

              <ul className="mt-4 space-y-2 border-y border-[#edf1ec] py-3 text-sm">
                {order.items.map((item, index) => <li key={`${order.id}-${index}`} className="flex justify-between gap-3 text-[#435047]"><span>{item.quantity} × {item.productName}</span><span className="shrink-0 tabular-nums">${item.subtotal.toLocaleString("es-CO")}</span></li>)}
              </ul>
              <p className="mt-3 text-sm leading-5 text-[#435047]">{order.customerAddress}</p>
              {order.customerConsentAt && <p className="mt-1 text-[11px] text-[#435047]">Consentimiento registrado · {new Date(order.customerConsentAt).toLocaleString("es-CO")} · {order.customerConsentVersion ?? "Versión no acreditada"}</p>}
              {order.notes && <p className="mt-2 text-xs leading-5 text-[#68756e]">Nota: {order.notes}</p>}
              {canReviewOrderCustomer(order) && <OrderCustomerReview orderId={order.id} onSaved={() => setReloadKey(key => key + 1)} />}
              <OrderPrivacyActions order={order} onChanged={() => { setLoading(true); setReloadKey(key => key + 1); }} />
              {order.convertedSale ? <div className="mt-4 rounded-xl border border-[#c9e0d1] bg-[#f2faf4] p-4"><p className="font-semibold text-[#276749]">Venta creada · {order.convertedSale.status}</p><p className="mt-1 text-sm">Total actual: ${Number(order.convertedSale.total).toLocaleString("es-CO")} COP</p><div className="mt-3 flex flex-wrap gap-3"><Link className="inline-flex min-h-11 items-center rounded-lg border px-3 font-semibold" href={`/dashboard/ventas/historial?venta=${order.convertedSale.id}`}>Abrir Ventas</Link><a className="inline-flex min-h-11 items-center rounded-lg border px-3 font-semibold" href={`https://wa.me/?text=${encodeURIComponent(whatsappReceipt(order))}`} target="_blank" rel="noreferrer">Enviar comprobante por WhatsApp</a></div><p className="mt-2 text-xs">Abrir WhatsApp no cambia el estado del pedido ni de la venta.</p></div> : order.status === "CANCELLED" || order.status === "COMPLETED" ? <p className="mt-4 text-sm text-[#68756e]">Este pedido no está disponible para conversión.</p> : <div className="mt-4"><Button variant="secondary" disabled={convertingId === order.id} onClick={() => { setConversionOrderId(current => current === order.id ? "" : order.id); setPriceConfirmationId(""); }}>Convertir a venta</Button>{conversionOrderId === order.id && <div className="mt-3 space-y-3 rounded-xl border border-[#e2e8e0] bg-[#fafcf9] p-4"><p className="text-sm">Se creará una venta vinculada. El borrador no descuenta stock; confirmar o entregar sí lo descuenta. Los precios actuales pueden ser diferentes a los del pedido.</p><label className="block text-sm font-medium">Modo<select className="mt-1 min-h-11 w-full rounded border p-2 sm:w-auto" value={conversionMode} onChange={event => { setConversionMode(event.target.value as ConversionMode); setPriceConfirmationId(""); }}><option value="DRAFT">Crear borrador</option><option value="CONFIRMED">Crear y confirmar</option><option value="DELIVERED">Confirmar y entregar</option></select></label>{priceConfirmationId === order.id ? <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3"><p>Los precios actuales son diferentes a los del pedido. La venta usará la ficha comercial vigente.</p><Button className="mt-2" disabled={convertingId === order.id} onClick={() => void convert(order, true)}>Aceptar precios actuales y convertir</Button></div> : <Button disabled={convertingId === order.id} loading={convertingId === order.id} onClick={() => void convert(order)}>Confirmar conversión</Button>}</div>}</div>}
              {order.status !== "COMPLETED" && order.status !== "CANCELLED" && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {order.status === "PENDING" && <Button variant="primary" disabled={updatingId === order.id} onClick={() => void changeStatus(order, "CONFIRMED")} >Confirmar</Button>}
                  {order.status === "CONFIRMED" && <Button variant="primary" disabled={updatingId === order.id} onClick={() => void changeStatus(order, "COMPLETED")} >Marcar completada</Button>}
                  <Button variant="destructive-ghost" disabled={updatingId === order.id} onClick={() => void changeStatus(order, "CANCELLED")} >Cancelar orden</Button>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
      {(cursors.length > 1 || nextCursor) && <nav aria-label="Páginas de pedidos" className="mt-5 flex flex-wrap items-center gap-3">
        <Button variant="secondary" disabled={loading || cursors.length === 1} onClick={() => { setError(""); setLoading(true); setCursors(current => current.slice(0, -1)); }}>Más recientes</Button>
        <span className="text-sm text-[#435047]">Página {cursors.length}</span>
        <Button variant="secondary" disabled={loading || !nextCursor} onClick={() => { if (nextCursor) { setError(""); setLoading(true); setCursors(current => [...current, nextCursor]); } }}>Más antiguos</Button>
      </nav>}
    </section>
  );
}
