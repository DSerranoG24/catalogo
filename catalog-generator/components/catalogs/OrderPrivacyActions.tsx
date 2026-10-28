"use client";

import { useState } from "react";
import { apiRequest, type OrderStatus } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Dialog, DialogActions } from "@/components/ui/Dialog";

const sellerFields = ["name", "nit", "phone", "whatsappPhone", "address", "businessHours", "email", "instagramUrl", "facebookUrl", "tiktokUrl", "quotationTerms"] as const;
type SellerField = typeof sellerFields[number];
const fieldNames: Record<SellerField, string> = { name: "Nombre comercial", nit: "NIT", phone: "Teléfono", whatsappPhone: "WhatsApp", address: "Dirección", businessHours: "Horario", email: "Correo", instagramUrl: "Instagram", facebookUrl: "Facebook", tiktokUrl: "TikTok", quotationTerms: "Condiciones y textos libres" };

export default function OrderPrivacyActions({ order, onChanged }: {
  order: { id: string; status: OrderStatus; customerName: string; anonymizedAt: string | null; quotationSellerSnapshot: unknown; items: { productName: string }[] };
  onChanged: () => void;
}) {
  const [action, setAction] = useState<"anonymize" | "delete" | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [name, setName] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [redactNames, setRedactNames] = useState(false);
  const [redactFields, setRedactFields] = useState<SellerField[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const snapshot = order.quotationSellerSnapshot;
  const entries = typeof snapshot === "object" && snapshot !== null && !Array.isArray(snapshot)
    ? Object.entries(snapshot).filter(([key, value]) => sellerFields.some(field => field === key) && typeof value === "string") : [];

  function open(next: "anonymize" | "delete") {
    setConfirmation(""); setName(""); setReviewed(false); setRedactNames(false); setRedactFields([]); setError(""); setAction(next);
  }

  async function submit() {
    if (busy || !action) return;
    setBusy(true); setError("");
    try {
      await apiRequest(`/orders/${order.id}${action === "anonymize" ? "/anonymize" : ""}`, {
        method: action === "anonymize" ? "POST" : "DELETE",
        body: JSON.stringify(action === "anonymize"
          ? { confirmation, clientDataReviewed: reviewed, redactProductNames: redactNames, redactSellerFields: redactFields }
          : { confirmation, customerName: name }),
      });
      setAction(null); onChanged();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo completar la operación."); }
    finally { setBusy(false); }
  }

  return <>
    {order.anonymizedAt && <p className="mt-3 text-sm text-[#435047]">Datos del cliente anonimizados · {new Date(order.anonymizedAt).toLocaleString("es-CO")}</p>}
    <div className="mt-3 flex flex-wrap gap-2">
      {(order.status === "COMPLETED" || order.status === "CANCELLED") && !order.anonymizedAt && <Button variant="destructive-ghost" onClick={() => open("anonymize")}>Anonimizar datos del cliente</Button>}
      {order.status === "PENDING" && <Button variant="destructive-ghost" onClick={() => open("delete")}>Eliminar pedido pendiente</Button>}
    </div>
    <Dialog open={action !== null} onOpenChange={isOpen => { if (!isOpen && !busy) setAction(null); }} busy={busy}
      title={action === "anonymize" ? "Anonimizar datos del cliente" : "Eliminar pedido pendiente"}
      description={action === "anonymize" ? "Irreversible. Conserva importes, cantidades y fechas comerciales. Revoca nuevas descargas de la cotización; no elimina copias ya descargadas o enviadas." : "Irreversible. Elimina el pedido y sus líneas. Su clave antigua no podrá recrearlo. No se reutiliza el número de cotización."}>
      <div className="max-h-[55vh] space-y-4 overflow-y-auto px-1 text-sm text-[#263b31]">
        {action === "anonymize" && <>
          <p>Se retiran nombre, teléfono, correo, dirección y notas. Revisa los textos siguientes: marca SOLO los que contengan datos del CLIENTE. Los datos comerciales del VENDEDOR se conservan.</p>
          <ul className="list-inside list-disc break-words">{order.items.map((item, index) => <li key={index}>{item.productName}</li>)}</ul>
          <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={redactNames} onChange={e => setRedactNames(e.target.checked)} />Los nombres de las líneas contienen datos del cliente: sustituirlos por un marcador.</label>
          {entries.map(([key, value]) => {
            const field = sellerFields.find(candidate => candidate === key);
            if (!field) return null;
            return <label key={key} className="flex min-h-11 items-start gap-2 break-words rounded border border-[#cbd7cc] p-2"><input className="mt-1 shrink-0" type="checkbox" checked={redactFields.includes(field)} onChange={e => setRedactFields(current => e.target.checked ? [...current, field] : current.filter(item => item !== field))} /><span className="min-w-0 break-words"><strong>{fieldNames[field]}</strong>: {String(value)}<br />Retirar este campo si contiene datos del cliente.</span></label>;
          })}
          <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={reviewed} onChange={e => setReviewed(e.target.checked)} />He revisado todas las líneas y la instantánea, y señalado los campos que contienen datos del cliente.</label>
        </>}
        {action === "delete" && <label className="block break-words">Escribe el nombre exacto del cliente: {order.customerName}<input className="mt-1 block min-h-11 w-full rounded border border-[#68756e] px-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#166534]" value={name} onChange={e => setName(e.target.value)} autoComplete="off" /></label>}
        <label className="block">Escribe {action === "anonymize" ? "ANONIMIZAR" : "ELIMINAR"}<input className="mt-1 block min-h-11 w-full rounded border border-[#68756e] px-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#166534]" autoComplete="off" value={confirmation} onChange={e => setConfirmation(e.target.value)} /></label>
        {error && <p role="alert" className="text-[#a5432a]">{error}</p>}
      </div>
      <DialogActions><Button variant="secondary" disabled={busy} onClick={() => setAction(null)}>Volver</Button><Button variant="destructive" loading={busy} disabled={busy || (action === "anonymize" ? confirmation !== "ANONIMIZAR" || !reviewed : confirmation !== "ELIMINAR" || name !== order.customerName)} onClick={() => void submit()}>Confirmar operación irreversible</Button></DialogActions>
    </Dialog>
  </>;
}
