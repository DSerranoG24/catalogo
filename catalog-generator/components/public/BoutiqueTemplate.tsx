import PublicProductCard from "@/components/public/PublicProductCard";
import PublicCategoryFilter from "@/components/public/PublicCategoryFilter";
import PublicProductPagination from "@/components/public/PublicProductPagination";
import { PublicCatalogTemplateProps } from "@/components/public/PublicCatalogTemplateProps";
import PublicProductToolbar from "@/components/public/PublicProductToolbar";

export default function BoutiqueTemplate({ catalog, products, totalProducts, searchQuery, sortOrder, onSearchChange, onSortChange, page, pageCount, onPageChange, quantities, categories, selectedCategory, onSelectCategory, onAdd, cartCount, cartTotal }: PublicCatalogTemplateProps) {
  return (
    <div className="min-h-screen bg-[#fbf2e8] text-[#3c372f]">
      <header className="mx-auto max-w-7xl px-5 pb-7 pt-5 sm:px-8 sm:pb-10 sm:pt-7">
        <div className="flex items-center justify-between border-y border-[#e4d5c4] py-3 text-[10px] font-bold uppercase text-[#bd4d36]"><span>Objeto / {catalog.slug}</span><span>{totalProducts.toString().padStart(2, "0")} piezas</span></div>
        <div className="grid gap-6 py-9 sm:grid-cols-[minmax(0,1fr)_minmax(10rem,0.35fr)] sm:items-end sm:py-14">
          <div>
            <p className="text-xs font-semibold uppercase text-[#bd4d36]">Una colección especial</p>
            <h1 className="mt-3 max-w-4xl break-words font-serif text-5xl leading-[1.02] sm:text-7xl">{catalog.name}</h1>
            {catalog.description && <p className="mt-4 max-w-2xl text-sm leading-6 text-[#6b5b4d]">{catalog.description}</p>}
          </div>
          <p className="border-l-2 border-[#d7eb7a] pl-4 font-serif text-xl leading-7 text-[#526047] sm:ml-auto sm:max-w-48">Hecho para elegir con calma.</p>
        </div>
      </header>
      <PublicCategoryFilter categories={categories} selectedId={selectedCategory} variant="boutique" onSelect={onSelectCategory} publicId={catalog.publicId} cartCount={cartCount} cartTotal={cartTotal} />
      <section className="mx-auto max-w-7xl px-5 pb-12 pt-7 sm:px-8 sm:pb-16 sm:pt-10">
        <div className="mb-5 flex items-end justify-between gap-3">
          <div><p className="text-[10px] font-bold uppercase text-[#bd4d36]">El inventario</p><h2 className="mt-1 font-serif text-2xl">Elegidos para ti</h2></div>
        </div>
        <PublicProductToolbar searchQuery={searchQuery} sortOrder={sortOrder} totalProducts={totalProducts} onSearchChange={onSearchChange} onSortChange={onSortChange} />
        {products.length === 0 ? <p className="border-b border-[#e4d5c4] py-16 text-center text-sm text-[#766258]">{searchQuery ? `No encontramos productos para “${searchQuery}”. Prueba otra búsqueda.` : "La colección se está preparando."}</p> : <div className="grid gap-4 pt-4 sm:grid-cols-2">{products.map((product) => <PublicProductCard key={product.id} catalogPublicId={catalog.publicId} product={product} quantity={quantities[product.id] ?? 0} layout="boutique" onAdd={onAdd} />)}</div>}
        <PublicProductPagination page={page} pageCount={pageCount} totalProducts={totalProducts} onPageChange={onPageChange} />
      </section>
    </div>
  );
}
