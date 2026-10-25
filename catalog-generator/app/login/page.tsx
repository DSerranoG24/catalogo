"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { apiRequest, saveSession, Session } from "@/lib/api";
import GoogleSignInButton from "@/components/auth/GoogleSignInButton";
import { ArrowRight, Check, LockKeyhole, Sparkles, Store } from "lucide-react";

type AuthMode = "login" | "register";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
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
      router.replace("/");
      router.refresh();
    } catch (requestError) {
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
      router.replace("/");
      router.refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "No se pudo iniciar sesión con Google.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-8 sm:px-8 sm:py-12">
      <div className="pointer-events-none absolute -left-28 top-20 size-72 rounded-full border border-[#dce7dc]" /><div className="pointer-events-none absolute -bottom-40 right-0 size-[28rem] rounded-full border border-[#dce7dc]" />
      <div className="relative w-full max-w-5xl overflow-hidden rounded-[2rem] border border-[#e3e9e1] bg-white shadow-[0_35px_100px_-55px_rgba(25,57,42,0.45)] lg:grid lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <aside className="relative hidden min-h-[650px] flex-col justify-between overflow-hidden bg-[#173f36] p-10 text-white lg:flex xl:p-12">
          <div className="pointer-events-none absolute -right-32 top-12 size-96 rounded-full border border-white/10" /><div className="pointer-events-none absolute -right-16 top-28 size-64 rounded-full border border-white/10" /><div className="pointer-events-none absolute bottom-24 left-16 size-36 rounded-full bg-[#b8dec8]/10 blur-2xl" />
          <Link href="/" className="relative inline-flex items-center gap-3"><span className="grid size-11 place-items-center rounded-2xl bg-[#c3e5d4] text-[#173f36]"><Store className="size-5" aria-hidden="true" /></span><span className="text-lg font-semibold tracking-tight">Catalogo</span></Link>
          <div className="relative"><span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-[#c3e5d4]"><Sparkles className="size-3.5" /> Tu negocio, en línea</span><h2 className="mt-5 max-w-sm text-4xl font-semibold leading-tight tracking-tight xl:text-5xl">Una tienda digital que se siente <span className="font-serif font-normal italic text-[#b8dec8]">tuya.</span></h2><p className="mt-4 max-w-sm text-sm leading-6 text-white/70">Organiza tus productos, personaliza tu catálogo y compártelo con tus clientes.</p>
            <div className="mt-8 space-y-3"><p className="flex items-center gap-2.5 text-sm text-white/85"><Check className="size-4 text-[#b8dec8]" /> Diseños para cada tipo de negocio</p><p className="flex items-center gap-2.5 text-sm text-white/85"><Check className="size-4 text-[#b8dec8]" /> Pedidos organizados en un solo lugar</p><p className="flex items-center gap-2.5 text-sm text-white/85"><Check className="size-4 text-[#b8dec8]" /> Comparte tu enlace cuando quieras</p></div>
          </div>
          <p className="relative text-xs text-white/45">Tu espacio de trabajo, siempre disponible.</p>
        </aside>

        <section className="min-w-0 p-6 sm:p-10 lg:px-12 lg:py-12">
          <Link href="/" className="mb-8 inline-flex items-center gap-2 text-sm font-semibold text-[#315e4f] lg:hidden"><span className="grid size-9 place-items-center rounded-xl bg-[#eaf2e9]"><Store className="size-4" /></span>Catalogo</Link>
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#a46d52]">
            Tu espacio de trabajo
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-[#202b27] sm:text-4xl">
            {mode === "login" ? "Qué bueno verte." : "Crea tu cuenta."}
          </h1>
          <p className="mt-2 text-sm leading-6 text-[#68756e]">
            {mode === "login"
              ? "Inicia sesión para administrar tus catálogos."
              : "Un espacio para organizar tus productos y compartirlos."}
          </p>

          <div className="mt-7 grid grid-cols-2 rounded-xl bg-[#f0f4ef] p-1">
            {(["login", "register"] as const).map((authMode) => (
              <button
                key={authMode}
                type="button"
                onClick={() => {
                  setMode(authMode);
                  setError("");
                }}
                className={`min-h-11 min-w-0 whitespace-normal rounded-lg px-2 py-2.5 text-sm font-semibold leading-5 transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#245c4c] ${
                  mode === authMode
                    ? "bg-white text-[#202b27] shadow-sm"
                    : "text-[#68756e] hover:text-[#202b27]"
                }`}
              >
                {authMode === "login" ? "Iniciar sesión" : "Crear cuenta"}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="mt-6 space-y-4">
            {mode === "register" && (
              <label className="block text-sm font-medium text-[#37443d]">
                Nombre <span className="font-normal text-[#87928b]">(opcional)</span>
                <input
                  autoComplete="name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className="mt-2 min-h-12 w-full rounded-xl border border-[#d9e2d9] bg-[#fcfdfb] px-4 py-3 text-[#202b27] outline-none transition placeholder:text-[#a2aca5] focus:border-[#5a886c] focus:bg-white focus:ring-4 focus:ring-[#5a886c]/10"
                  placeholder="Tu nombre"
                />
              </label>
            )}

            <label className="block text-sm font-medium text-[#37443d]">
              Correo electrónico
              <input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="mt-2 min-h-12 w-full rounded-xl border border-[#d9e2d9] bg-[#fcfdfb] px-4 py-3 text-[#202b27] outline-none transition placeholder:text-[#a2aca5] focus:border-[#5a886c] focus:bg-white focus:ring-4 focus:ring-[#5a886c]/10"
                placeholder="nombre@tienda.com"
              />
            </label>

            <label className="block text-sm font-medium text-[#37443d]">
              Contraseña
              <input
                type="password"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                minLength={mode === "register" ? 8 : 1}
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="mt-2 min-h-12 w-full rounded-xl border border-[#d9e2d9] bg-[#fcfdfb] px-4 py-3 text-[#202b27] outline-none transition placeholder:text-[#a2aca5] focus:border-[#5a886c] focus:bg-white focus:ring-4 focus:ring-[#5a886c]/10"
                placeholder={mode === "register" ? "Al menos 8 caracteres" : "Tu contraseña"}
              />
            </label>

            {error && (
              <p role="alert" className="rounded-md bg-[#fff1ec] px-3.5 py-3 text-sm text-[#a5432a]">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#245c4c] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#173f36] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5a886c]/20 disabled:cursor-wait disabled:opacity-60"
            >
              {busy
                ? "Un momento..."
                : mode === "login"
                  ? "Entrar al panel"
                  : "Crear cuenta"} {!busy && <ArrowRight className="size-4" aria-hidden="true" />}
            </button>
          </form>

          <div className="mt-5 border-t border-[#edf1ec] pt-2">
            <GoogleSignInButton onCredential={signInWithGoogle} />
          </div>

          <p className="mt-6 flex items-center justify-center gap-1.5 text-center text-xs leading-5 text-[#849087]">
            <LockKeyhole className="size-3.5 shrink-0" aria-hidden="true" />
            La sesión queda protegida en una cookie segura de este sitio.
          </p>
        </section>
      </div>
    </main>
  );
}
