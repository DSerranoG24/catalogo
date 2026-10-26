import { Button } from "@/components/ui/Button";
import type { ProductPage } from "@/lib/api";

export default function ProductListPagination({ result, disabled, onPageChange }: {
  result: ProductPage; disabled: boolean; onPageChange: (page: number) => void;
}) {
  const { page, pageSize, totalFiltered, totalPages } = result;
  const first = totalFiltered ? (page - 1) * pageSize + 1 : 0;
  const last = Math.min(page * pageSize, totalFiltered);

  return <nav aria-label="Paginación de productos del panel" className="mt-4 flex flex-wrap items-center justify-between gap-3">
    <p role="status" className="text-xs tabular-nums text-[#52655a]">Mostrando {first}–{last} de {totalFiltered}</p>
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="secondary" type="button"  disabled={disabled || page <= 1} onClick={() => onPageChange(page - 1)}>Anterior</Button>
      <span className="text-xs tabular-nums text-[#52655a]">Página {page} de {totalPages}</span>
      <Button variant="secondary" type="button"  disabled={disabled || page >= totalPages} onClick={() => onPageChange(page + 1)}>Siguiente</Button>
    </div>
  </nav>;
}
