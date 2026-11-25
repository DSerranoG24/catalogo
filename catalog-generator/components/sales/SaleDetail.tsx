"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiRequest } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Input";
import { AlertDialog, AlertDialogCancel, DialogActions } from "@/components/ui/Dialog";
import { allowedActions, buildReturn, buyerName, describeFailure, displayStatus, formatCop, formatDate, insufficientItems, itemCount, lineBalances, parseSale,
  type ReturnRows, type Sale } from "@/lib/sales-ui.mjs";
import SaleStatusBadge from "./SaleStatusBadge";
import SaleDraftEditor from "./SaleDraftEditor";
import FailureNotice from "./FailureNotice";
import { useSaleCommand, type SaleCommand } from "./useSaleCommand";

type StockIssue = { name: string; sku: string; available: number; requested: number };

export default function SaleDetail({ saleId, onChanged, onClose }: { saleId: string; onChanged: () => void; onClose: () => void }) {
  // State is written only when a response arrives; "loading" is derived from the requested revision,
  // and a late reply for another sale is ignored because each detail is keyed by its sale id.
  const [revision, setRevision] = useState(0);
  const [loaded, setLoaded] = useState<{ revision: number; error: ReturnType<typeof describeFailure> | null } | null>(null);
  const [sale, setSale] = useState<Sale | null>(null);
  const [message, setMessage] = useState("");
  const [dialog, setDialog] = useState<null | "deliver" | "cancel" | "return">(null);
  const [cancelReason, setCancelReason] = useState("");
  const [returnRows, setReturnRows] = useState<ReturnRows>({});
  const [returnReason, setReturnReason] = useState("");
  const [returnErrors, setReturnErrors] = useState<string[]>([]);
  const [stock, setStock] = useState<{ failure: unknown; issues: StockIssue[] } | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const command = useSaleCommand();
  const { run, failure, clearFailure } = command;

  useEffect(() => {
    let active = true;
    apiRequest<{ result?: unknown }>(`/sales/${saleId}`).then(reply => parseSale(reply?.result)).then(
      next => { if (active) { setSale(next); setLoaded({ revision, error: null }); } },
      cause => { if (active) setLoaded({ revision, error: describeFailure(cause) }); });
    return () => { active = false; };
  }, [saleId, revision]);
  const loading = loaded?.revision !== revision;
  const loadError = loading ? null : loaded?.error ?? null;
  const load = useCallback(() => setRevision(value => value + 1), []);
  const loadedId = sale?.id;
  useEffect(() => { if (loadedId) heading.current?.focus(); }, [loadedId]);

  // STOCK_INSUFFICIENT does not name the item: read the current stock of each line to say which one.
  useEffect(() => {
    if (failure?.code !== "STOCK_INSUFFICIENT" || !sale) return;
    let active = true;
    void Promise.all(sale.lines.map(line => apiRequest<{ result?: { items?: { id: string; stock: number }[] } }>(`/inventory/items?page=1&q=${encodeURIComponent(line.sku)}`)
      .then(reply => reply?.result?.items ?? [], () => [])))
      .then(found => { if (active) setStock({ failure, issues: insufficientItems(sale.lines, found.flat()) }); });
    return () => { active = false; };
  }, [failure, sale]);
  const stockIssues = stock && stock.failure === failure ? stock.issues : null;

  function afterSuccess(text: string) {
    setMessage(text); setDialog(null); setCancelReason(""); setReturnRows({}); setReturnReason(""); setReturnErrors([]);
    load(); onChanged();
  }
  function send(next: SaleCommand, text: string) { setMessage(""); return run(next, () => afterSuccess(text)); }
  function reload() { clearFailure(); setMessage(""); load(); }

  if (!sale && !loadError) return <section aria-label="Detalle de venta" className="rounded-2xl border border-[#dce4dc] bg-white p-5"><p role="status">Cargando venta…</p></section>;
  if (!sale) return <section aria-label="Detalle de venta" className="space-y-3 rounded-2xl border border-[#dce4dc] bg-white p-5">
    {loadError && <FailureNotice failure={{ ...loadError, action: loadError.action === "login" ? "login" : "reload" }} busy={false} onReload={reload} reloadLabel="Reintentar cargar la venta" />}
    <Button variant="secondary" onClick={onClose}>Volver al listado</Button>
  </section>;

  const actions = allowedActions(sale);
  const balances = lineBalances(sale);
  const status = displayStatus(sale);
  const locked = command.busy !== null;
  const showBalances = sale.status === "DELIVERED" || sale.status === "RETURNED";
  const built = buildReturn(sale, returnRows, returnReason);
  const lineName = (id: string) => sale.lines.find(line => line.id === id)?.itemName ?? "Artículo";
  const dates: [string, string | null | undefined][] = [["Creada", sale.createdAt], ["Confirmada", sale.confirmedAt], ["Entregada", sale.deliveredAt], ["Cancelada", sale.cancelledAt], ["Devuelta", sale.returnedAt]];

  return <section aria-labelledby={`sale-${sale.id}`} data-sale-id={sale.id} data-sale-version={sale.version} className="space-y-6 rounded-2xl border border-[#dce4dc] bg-white p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 space-y-1">
        <h2 id={`sale-${sale.id}`} ref={heading} tabIndex={-1} className="break-words text-xl font-semibold focus-visible:outline-2 focus-visible:outline-offset-4">Venta {sale.id.slice(0, 8)}</h2>
        <div className="flex flex-wrap items-center gap-2"><SaleStatusBadge status={status} /><span className="text-sm text-[#52675b]">{buyerName(sale) ?? "Sin cliente"}</span></div>
      </div>
      <Button variant="secondary" disabled={locked} onClick={onClose}>Volver al listado</Button>
    </div>

    <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
      {dates.filter(([, value]) => value).map(([label, value]) => <div key={label}><dt className="text-[#52675b]">{label}</dt><dd className="font-medium">{formatDate(value)}</dd></div>)}
    </dl>

    <p role="status" className="text-sm">{message}</p>
    {command.busy && <p role="status" className="text-sm">{command.busy}</p>}
    {failure && <FailureNotice failure={failure} busy={locked} onRetry={() => void command.retry()} onReload={reload} reloadLabel="Recargar venta"
      onRefreshPrices={() => void send({ action: "refreshPrices", saleId: sale.id, path: `/sales/${sale.id}`, method: "PATCH", withRequestId: false, label: "Recargando precios…",
        body: { expectedVersion: sale.version, lines: sale.lines.map(line => ({ inventoryItemId: line.inventoryItemId, quantity: line.quantity, unitDiscount: line.unitDiscount })) } },
        "Borrador recargado con los precios actuales. Revisa el total y confirma de nuevo.")}>
      {failure.code === "STOCK_INSUFFICIENT" && stockIssues && (stockIssues.length
        ? <ul className="list-disc pl-5 text-sm">{stockIssues.map(issue => <li key={issue.sku}>{issue.name} (SKU {issue.sku}): {issue.available} disponible{issue.available === 1 ? "" : "s"}, la venta pide {issue.requested}.</li>)}</ul>
        : <p className="text-sm">Recarga la venta y revisa las existencias en Inventario.</p>)}
    </FailureNotice>}

    {actions.editDraft ? <SaleDraftEditor key={`${sale.id}:${sale.version}`} sale={sale} busy={command.busy} run={(next, done) => { setMessage(""); return run(next, done); }} onSaved={afterSuccess} /> : <section aria-labelledby={`lines-${sale.id}`} className="space-y-3">
      <h3 id={`lines-${sale.id}`} className="text-lg font-semibold">Artículos</h3>
      <ul className="divide-y divide-[#e2e8e0] rounded-xl border border-[#e2e8e0]">{sale.lines.map(line => {
        const balance = balances.get(line.id)!;
        return <li key={line.id} className="grid gap-2 p-3 text-sm sm:grid-cols-[minmax(0,2fr)_repeat(4,minmax(0,1fr))]">
          <div className="min-w-0"><p className="break-words font-medium">{line.itemName}</p><p className="text-[#52675b]">SKU {line.sku}</p></div>
          <p><span className="text-[#52675b] sm:hidden">Cantidad </span>{line.quantity} × {formatCop(line.unitPrice)}</p>
          <p><span className="text-[#52675b]">Descuento </span>{formatCop(line.unitDiscount)}</p>
          <p className="font-medium"><span className="font-normal text-[#52675b] sm:hidden">Total </span>{formatCop(line.lineTotal)}</p>
          {showBalances ? <p data-line-balance={line.id}>Vendida {balance.sold} · Devuelta {balance.returned} · Pendiente {balance.pending}</p> : <span />}
        </li>;
      })}</ul>
    </section>}

    <div className="rounded-xl border border-[#e2e8e0] bg-[#fafcf9] p-4 text-sm">
      <p className="font-medium">Totales calculados por el servidor</p>
      <p>Subtotal {formatCop(sale.subtotal)} · Descuento {formatCop(sale.discountTotal)} · <strong className="text-base">Total {formatCop(sale.total)}</strong></p>
      <p className="mt-1 text-[#52675b]">Los totales no indican pagos recibidos.</p>
    </div>

    {sale.returns.length > 0 && <section aria-labelledby={`returns-${sale.id}`} className="space-y-2">
      <h3 id={`returns-${sale.id}`} className="text-lg font-semibold">Historial de devoluciones</h3>
      <ol className="space-y-2">{sale.returns.map((ret, index) => <li key={ret.id} className="rounded-xl border border-[#e2e8e0] p-3 text-sm">
        <p className="font-medium">Devolución {index + 1}{ret.createdAt ? ` · ${formatDate(ret.createdAt)}` : ""}</p>
        <p>Motivo: {ret.reason}</p>
        <ul className="mt-1 list-disc pl-5">{ret.lines.map(line => <li key={line.saleLineId}>{lineName(line.saleLineId)}: {line.receivedQuantity} recibida{line.receivedQuantity === 1 ? "" : "s"} ({line.resellableQuantity} revendible{line.resellableQuantity === 1 ? "" : "s"}, {line.damagedQuantity} dañada{line.damagedQuantity === 1 ? "" : "s"})</li>)}</ul>
      </li>)}</ol>
    </section>}

    {(actions.deliver || actions.cancel) && <div className="flex flex-wrap gap-2">
      {actions.deliver && <Button disabled={locked} onClick={() => setDialog("deliver")}>Entregar</Button>}
      {actions.cancel && <Button variant="destructive" disabled={locked} onClick={() => setDialog("cancel")}>Cancelar venta</Button>}
    </div>}

    {actions.registerReturn && <section aria-labelledby={`return-${sale.id}`} className="space-y-3 rounded-xl border border-[#e2e8e0] p-4">
      <h3 id={`return-${sale.id}`} className="text-lg font-semibold">Registrar devolución</h3>
      <p className="text-sm text-[#52675b]">Indica lo recibido por línea, como máximo lo pendiente. Lo revendible vuelve al inventario; lo dañado queda registrado sin sumar existencias.</p>
      <fieldset disabled={locked} className="space-y-3">
        <legend className="sr-only">Cantidades devueltas</legend>
        {sale.lines.filter(line => balances.get(line.id)!.pending > 0).map(line => {
          const row = returnRows[line.id] ?? { resellable: "0", damaged: "0" }, pending = balances.get(line.id)!.pending;
          const set = (patch: Partial<typeof row>) => { setReturnRows(current => ({ ...current, [line.id]: { ...row, ...patch } })); setReturnErrors([]); };
          return <div key={line.id} className="grid gap-2 sm:grid-cols-[minmax(0,2fr)_repeat(2,minmax(0,1fr))] sm:items-end">
            <p className="text-sm"><span className="block break-words font-medium">{line.itemName}</span>Pendiente {pending}</p>
            <label className="grid gap-1 text-sm font-medium">Revendibles<Input inputMode="numeric" value={row.resellable} aria-label={`Revendibles de ${line.itemName}`} onChange={event => set({ resellable: event.target.value })} /></label>
            <label className="grid gap-1 text-sm font-medium">Dañadas<Input inputMode="numeric" value={row.damaged} aria-label={`Dañadas de ${line.itemName}`} onChange={event => set({ damaged: event.target.value })} /></label>
          </div>;
        })}
        <label className="grid gap-1 text-sm font-medium">Motivo de la devolución<Textarea maxLength={300} value={returnReason} onChange={event => { setReturnReason(event.target.value); setReturnErrors([]); }} /></label>
      </fieldset>
      {returnErrors.length > 0 && <ul role="alert" className="list-disc space-y-1 rounded-xl border border-[#efc2bd] bg-[#fdf0ee] p-4 pl-8 text-sm text-[#5e1f17]">{returnErrors.map(error => <li key={error}>{error}</li>)}</ul>}
      <Button disabled={locked} onClick={() => { if (built.errors.length) setReturnErrors(built.errors); else setDialog("return"); }}>Registrar devolución</Button>
    </section>}

    {!actions.editDraft && !actions.deliver && !actions.cancel && !actions.registerReturn && <p className="text-sm text-[#52675b]">Esta venta es de solo lectura.</p>}

    <AlertDialog open={dialog === "deliver"} onOpenChange={open => { if (!open) setDialog(null); }} title="¿Marcar la venta como entregada?"
      description="No cambia las existencias. Después, la venta solo podrá corregirse con devoluciones.">
      <DialogActions><AlertDialogCancel label="Volver" /><Button onClick={() => { setDialog(null); void send({ action: "deliver", saleId: sale.id, path: `/sales/${sale.id}/deliver`, method: "POST", body: { expectedVersion: sale.version }, withRequestId: true, label: "Entregando venta…" }, "Venta entregada."); }}>Sí, entregar</Button></DialogActions>
    </AlertDialog>

    <AlertDialog open={dialog === "cancel"} onOpenChange={open => { if (!open) setDialog(null); }} title="¿Cancelar la venta?"
      description={<>{itemCount(sale) === 1 ? "La unidad vendida vuelve" : `Las ${itemCount(sale)} unidades vendidas vuelven`} al inventario. Esta acción no se puede deshacer.</>}>
      <label className="mt-4 grid gap-1 text-sm font-medium">Motivo de la cancelación (obligatorio)<Textarea maxLength={300} value={cancelReason} onChange={event => setCancelReason(event.target.value)} /></label>
      {cancelReason.trim().length > 0 && cancelReason.trim().length < 3 && <p className="mt-1 text-sm text-[#8a2b20]">Escribe al menos 3 caracteres.</p>}
      <DialogActions><AlertDialogCancel label="Volver" /><Button variant="destructive" disabled={cancelReason.trim().length < 3} onClick={() => { setDialog(null); void send({ action: "cancel", saleId: sale.id, path: `/sales/${sale.id}/cancel`, method: "POST", body: { expectedVersion: sale.version, reason: cancelReason.trim() }, withRequestId: true, label: "Cancelando venta…" }, "Venta cancelada. Las unidades volvieron al inventario."); }}>Sí, cancelar la venta</Button></DialogActions>
    </AlertDialog>

    <AlertDialog open={dialog === "return"} onOpenChange={open => { if (!open) setDialog(null); }} title="¿Registrar la devolución?"
      description={<>{built.lines.map(line => `${lineName(line.saleLineId)}: ${line.resellableQuantity} revendible(s), ${line.damagedQuantity} dañada(s)`).join(" · ")}. Lo revendible vuelve al inventario. No registra reembolsos.</>}>
      <DialogActions><AlertDialogCancel label="Volver" /><Button onClick={() => { setDialog(null); void send({ action: "return", saleId: sale.id, path: `/sales/${sale.id}/returns`, method: "POST", body: { expectedVersion: sale.version, reason: built.reason, lines: built.lines }, withRequestId: true, label: "Registrando devolución…" }, "Devolución registrada."); }}>Sí, registrar devolución</Button></DialogActions>
    </AlertDialog>
  </section>;
}
