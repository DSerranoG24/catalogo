"use client";

import { useEffect, useState, type FormEvent } from "react";
import { apiRequest, ApiError, clearSession } from "@/lib/api";
import { closureNoticeRows, parseClosurePreview, type ClosurePreview } from "@/lib/account-closure-ui.mjs";
import { formatPesos } from "@/lib/pos-ui.mjs";
import { Button } from "@/components/ui/Button";
import GoogleSignInButton from "./GoogleSignInButton";

export default function CloseAccountForm() {
  const [hasPassword, setHasPassword] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [idToken, setIdToken] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // What closing leaves open (GET /auth/close/preview, correction C). Closing then needs an explicit confirmation.
  const [preview, setPreview] = useState<ClosurePreview | null>(null);
  const [previewError, setPreviewError] = useState(false);
  const [acceptOpen, setAcceptOpen] = useState(false);
  useEffect(() => {
    let active = true;
    apiRequest<unknown>("/auth/close/preview").then(parseClosurePreview).then(value => { if (active) setPreview(value); }, () => { if (active) setPreviewError(true); });
    return () => { active = false; };
  }, []);
  const needsConfirmation = preview?.requiresConfirmation === true;
  useEffect(() => {
    let active = true;
    apiRequest<{ user: { hasLocalPassword: boolean } }>("/me").then(result => { if (active) setHasPassword(result.user.hasLocalPassword); }).catch(() => { if (active) setError("No se pudo verificar la sesión. Recarga o inicia sesión de nuevo."); });
    return () => { active = false; };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !acknowledged || confirmation !== "CERRAR CUENTA" || (needsConfirmation && !acceptOpen)) return;
    setBusy(true); setError("");
    try {
      await apiRequest("/auth/close", { method: "POST", body: JSON.stringify({ confirmation, ...(hasPassword ? { password } : { idToken }), ...(needsConfirmation && acceptOpen ? { confirmOpenBalances: true } : {}) }) });
      setPassword(""); setIdToken("");
      await clearSession();
      window.location.replace("/cuenta-cerrada");
    } catch (cause) {
      setPassword(""); setIdToken(""); setBusy(false);
      // Something opened since the summary was read (or it could not be read): show the server's figures and ask again.
      if (cause instanceof ApiError && cause.code === "ACCOUNT_CLOSURE_REQUIRES_CONFIRMATION") {
        try { setPreview(parseClosurePreview(cause.details)); setPreviewError(false); } catch { setPreviewError(true); }
        setAcceptOpen(false);
        setError("Antes de cerrar, revisa lo que queda abierto y confírmalo. Vuelve a escribir tu contraseña o a verificar tu identidad.");
        return;
      }
      setError(cause instanceof Error ? cause.message : "No se pudo cerrar la cuenta.");
    }
  }

  return <form onSubmit={submit} data-closure-preview={preview ? "loaded" : previewError ? "error" : "loading"} className="mt-6 space-y-5 rounded-2xl border border-[#cbd7cc] bg-white p-5 text-sm text-[#263b31]">
    <p>El cierre es irreversible. Perderás el acceso y tus catálogos se retirarán de publicación. Debes resolver los pedidos pendientes o confirmados y revisar la anonimización de los completados y cancelados antes de continuar.</p>
    <p>Se conserva el historial de ventas con importes, líneas, fechas y evidencia del consentimiento, además de registros técnicos y las instantáneas comerciales del vendedor. No es un borrado completo.</p>
    <p>Las imágenes se eliminan mediante una limpieza persistente con reintentos. Al cerrar, la limpieza queda pendiente y puede continuar después de cerrar sesión.</p>
    {preview && needsConfirmation && <section aria-labelledby="closure-open-title" data-closure-notice className="space-y-3 rounded-xl border border-[#ecd3a3] bg-[#fdf5e6] p-4 text-[#5b3a07]">
      <h3 id="closure-open-title" className="font-semibold">Tu cuenta tiene dinero o entregas abiertas</h3>
      <dl className="space-y-1">{closureNoticeRows(preview, formatPesos).map(row => <div key={row.key} data-closure-row={row.key} className="flex flex-wrap justify-between gap-x-4"><dt>{row.label}</dt><dd className="font-semibold">{row.value}</dd></div>)}</dl>
      <p>Cerrar no borra ni cambia pagos, saldos a favor ni ventas: quedan en el historial. No podrás cobrar, entregar ni devolver dinero desde la app. Todavía no hay exportación de estos datos.</p>
      <label className="flex min-h-11 items-start gap-2"><input className="mt-1" type="checkbox" disabled={busy} checked={acceptOpen} onChange={e => setAcceptOpen(e.target.checked)} /><span>Revisé lo que queda abierto y quiero cerrar la cuenta igualmente.</span></label>
    </section>}
    {preview && preview.unresolvedOrders > 0 && <p role="status" data-closure-orders className="rounded-xl border border-[#ecd3a3] bg-[#fdf5e6] p-3 text-[#5b3a07]">Tienes {preview.unresolvedOrders === 1 ? "1 pedido" : `${preview.unresolvedOrders} pedidos`} por resolver o anonimizar: hay que resolverlos antes de cerrar.</p>}
    {previewError && <p role="status" className="text-[#52675b]">No se pudo leer el resumen de lo que queda abierto. Si hay dinero o entregas pendientes, te lo mostraremos al intentar cerrar.</p>}
    {hasPassword === null ? <p role="status">Verificando el método de acceso…</p> : hasPassword ? <label className="block">Contraseña actual<input required disabled={busy} type="password" autoComplete="current-password" maxLength={128} value={password} onChange={e => setPassword(e.target.value)} className="mt-1 block min-h-11 w-full rounded border border-[#68756e] px-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#166534]" /></label> : <div><p>Verifica de nuevo tu identidad con Google. La verificación debe haberse realizado en los últimos cinco minutos.</p><GoogleSignInButton onCredential={credential => { if (!busy) setIdToken(credential); }} />{idToken && <p role="status">Identidad recibida; el servidor la comprobará al cerrar.</p>}</div>}
    <label className="flex min-h-11 items-start gap-2"><input className="mt-1" type="checkbox" disabled={busy} checked={acknowledged} onChange={e => setAcknowledged(e.target.checked)} required /><span>Entiendo que perderé el acceso, que se conserva historial comercial y técnico, y que la limpieza de archivos puede quedar pendiente.</span></label>
    <label className="block">Escribe CERRAR CUENTA<input disabled={busy} required autoComplete="off" value={confirmation} onChange={e => setConfirmation(e.target.value)} className="mt-1 block min-h-11 w-full rounded border border-[#68756e] px-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#166534]" /></label>
    {error && <p role="alert" className="text-[#a5432a]">{error}</p>}
    <Button type="submit" variant="destructive" loading={busy} disabled={busy || hasPassword === null || !acknowledged || confirmation !== "CERRAR CUENTA" || (needsConfirmation && !acceptOpen) || !(hasPassword ? password : idToken)}>Cerrar cuenta</Button>
  </form>;
}
