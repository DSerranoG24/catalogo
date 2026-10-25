"use client";

import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";
import { apiRequest, clearSession } from "@/lib/api";

const control = "mt-2 min-h-11 w-full min-w-0 rounded-xl border border-[#d6dfd7] bg-white px-3 py-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-emerald)]";
const button = "min-h-11 rounded-xl bg-[var(--brand-emerald)] px-4 py-3 font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--brand-emerald)] disabled:opacity-50";
export default function AccountActionForm({ kind }: { kind: "forgot" | "reset" | "verify" }) {
  const [token, setToken] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const tokenReadFor = useRef<string | null>(null);
  useEffect(() => {
    if (kind === "forgot" || tokenReadFor.current === kind) return;
    tokenReadFor.current = kind;
    const candidate = new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "";
    window.history.replaceState(null, "", window.location.pathname);
    // This synchronizes a browser-only secret after hydration; it never submits it.
    setToken(/^[A-Za-z0-9_-]{43}$/.test(candidate) ? candidate : "");
  }, [kind]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || done) return;
    setError("");
    if (kind === "reset" && (password !== confirmation || new TextEncoder().encode(password).length > 72)) {
      setError("Las contraseñas deben coincidir y no superar 72 bytes."); return;
    }
    setBusy(true);
    try {
      const path = kind === "forgot" ? "/auth/password/forgot" : kind === "verify" ? "/auth/verification/confirm" : "/auth/password/reset";
      const result = await apiRequest<{ message: string }>(path, { method: "POST", body: JSON.stringify(kind === "forgot" ? { email } : kind === "verify" ? { token } : { token, password, passwordConfirmation: confirmation }) });
      setToken(""); setPassword(""); setConfirmation(""); setDone(true); setMessage(result.message);
      if (kind === "reset") await clearSession();
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "No se pudo completar la operación."); }
    finally { setBusy(false); }
  }
  const title = kind === "forgot" ? "Recupera tu acceso" : kind === "reset" ? "Establece una contraseña nueva" : "Verifica tu correo";
  return <main className="mx-auto w-full max-w-lg px-5 py-12">
    <Link href="/" className="inline-flex min-h-11 items-center rounded-lg font-semibold text-[var(--brand-emerald)] focus-visible:outline-2 focus-visible:outline-offset-4">Volver al inicio</Link>
    <section className="mt-5 rounded-3xl border border-[#d6dfd7] bg-white p-6">
      <h1 className="text-2xl font-semibold text-[var(--brand-forest)]">{title}</h1>
      <p className="mt-3 text-sm leading-6">{kind === "forgot" ? "Escribe el correo con el que creaste tu cuenta. Si usas Google sin contraseña local, continúa con Google desde el inicio de sesión." : "Abrir este enlace no realiza ningún cambio. Confirma a continuación para continuar."}</p>
      {message && <p role="status" className="mt-4 text-sm">{message}</p>}
      {error && <p role="alert" className="mt-4 text-sm text-[#a5432a]">{error}</p>}
      {!done && <form onSubmit={submit} className="mt-5 space-y-4">
        {kind === "forgot" && <label className="block text-sm font-medium">Correo electrónico<input type="email" autoComplete="email" required maxLength={254} value={email} onChange={e => setEmail(e.target.value)} className={control} /></label>}
        {kind === "reset" && <><label className="block text-sm font-medium">Contraseña nueva<input type="password" autoComplete="new-password" minLength={8} maxLength={72} required value={password} onChange={e => setPassword(e.target.value)} className={control} /></label><label className="block text-sm font-medium">Repite la contraseña<input type="password" autoComplete="new-password" minLength={8} maxLength={72} required value={confirmation} onChange={e => setConfirmation(e.target.value)} className={control} /></label></>}
        {kind !== "forgot" && !token && <p role="status" className="text-sm">Falta un enlace válido. Abre el enlace completo de tu correo; si ya lo utilizaste o recargaste esta página, solicita uno nuevo.</p>}
        <button type="submit" disabled={busy || (kind !== "forgot" && !token)} className={button}>{busy ? "Procesando…" : kind === "forgot" ? "Solicitar instrucciones" : kind === "verify" ? "Confirmar mi correo" : "Cambiar contraseña"}</button>
      </form>}
      <div className="mt-5 flex flex-wrap gap-4 text-sm"><Link href="/login" className="inline-flex min-h-11 items-center rounded-lg text-[var(--brand-emerald)] focus-visible:outline-2 focus-visible:outline-offset-4">Ir a iniciar sesión</Link>{kind === "reset" && <Link href="/recuperar-contrasena" className="inline-flex min-h-11 items-center rounded-lg text-[var(--brand-emerald)] focus-visible:outline-2 focus-visible:outline-offset-4">Solicitar otro enlace</Link>}{kind === "verify" && <Link href="/dashboard" className="inline-flex min-h-11 items-center rounded-lg text-[var(--brand-emerald)] focus-visible:outline-2 focus-visible:outline-offset-4">Ir al panel y reenviar</Link>}</div>
    </section>
  </main>;
}
