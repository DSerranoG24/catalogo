"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { ApiError, apiRequest, saveSession, Session } from "@/lib/api";
import GoogleSignInButton from "@/components/auth/GoogleSignInButton";
import BrandLogo from "@/components/brand/BrandLogo";
import { BarChart3, Eye, EyeOff, Lock, LockKeyhole, LogIn, Mail, Package, PlusCircle, ShoppingBag, Store, User, UserPlus, Wallet } from "lucide-react";
import { LoginWaves, SloganUnderline } from "@/components/auth/LoginDecor";

const FEATURES = [
  { Icon: Package, text: "Inventario como fuente única de verdad" },
  { Icon: BarChart3, text: "Catálogo público y pedidos por WhatsApp" },
  { Icon: Wallet, text: "Ventas, gastos y cartera siempre al día" },
] as const;
const fieldClass = "mt-2 block h-[52px] w-full rounded-2xl border border-[var(--vy-field-border)] bg-white px-4 text-base text-[var(--vy-text)] outline-none transition placeholder:text-[var(--vy-text-subtle)] focus:border-[var(--vy-blue-600)] focus:ring-4 focus:ring-[#0450E5]/25";
const labelClass = "flex items-center gap-2.5 text-[0.95rem] font-semibold text-[var(--vy-text)]";

