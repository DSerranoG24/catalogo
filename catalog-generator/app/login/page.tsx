"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { apiRequest, saveSession, Session } from "@/lib/api";
import GoogleSignInButton from "@/components/auth/GoogleSignInButton";

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
    <main className="flex min-h-screen items-center justify-center px-5 py-12">
      <div className="w-full max-w-md">
        <Link href="/" className="mb-10 inline-flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-lg bg-[#17665c] text-lg font-bold text-white">
            C
          </span>
          <span className="text-lg font-semibold text-[#202b27]">
            Catalogo
          </span>
        </Link>

        <section className="rounded-lg border border-[#dce4dc] bg-white p-7 shadow-[0_18px_60px_-38px_rgba(31,55,44,0.42)] sm:p-9">
          <p className="text-xs font-semibold uppercase text-[#c65c3d]">
            Tu espacio de trabajo
          </p>
          <h1 className="mt-3 text-3xl font-semibold text-[#202b27]">
            {mode === "login" ? "Qué bueno verte." : "Crea tu cuenta."}
          </h1>
          <p className="mt-2 text-sm leading-6 text-[#68756e]">
            {mode === "login"
              ? "Inicia sesión para administrar tus catálogos."
              : "Un espacio para organizar tus productos y compartirlos."}
          </p>

          <div className="mt-7 grid grid-cols-2 rounded-lg bg-[#f0f4ef] p-1">
            {(["login", "register"] as const).map((authMode) => (
              <button
                key={authMode}
                type="button"
                onClick={() => {
                  setMode(authMode);
                  setError("");
                }}
                className={`rounded-md px-3 py-2.5 text-sm font-medium transition ${
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
                  className="mt-2 w-full rounded-md border border-[#d6dfd7] bg-white px-3.5 py-3 text-[#202b27] outline-none transition placeholder:text-[#a2aca5] focus:border-[#17665c] focus:ring-2 focus:ring-[#17665c]/15"
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
                className="mt-2 w-full rounded-md border border-[#d6dfd7] bg-white px-3.5 py-3 text-[#202b27] outline-none transition placeholder:text-[#a2aca5] focus:border-[#17665c] focus:ring-2 focus:ring-[#17665c]/15"
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
                className="mt-2 w-full rounded-md border border-[#d6dfd7] bg-white px-3.5 py-3 text-[#202b27] outline-none transition placeholder:text-[#a2aca5] focus:border-[#17665c] focus:ring-2 focus:ring-[#17665c]/15"
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
              className="w-full rounded-md bg-[#17665c] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#10554c] disabled:cursor-wait disabled:opacity-60"
            >
              {busy
                ? "Un momento..."
                : mode === "login"
                  ? "Entrar al panel"
                  : "Crear cuenta"}
            </button>
          </form>

          <div className="mt-5 border-t border-[#edf1ec] pt-2">
            <GoogleSignInButton onCredential={signInWithGoogle} />
          </div>

          <p className="mt-6 text-center text-xs leading-5 text-[#849087]">
            La sesión queda protegida en una cookie segura de este sitio.
          </p>
        </section>
      </div>
    </main>
  );
}