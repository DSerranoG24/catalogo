import Link from "next/link";
export default function NotFound() {
  return <main className="mx-auto max-w-xl px-5 py-12 text-center">
    <h1 className="text-2xl font-semibold">Página no disponible</h1>
    <p className="mt-3">No se encontró la página solicitada.</p>
    <Link href="/" className="mt-5 inline-flex min-h-11 items-center rounded-lg text-[var(--brand-emerald)] focus-visible:outline-2 focus-visible:outline-offset-4">Volver al inicio</Link>
  </main>;
}
