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
    ? { nav: "border-[var(--catalog-border-subtle,#26394a)]", text: "text-[var(--catalog-text-muted,#a9bccd)]", button: "border-[var(--catalog-border,#34495c)] bg-[var(--catalog-surface,#101e2d)] text-[var(--catalog-text,#e5f2ff)] hover:bg-[var(--catalog-surface-hover,#1b2c3d)]" }
    : variant === "fashion"
      ? { nav: "border-[var(--catalog-border-subtle,#e5d9d0)]", text: "text-[var(--catalog-text-muted,#766b64)]", button: "border-[var(--catalog-border,#d8c9bf)] bg-[var(--catalog-surface,#fffdfa)] text-[var(--catalog-text,#322c29)] hover:bg-[var(--catalog-soft,#f2e9e3)]" }
      : variant === "beauty"
        ? { nav: "border-[var(--catalog-border-subtle,#f0dce2)]", text: "text-[var(--catalog-text-muted,#806575)]", button: "border-[var(--catalog-border,#e8cbd5)] bg-[var(--catalog-surface,#ffffff)] text-[var(--catalog-text,#552e48)] hover:bg-[var(--catalog-soft,#fbedf1)]" }
        : { nav: "border-[var(--catalog-border-subtle,#d8ded6)]", text: "text-[var(--catalog-text-muted,#647268)]", button: "border-[var(--catalog-border,#cbd4cb)] bg-[var(--catalog-surface,#ffffff)] text-[var(--catalog-text,#33483c)] hover:bg-[var(--catalog-soft,#eef2e7)]" };

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
