import PublicProductCard from "@/components/public/PublicProductCard";
import PublicCategoryFilter from "@/components/public/PublicCategoryFilter";
import PublicProductPagination from "@/components/public/PublicProductPagination";
import { PublicCatalogTemplateProps } from "@/components/public/PublicCatalogTemplateProps";
import PublicProductToolbar from "@/components/public/PublicProductToolbar";
import PublicCatalogContact from "@/components/public/PublicCatalogContact";

export default function EditorialTemplate({ catalog, products, totalProducts, searchQuery, sortOrder, onSearchChange, onSortChange, page, pageCount, onPageChange, quantities, categories, selectedCategory, onSelectCategory, onAdd, cartCount, cartTotal }: PublicCatalogTemplateProps) {
  return (
    <div className="min-h-screen bg-[#f4f3eb] text-[#263b31]">
      <header className="border-b border-[#d6d8ca]">
        <div className="mx-auto max-w-7xl px-5 pb-5 pt-6 sm:px-8 sm:pt-8">
          <div className="flex items-center justify-between border-y border-[#d6d8ca] py-3 text-[10px] font-semibold uppercase text-[#68756e]">
            <span>{catalog.name}</span><span className="text-[#ad553b]">Selección independiente</span>
          </div>
          <div className="grid gap-8 py-10 sm:py-14 lg:grid-cols-[minmax(0,1fr)_16rem] lg:items-end">
            <div>
              <p className="text-xs font-semibold uppercase text-[#ad553b]">Colección seleccionada</p>
              <h1 className="mt-3 max-w-4xl text-balance font-serif text-5xl leading-[1.04] sm:text-7xl">{catalog.name}</h1>
              {catalog.description && <p className="mt-5 max-w-2xl text-base leading-7 text-[#58665b]">{catalog.description}</p>}
              <a href="#productos" className="mt-6 inline-flex min-h-11 items-center gap-3 border-b border-[#263b31] text-sm font-semibold text-[#263b31]">Explorar productos <span aria-hidden="true">↓</span></a>
            </div>
            <div className="flex items-end justify-between border-t border-[#d6d8ca] pt-4 lg:block lg:border-l lg:border-t-0 lg:pb-1 lg:pl-6">
              <span className="text-[10px] font-semibold uppercase text-[#68756e]">En esta selección</span>
              <p className="font-serif text-4xl text-[#ad553b] lg:mt-2 lg:text-6xl">{totalProducts.toString().padStart(2, "0")}</p>
              <span className="text-xs text-[#68756e]">productos</span>
            </div>
          </div>
        </div>
      </header>
      <PublicCategoryFilter categories={categories} selectedId={selectedCategory} variant="editorial" onSelect={onSelectCategory} publicId={catalog.publicId} cartCount={cartCount} cartTotal={cartTotal} />
      <section id="productos" className="mx-auto max-w-7xl scroll-mt-16 px-5 py-7 sm:px-8 sm:py-10">
        <div className="mb-5 flex items-end justify-between gap-3">
          <div><p className="text-[10px] font-semibold uppercase text-[#ad553b]">La colección</p><h2 className="mt-1 font-serif text-2xl">Piezas para descubrir</h2></div>
        </div>
        <PublicProductToolbar searchQuery={searchQuery} sortOrder={sortOrder} totalProducts={totalProducts} onSearchChange={onSearchChange} onSortChange={onSortChange} />
        {products.length === 0 ? <p className="border-b border-[#d6d8ca] py-16 text-center text-sm text-[#68756e]">{searchQuery ? `No encontramos productos para “${searchQuery}”. Prueba otra búsqueda.` : "Pronto habrá novedades en esta colección."}</p> : <div className="grid gap-5 pt-5 sm:grid-cols-2 lg:grid-cols-3">{products.map((product, index) => <PublicProductCard key={product.id} catalogPublicId={catalog.publicId} product={product} quantity={quantities[product.id] ?? 0} layout="editorial" featured={index === 0 && products.length > 2} onAdd={onAdd} />)}</div>}
        <PublicProductPagination page={page} pageCount={pageCount} totalProducts={totalProducts} onPageChange={onPageChange} />
      </section>
      <PublicCatalogContact catalog={catalog} />
    </div>
  );
}
