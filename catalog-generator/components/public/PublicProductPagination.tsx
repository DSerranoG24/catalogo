export default function PublicProductPagination({
  page,
  pageCount,
  totalProducts,
  onPageChange,
  pageSize = 20,
  variant = "default",
}: {
  page: number;
  pageCount: number;
  totalProducts: number;
  onPageChange: (page: number) => void;
  pageSize?: number;
  variant?: "default" | "tech" | "fashion" | "beauty";
}) {
  if (totalProducts === 0) return null;

  const firstProduct = (page - 1) * pageSize + 1;
  const lastProduct = Math.min(page * pageSize, totalProducts);
  const tones = variant === "tech"
    ? { nav: "border-[#26394a]", text: "text-[#a9bccd]", button: "border-[#34495c] bg-[#101e2d] text-[#e5f2ff] hover:bg-[#1b2c3d]" }
    : variant === "fashion"
      ? { nav: "border-[#e5d9d0]", text: "text-[#766b64]", button: "border-[#d8c9bf] bg-[#fffdfa] text-[#322c29] hover:bg-[#f2e9e3]" }
      : variant === "beauty"
        ? { nav: "border-[#f0dce2]", text: "text-[#806575]", button: "border-[#e8cbd5] bg-white text-[#552e48] hover:bg-[#fbedf1]" }
        : { nav: "border-[#d8ded6]", text: "text-[#647268]", button: "border-[#cbd4cb] bg-white text-[#33483c] hover:bg-[#eef2e7]" };

  return (
    <nav aria-label="Paginación del catálogo" className={`mt-8 flex flex-wrap items-center justify-between gap-3 border-t pt-5 text-sm ${tones.nav}`}>
      <p className={`text-xs ${tones.text}`}>
        {firstProduct}–{lastProduct} de {totalProducts} productos
      </p>
      {pageCount > 1 && (
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => onPageChange(page - 1)} disabled={page <= 1} aria-label="Página anterior" className={`grid size-10 place-items-center border text-lg transition disabled:cursor-not-allowed disabled:opacity-40 ${tones.button}`}>←</button>
          <span aria-live="polite" className={`min-w-24 text-center text-xs font-semibold tabular-nums ${tones.text}`}>Página {page} de {pageCount}</span>
          <button type="button" onClick={() => onPageChange(page + 1)} disabled={page >= pageCount} aria-label="Página siguiente" className={`grid size-10 place-items-center border text-lg transition disabled:cursor-not-allowed disabled:opacity-40 ${tones.button}`}>→</button>
        </div>
      )}
    </nav>
  );
}
