import PublicProductCard from "@/components/public/PublicProductCard";
import PublicCategoryFilter from "@/components/public/PublicCategoryFilter";
import PublicProductPagination from "@/components/public/PublicProductPagination";
import { PublicCatalogTemplateProps } from "@/components/public/PublicCatalogTemplateProps";
import PublicProductToolbar from "@/components/public/PublicProductToolbar";

export default function GridTemplate({ catalog, products, totalProducts, searchQuery, sortOrder, onSearchChange, onSortChange, page, pageCount, onPageChange, quantities, categories, selectedCategory, onSelectCategory, onAdd, cartCount, cartTotal }: PublicCatalogTemplateProps) {
  return (
    <div className="min-h-screen bg-[#f2f5f2] text-[#1e302a]">
      <header className="border-b border-[#cbd7d0] bg-[#d7eb7a]">
        <div className="mx-auto max-w-7xl px-5 py-8 sm:px-8 sm:py-11">
          <div className="flex items-start justify-between gap-5">
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase text-[#315c53]">Catálogo / {catalog.slug}</p>
              <h1 className="mt-3 break-words text-4xl font-black leading-[0.98] sm:text-6xl">{catalog.name}</h1>
              {catalog.description && <p className="mt-4 max-w-2xl text-sm leading-6 text-[#3d5145]">{catalog.description}</p>}
            </div>
            <div className="hidden shrink-0 border-l border-[#526b46]/30 pl-5 text-right sm:block">
              <p className="text-4xl font-black tabular-nums text-[#315c53]">{totalProducts.toString().padStart(2, "0")}</p>
              <p className="mt-1 text-[10px] font-bold uppercase text-[#315c53]">artículos</p>
            </div>
          </div>
        </div>
      </header>
      <PublicCategoryFilter categories={categories} selectedId={selectedCategory} variant="grid" onSelect={onSelectCategory} publicId={catalog.publicId} cartCount={cartCount} cartTotal={cartTotal} />
      <section className="mx-auto max-w-7xl px-5 py-7 sm:px-8 sm:py-10">
        <div className="mb-5 flex items-center justify-between border-b border-[#d7ded8] pb-3">
          <h2 className="text-xs font-bold uppercase text-[#315c53]">Explorar productos</h2>
        </div>
        <PublicProductToolbar searchQuery={searchQuery} sortOrder={sortOrder} totalProducts={totalProducts} onSearchChange={onSearchChange} onSortChange={onSortChange} />
        {products.length === 0 ? <p className="border-b border-[#d7ded8] py-16 text-center text-sm text-[#68756e]">{searchQuery ? `No encontramos productos para “${searchQuery}”. Prueba otra búsqueda.` : "No hay artículos disponibles todavía."}</p> : <div className="grid grid-cols-2 gap-3 pt-4 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">{products.map((product) => <PublicProductCard key={product.id} catalogPublicId={catalog.publicId} product={product} quantity={quantities[product.id] ?? 0} layout="grid" onAdd={onAdd} />)}</div>}
        <PublicProductPagination page={page} pageCount={pageCount} totalProducts={totalProducts} onPageChange={onPageChange} />
      </section>
    </div>
  );
}
