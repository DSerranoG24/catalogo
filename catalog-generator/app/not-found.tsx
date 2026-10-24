import Link from "next/link";
export default function NotFound() {
  return <main className="mx-auto max-w-xl px-6 py-20 text-center"><h1 className="text-3xl font-semibold">Este enlace no está disponible</h1><p className="mt-4">El catálogo o producto no existe o ya no está publicado. Pide al vendedor un enlace actualizado.</p><Link href="/login" className="mt-6 inline-block underline focus-visible:outline-2">Acceso para vendedores</Link></main>;
}
