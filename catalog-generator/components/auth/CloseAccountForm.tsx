"use client";

import { useEffect, useState, type FormEvent } from "react";
import { apiRequest, clearSession } from "@/lib/api";
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
  useEffect(() => {
    let active = true;
    apiRequest<{ user: { hasLocalPassword: boolean } }>("/me").then(result => { if (active) setHasPassword(result.user.hasLocalPassword); }).catch(() => { if (active) setError("No se pudo verificar la sesión. Recarga o inicia sesión de nuevo."); });
    return () => { active = false; };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !acknowledged || confirmation !== "CERRAR CUENTA") return;
    setBusy(true); setError("");
    try {
      await apiRequest("/auth/close", { method: "POST", body: JSON.stringify({ confirmation, ...(hasPassword ? { password } : { idToken }) }) });
      setPassword(""); setIdToken("");
      await clearSession();
      window.location.replace("/cuenta-cerrada");
    } catch (cause) { setPassword(""); setIdToken(""); setError(cause instanceof Error ? cause.message : "No se pudo cerrar la cuenta."); setBusy(false); }
  }

  return <form onSubmit={submit} className="mt-6 space-y-5 rounded-2xl border border-[#cbd7cc] bg-white p-5 text-sm text-[#263b31]">
    <p>El cierre es irreversible. Perderás el acceso y tus catálogos se retirarán de publicación. Debes resolver los pedidos pendientes o confirmados y revisar la anonimización de los completados y cancelados antes de continuar.</p>
    <p>Se conserva el historial de ventas con importes, líneas, fechas y evidencia del consentimiento, además de registros técnicos y las instantáneas comerciales del vendedor. No es un borrado completo.</p>
    <p>Las imágenes se eliminan mediante una limpieza persistente con reintentos. Al cerrar, la limpieza queda pendiente y puede continuar después de cerrar sesión.</p>
    {hasPassword === null ? <p role="status">Verificando el método de acceso…</p> : hasPassword ? <label className="block">Contraseña actual<input required disabled={busy} type="password" autoComplete="current-password" maxLength={128} value={password} onChange={e => setPassword(e.target.value)} className="mt-1 block min-h-11 w-full rounded border border-[#68756e] px-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#166534]" /></label> : <div><p>Verifica de nuevo tu identidad con Google. La verificación debe haberse realizado en los últimos cinco minutos.</p><GoogleSignInButton onCredential={credential => { if (!busy) setIdToken(credential); }} />{idToken && <p role="status">Identidad recibida; el servidor la comprobará al cerrar.</p>}</div>}
    <label className="flex min-h-11 items-start gap-2"><input className="mt-1" type="checkbox" disabled={busy} checked={acknowledged} onChange={e => setAcknowledged(e.target.checked)} required /><span>Entiendo que perderé el acceso, que se conserva historial comercial y técnico, y que la limpieza de archivos puede quedar pendiente.</span></label>
    <label className="block">Escribe CERRAR CUENTA<input disabled={busy} required autoComplete="off" value={confirmation} onChange={e => setConfirmation(e.target.value)} className="mt-1 block min-h-11 w-full rounded border border-[#68756e] px-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#166534]" /></label>
    {error && <p role="alert" className="text-[#a5432a]">{error}</p>}
    <Button type="submit" variant="destructive" loading={busy} disabled={busy || hasPassword === null || !acknowledged || confirmation !== "CERRAR CUENTA" || !(hasPassword ? password : idToken)}>Cerrar cuenta</Button>
  </form>;
}
