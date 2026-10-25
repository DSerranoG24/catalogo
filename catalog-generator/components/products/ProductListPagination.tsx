import type { ProductPage } from "@/lib/api";

export default function ProductListPagination({ result, disabled, onPageChange }: {
  result: ProductPage; disabled: boolean; onPageChange: (page: number) => void;
}) {
  const { page, pageSize, totalFiltered, totalPages } = result;
  const first = totalFiltered ? (page - 1) * pageSize + 1 : 0;
  const last = Math.min(page * pageSize, totalFiltered);
  const button = "min-h-11 rounded-xl border border-[#d6dfd7] bg-white px-3 text-sm font-semibold text-[var(--brand-emerald)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-emerald)] disabled:opacity-50";
  return <nav aria-label="Paginación de productos del panel" className="mt-4 flex flex-wrap items-center justify-between gap-3">
    <p role="status" className="text-xs tabular-nums text-[#52655a]">Mostrando {first}–{last} de {totalFiltered}</p>
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className={button} disabled={disabled || page <= 1} onClick={() => onPageChange(page - 1)}>Anterior</button>
      <span className="text-xs tabular-nums text-[#52655a]">Página {page} de {totalPages}</span>
      <button type="button" className={button} disabled={disabled || page >= totalPages} onClick={() => onPageChange(page + 1)}>Siguiente</button>
    </div>
  </nav>;
}
