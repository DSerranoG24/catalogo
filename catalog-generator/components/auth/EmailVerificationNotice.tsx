"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, apiRequest } from "@/lib/api";

type AccountStatus = { email: string; emailVerifiedAt: string | null; hasLocalPassword: boolean };
export default function EmailVerificationNotice() {
  const [user, setUser] = useState<AccountStatus | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [remaining, setRemaining] = useState(0);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let controller: AbortController | undefined;
    function refresh() {
      controller?.abort(); controller = new AbortController();
      const signal = controller.signal;
      void apiRequest<{ user: AccountStatus }>("/me", { signal }).then(result => {
        if (!signal.aborted) { setUser(result.user); setError(""); }
      }).catch(error => {
        if (!signal.aborted) setError(error instanceof ApiError && error.status === 401 ? "Tu sesión ha caducado. Inicia sesión de nuevo." : "No se pudo comprobar la verificación. Puedes seguir trabajando y reintentar.");
      });
    }
    function visible() { if (document.visibilityState === "visible") refresh(); }
    refresh(); window.addEventListener("focus", refresh); document.addEventListener("visibilitychange", visible);
    return () => { controller?.abort(); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", visible); };
  }, [retry]);
  useEffect(() => {
    if (remaining <= 0) return;
    const timer = setTimeout(() => setRemaining(value => Math.max(0, value - 1)), 1000);
    return () => clearTimeout(timer);
  }, [remaining]);
  const resend = useCallback(async () => {
    if (busy || remaining > 0) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await apiRequest<{ message: string; retryAfterSeconds: number }>("/auth/verification/request", { method: "POST", body: "{}" });
      setRemaining(result.retryAfterSeconds); setMessage(result.message);
    } catch (error) { setError(error instanceof Error ? error.message : "No se pudo solicitar el correo. Intenta más tarde."); }
    finally { setBusy(false); }
  }, [busy, remaining]);
  if (user?.emailVerifiedAt) return null;
  if (!user && !error) return null;
  return <aside aria-label="Verificación de correo" className="mx-auto mt-4 w-[calc(100%-2.5rem)] max-w-6xl rounded-xl border border-[var(--brand-emerald)]/25 bg-white p-4 text-sm">
    {user && <><p className="font-semibold">Verifica tu correo para proteger tu cuenta</p><p className="mt-1 break-words">Pendiente: {user.email}. Puedes seguir usando Vitrinaya.</p><button type="button" onClick={resend} disabled={busy || remaining > 0} className="mt-2 min-h-11 rounded-lg px-3 font-semibold text-[var(--brand-emerald)] focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50">{busy ? "Solicitando…" : remaining > 0 ? `Reenviar en ${remaining} s` : "Reenviar verificación"}</button></>}
    {message && <p role="status" className="mt-2">{message}</p>}
    {error && <div role="alert" className="mt-2 text-[#a5432a]"><p>{error}</p><button type="button" className="min-h-11 rounded-lg px-3 font-semibold focus-visible:outline-2" onClick={() => setRetry(value => value + 1)}>Volver a comprobar</button></div>}
  </aside>;
}
