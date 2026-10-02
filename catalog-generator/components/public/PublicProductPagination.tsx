export default function PublicProductPagination({
  page,
  pageCount,
  totalProducts,
  onPageChange,
}: {
  page: number;
  pageCount: number;
  totalProducts: number;
  onPageChange: (page: number) => void;
}) {
  if (totalProducts === 0) return null;

  const firstProduct = (page - 1) * 12 + 1;
  const lastProduct = Math.min(page * 12, totalProducts);

  return (
    <nav aria-label="Paginación del catálogo" className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-[#d8ded6] pt-5 text-sm">
      <p className="text-xs text-[#647268]">
        {firstProduct}–{lastProduct} de {totalProducts} productos
      </p>
      {pageCount > 1 && (
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => onPageChange(page - 1)} disabled={page <= 1} aria-label="Página anterior" className="grid size-10 place-items-center border border-[#cbd4cb] bg-white text-lg text-[#33483c] transition hover:bg-[#eef2e7] disabled:cursor-not-allowed disabled:opacity-40">←</button>
          <span aria-live="polite" className="min-w-24 text-center text-xs font-semibold tabular-nums text-[#435047]">Página {page} de {pageCount}</span>
          <button type="button" onClick={() => onPageChange(page + 1)} disabled={page >= pageCount} aria-label="Página siguiente" className="grid size-10 place-items-center border border-[#cbd4cb] bg-white text-lg text-[#33483c] transition hover:bg-[#eef2e7] disabled:cursor-not-allowed disabled:opacity-40">→</button>
        </div>
      )}
    </nav>
  );
}