"use client";

import { useEffect, useState } from "react";
import { apiRequest, OrderStatus } from "@/lib/api";

type OrderItem = { productName: string; quantity: number; unitPrice: number; subtotal: number };
type CustomerOrder = {
  id: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string | null;
  customerAddress: string;
  customerConsentAt: string | null;
  notes: string | null;
  status: OrderStatus;
  total: number;
  createdAt: string;
  items: OrderItem[];
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

  useEffect(() => {
    let active = true;
    apiRequest<{ orders: CustomerOrder[] }>(`/orders/catalog/${catalogId}`)
      .then((result) => {
        if (active) setOrders(result.orders);
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
  }, [catalogId, reloadKey]);

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

  if (loading) return <p className="py-8 text-sm text-[#68756e]">Cargando órdenes...</p>;

  return (
    <section>
      <div className="flex items-end justify-between border-b border-[#dce4dc] pb-3">
        <div>
          <p className="text-xs font-semibold uppercase text-[#c65c3d]">Solicitudes de clientes</p>
          <h2 className="mt-1 text-lg font-semibold text-[#202b27]">Órdenes recibidas</h2>
        </div>
        <button type="button" onClick={() => { setLoading(true); setReloadKey((key) => key + 1); }} className="text-xs font-semibold text-[#17665c] hover:underline">Actualizar</button>
      </div>
      {error && <p role="alert" className="mt-4 rounded-md bg-[#fff1ec] px-4 py-3 text-sm text-[#a5432a]">{error}</p>}
      {orders.length === 0 ? (
        <div className="mt-5 rounded-lg border border-dashed border-[#cbd7cc] bg-white/70 px-5 py-12 text-center">
          <h3 className="font-semibold text-[#202b27]">Aún no hay órdenes</h3>
          <p className="mt-1 text-sm text-[#68756e]">Las solicitudes enviadas desde tu catálogo aparecerán aquí.</p>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {orders.map((order) => (
            <article key={order.id} className="rounded-lg border border-[#dce4dc] bg-white p-4 sm:p-5">
              <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold text-[#202b27]">{order.customerName}</h3>
                    <span className="rounded-sm bg-[#edf3ec] px-2 py-1 text-[10px] font-semibold uppercase text-[#426257]">{labels[order.status]}</span>
                  </div>
                  <p className="mt-1 text-xs text-[#68756e]">{new Date(order.createdAt).toLocaleString("es-CO")}</p>
                  <a href={`tel:${order.customerPhone}`} className="mt-2 inline-block text-sm font-medium text-[#17665c]">{order.customerPhone}</a>
                  {order.customerEmail && <p className="mt-1 text-xs text-[#68756e]">{order.customerEmail}</p>}
                </div>
                <p className="text-lg font-semibold tabular-nums text-[#202b27]">${order.total.toLocaleString("es-CO")}</p>
              </div>

              <ul className="mt-4 space-y-2 border-y border-[#edf1ec] py-3 text-sm">
                {order.items.map((item, index) => <li key={`${order.id}-${index}`} className="flex justify-between gap-3 text-[#435047]"><span>{item.quantity} × {item.productName}</span><span className="shrink-0 tabular-nums">${item.subtotal.toLocaleString("es-CO")}</span></li>)}
              </ul>
              <p className="mt-3 text-sm leading-5 text-[#435047]">{order.customerAddress}</p>
              {order.customerConsentAt && <p className="mt-1 text-[11px] text-[#849087]">Consentimiento registrado · {new Date(order.customerConsentAt).toLocaleString("es-CO")}</p>}
              {order.notes && <p className="mt-2 text-xs leading-5 text-[#68756e]">Nota: {order.notes}</p>}
              {order.status !== "COMPLETED" && order.status !== "CANCELLED" && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {order.status === "PENDING" && <button disabled={updatingId === order.id} onClick={() => void changeStatus(order, "CONFIRMED")} className="rounded-md bg-[#17665c] px-3 py-2 text-xs font-semibold text-white disabled:opacity-60">Confirmar</button>}
                  {order.status === "CONFIRMED" && <button disabled={updatingId === order.id} onClick={() => void changeStatus(order, "COMPLETED")} className="rounded-md bg-[#17665c] px-3 py-2 text-xs font-semibold text-white disabled:opacity-60">Marcar completada</button>}
                  <button disabled={updatingId === order.id} onClick={() => void changeStatus(order, "CANCELLED")} className="rounded-md border border-[#e6c7bc] px-3 py-2 text-xs font-semibold text-[#a5432a] disabled:opacity-60">Cancelar orden</button>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