type AuthMode = "login" | "register";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingGoogle, setPendingGoogle] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (mode === "register" && new TextEncoder().encode(password).length > 72) {
      setError("La contraseña no puede superar 72 bytes. Usa una más corta."); return;
    }
    setBusy(true);

    try {
      const session = await apiRequest<Session>(
        mode === "login" ? "/auth/login" : "/auth/register",
        {
          method: "POST",
          body: JSON.stringify({
            email: email.trim(),
            password,
            ...(mode === "register" && name.trim() ? { name: name.trim() } : {}),
          }),
        }
      );

      saveSession(session);
      if (pendingGoogle && mode === "login") {
        await apiRequest("/auth/google/link", { method: "POST", body: JSON.stringify({ idToken: pendingGoogle, password }) });
        setPendingGoogle("");
      }
      router.replace("/dashboard");
      router.refresh();
    } catch (requestError) {
      if (pendingGoogle) setPendingGoogle("");
      setError(
        requestError instanceof Error
          ? requestError.message
          : "No se pudo iniciar sesión. Intenta de nuevo."
      );
    } finally {
      setBusy(false);
    }
  }

  async function signInWithGoogle(credential: string) {
    setError("");
    setBusy(true);
    try {
      const session = await apiRequest<Session>("/auth/google", {
        method: "POST",
        body: JSON.stringify({ idToken: credential }),
      });
      saveSession(session);
      router.replace("/dashboard");
      router.refresh();
    } catch (requestError) {
      if (requestError instanceof ApiError && requestError.status === 409) {
        setPendingGoogle(credential); setMode("login");
      }
      setError(requestError instanceof Error ? requestError.message : "No se pudo iniciar sesión con Google.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="relative min-h-screen bg-[var(--vy-page)] bg-[radial-gradient(circle_at_0%_0%,rgba(255,255,255,0.7),transparent_40%),radial-gradient(circle_at_100%_100%,rgba(23,141,255,0.12),transparent_45%)] lg:flex lg:items-center lg:justify-center lg:p-8 xl:p-10">
      <div className="relative w-full lg:grid lg:min-h-[720px] lg:max-w-[1360px] lg:grid-cols-[minmax(0,46fr)_minmax(0,54fr)] lg:overflow-hidden lg:rounded-[2.5rem] lg:bg-white lg:shadow-[0_40px_120px_-50px_rgba(1,28,79,0.5)]">
        <aside className="relative overflow-hidden bg-[linear-gradient(160deg,#011C4F_0%,#002971_50%,#0450E5_100%)] px-6 pb-24 pt-8 text-white sm:px-10 lg:flex lg:flex-col lg:bg-[linear-gradient(135deg,#011C4F_0%,#002971_55%,#0A3FB8_100%)] lg:p-12 lg:pr-20 lg:[clip-path:polygon(0_0,100%_0,90%_100%,0_100%)] xl:p-16 xl:pr-24">
          <div aria-hidden="true" className="pointer-events-none absolute -left-24 -top-24 size-72 rounded-full bg-[#178DFF]/20 blur-3xl" />
          <Link href="/" aria-label="Vitrinaya — Ir al inicio" className="relative z-10 mx-auto flex w-fit rounded-lg transition hover:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white lg:mx-0"><BrandLogo variant="horizontal" theme="oscuro" iconSize={60} nameRatio={0.68} gapSize={14} /></Link>
          <div className="relative z-10 mt-8 lg:mt-12">
            <ShoppingBag aria-hidden="true" focusable="false" strokeWidth={1.25} fill="#0760ED" fillOpacity={0.45} className="pointer-events-none absolute -right-3 -top-4 hidden size-24 text-[#7DB4FF] min-[360px]:block sm:right-4 sm:size-36 lg:hidden" />
            <h2 className="text-[2.75rem] font-extrabold leading-[1.02] tracking-tight sm:text-6xl xl:text-[4.25rem]">
              Tu negocio,<br /><span className="italic text-[var(--vy-blue-400)]">en orden.</span>
            </h2>
            <SloganUnderline className="ml-8 mt-1 h-4 w-52 sm:w-64 xl:w-80" />
            <p className="mt-5 max-w-md text-lg leading-snug text-[var(--vy-blue-100)] sm:text-xl xl:text-2xl">Inventario, catálogo, ventas y cartera en un solo lugar.</p>
            <ul className="mt-8 hidden space-y-4 lg:block">
              {FEATURES.map(({ Icon, text }) => (
                <li key={text} className="flex items-center gap-4">
                  <span aria-hidden="true" className="grid size-12 shrink-0 place-items-center rounded-full bg-[var(--vy-blue-500)] shadow-[0_10px_24px_-10px_rgba(7,96,237,0.9)]"><Icon className="size-6 text-white" strokeWidth={1.75} /></span>
                  <span className="max-w-[16rem] text-base leading-snug text-white xl:text-lg">{text}</span>
                </li>
              ))}
            </ul>
          </div>
          <p className="relative z-10 mt-auto hidden pt-10 text-sm text-white lg:block">© 2026 Vitrinaya <span aria-hidden="true">•</span> Una tienda digital que se siente tuya</p>
          <LoginWaves className="h-32 lg:h-36" />
        </aside>

        <section className="relative z-10 mx-4 -mt-14 mb-8 rounded-[2rem] bg-white px-5 py-7 shadow-[0_30px_80px_-40px_rgba(1,28,79,0.5)] sm:mx-auto sm:max-w-xl sm:px-10 sm:py-10 lg:m-0 lg:flex lg:max-w-none lg:items-center lg:justify-center lg:rounded-none lg:bg-[radial-gradient(circle_at_100%_0%,rgba(23,141,255,0.28),transparent_30%),radial-gradient(circle_at_0%_100%,rgba(23,141,255,0.2),transparent_28%)] lg:px-12 lg:py-14 lg:shadow-none">
          <div className="mx-auto w-full max-w-[520px]">
            <Store aria-hidden="true" focusable="false" className="mx-auto mb-3 size-14 text-[var(--vy-blue-600)] lg:hidden" strokeWidth={1.75} />
            <h1 className="text-center text-[2rem] font-bold tracking-tight text-[var(--vy-text)] sm:text-4xl lg:text-5xl">
              {mode === "login" ? "Inicia sesión" : "Crea tu cuenta"}
            </h1>
            <p className="mt-2 text-center text-base leading-6 text-[var(--vy-text-muted)] lg:text-lg">
              {mode === "login"
                ? "Entra a tu panel para administrar tu negocio."
                : "Un espacio para organizar tus productos y compartirlos."}
            </p>

            <div className="mt-7 grid grid-cols-2 rounded-2xl border border-[var(--vy-border)] bg-[var(--vy-surface-soft)]">
              {(["login", "register"] as const).map((authMode) => {
                const active = mode === authMode;
                return (
                  <button
                    key={authMode}
                    type="button"
                    aria-pressed={active}
                    onClick={() => {
                      setMode(authMode);
                      setError("");
                    }}
                    className={`inline-flex min-h-14 min-w-0 items-center justify-center gap-2.5 rounded-2xl px-2 py-2.5 text-sm font-semibold leading-5 transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--vy-blue-600)] sm:text-base ${
                      active
                        ? "bg-[var(--vy-blue-600)] text-white shadow-[0_10px_22px_-12px_rgba(4,80,229,0.9)]"
                        : "text-[var(--vy-text-muted)] hover:text-[var(--vy-text)]"
                    }`}
                  >
                    {authMode === "login"
                      ? <User aria-hidden="true" className="size-5 shrink-0" fill="currentColor" />
                      : <PlusCircle aria-hidden="true" className={`size-6 shrink-0 ${active ? "text-[var(--vy-blue-600)]" : "text-white"}`} fill={active ? "#FFFFFF" : "var(--vy-text)"} />}
                    {authMode === "login" ? "Iniciar sesión" : "Crear cuenta"}
                  </button>
                );
              })}
            </div>

            <form onSubmit={submit} className="mt-6 space-y-4">
              {mode === "register" && (
                <div>
                  <label htmlFor="login-name" className={labelClass}>
                    <User aria-hidden="true" className="size-5 shrink-0" />
                    <span>Nombre <span className="font-normal text-[var(--vy-text-subtle)]">(opcional)</span></span>
                  </label>
                  <input
                    id="login-name"
                    autoComplete="name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    className={fieldClass}
                    placeholder="Tu nombre"
                  />
                </div>
              )}

              <div>
                <label htmlFor="login-email" className={labelClass}>
                  <Mail aria-hidden="true" className="size-5 shrink-0" />
                  Correo electrónico
                </label>
                <input
                  id="login-email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className={fieldClass}
                  placeholder="nombre@tienda.com"
                />
              </div>

              <div>
                <label htmlFor="login-password" className={labelClass}>
                  <Lock aria-hidden="true" className="size-5 shrink-0" />
                  Contraseña
                </label>
                <div className="relative">
                  <input
                    id="login-password"
                    type={showPassword ? "text" : "password"}
                    autoComplete={mode === "login" ? "current-password" : "new-password"}
                    minLength={mode === "register" ? 8 : 1}
                    required
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className={`${fieldClass} pr-14`}
                    placeholder={mode === "register" ? "Al menos 8 caracteres" : "Tu contraseña"}
                  />
                  <button
                    type="button"
                    aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                    aria-pressed={showPassword}
                    aria-controls="login-password"
                    onClick={() => setShowPassword((value) => !value)}
                    className="absolute right-1 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-xl text-[var(--vy-text)] transition hover:bg-[var(--vy-surface-soft)] focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-[var(--vy-blue-600)]"
                  >
                    {showPassword ? <EyeOff aria-hidden="true" className="size-5" /> : <Eye aria-hidden="true" className="size-5" />}
                  </button>
                </div>
                {mode === "login" && (
                  <div className="mt-1 flex justify-end">
                    <Link href="/recuperar-contrasena" className="inline-flex min-h-11 items-center rounded-lg text-sm font-semibold text-[var(--vy-blue-600)] underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--vy-blue-600)]">¿Olvidaste tu contraseña?</Link>
                  </div>
                )}
              </div>

              {error && (
                <p role="alert" className="rounded-xl border border-[#F4C7C2] bg-[#FEF3F2] px-4 py-3 text-sm text-[#B42318]">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={busy}
                className="inline-flex min-h-14 w-full items-center justify-center gap-3 rounded-2xl bg-[var(--vy-blue-600)] px-4 py-3 text-base font-semibold text-white shadow-[0_14px_28px_-14px_rgba(4,80,229,0.9)] transition hover:bg-[var(--vy-blue-700)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#0450E5]/35 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60"
              >
                {!busy && (mode === "login" ? <LogIn aria-hidden="true" className="size-5" /> : <UserPlus aria-hidden="true" className="size-5" />)}
                {busy
                  ? "Un momento..."
                  : mode === "login"
                    ? "Entrar al panel"
                    : "Crear cuenta"}
              </button>
            </form>

            <div aria-hidden="true" className="my-5 flex items-center gap-4 text-sm text-[var(--vy-text-muted)]">
              <span className="h-px flex-1 bg-[var(--vy-border)]" />o<span className="h-px flex-1 bg-[var(--vy-border)]" />
            </div>
            <GoogleSignInButton variant="login" onCredential={signInWithGoogle} />

            <p className="mt-6 text-center text-sm leading-5 text-[var(--vy-text-muted)]">
              <LockKeyhole className="mr-2 inline-block size-4 align-[-3px]" aria-hidden="true" />
              Tu sesión se protege con una cookie segura de este sitio.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
