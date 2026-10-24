"use client";
export default function CatalogError({ reset }: { reset: () => void }) {
  return <main className="mx-auto max-w-xl px-6 py-20 text-center"><h1 className="text-2xl font-semibold">No pudimos cargar el catálogo en este momento</h1><p role="alert" className="mt-4">Puede ser un problema temporal de conexión. Intenta de nuevo.</p><button onClick={reset} className="mt-6 rounded border px-5 py-3 focus-visible:outline-2">Reintentar</button></main>;
}
