import PublicProductCard from "@/components/public/PublicProductCard";
import PublicCategoryFilter from "@/components/public/PublicCategoryFilter";
import PublicProductPagination from "@/components/public/PublicProductPagination";
import { PublicCatalogTemplateProps } from "@/components/public/PublicCatalogTemplateProps";
import PublicProductToolbar from "@/components/public/PublicProductToolbar";
import PublicCatalogContact from "@/components/public/PublicCatalogContact";

export default function TechnologyTemplate({ catalog, products, totalProducts, searchQuery, sortOrder, onSearchChange, onSortChange, page, pageCount, onPageChange, quantities, categories, selectedCategory, onSelectCategory, onAdd, cartCount, cartTotal }: PublicCatalogTemplateProps) {
  return (
    <div className="min-h-screen bg-[#081421] text-[#e5f2ff]">
      <header className="relative overflow-hidden border-b border-[#25384b] bg-[radial-gradient(ellipse_at_78%_40%,rgba(43,180,164,0.19),transparent_38%),linear-gradient(135deg,#0c1d2d,#081421_65%)]">
        <div className="mx-auto max-w-7xl px-5 pb-10 pt-5 sm:px-8 sm:pb-16 sm:pt-7">
          <div className="flex items-center justify-between border-y border-white/10 py-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#a9bccd]">
            <span className="flex items-center gap-2">{catalog.logoUrl && <img src={catalog.logoUrl} alt="" className="size-9 rounded-lg bg-white object-contain" />}<span>{catalog.name}</span></span>
            <span className="hidden sm:block">Technology · Audio · Gaming</span>
          </div>
          <div className="grid items-center gap-10 py-10 sm:py-14 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="relative z-10">
              <span className="inline-flex items-center gap-2 rounded-full border border-[#56e0c0]/30 bg-[#56e0c0]/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-[#79f0d0]"><span className="size-1.5 rounded-full bg-[#56e0c0]" /> Lo nuevo en tecnología</span>
              <h1 className="mt-5 max-w-3xl text-balance text-5xl font-semibold leading-[0.98] tracking-[-0.055em] text-white sm:text-7xl">Tecnología que <span className="text-[#56e0c0]">se siente.</span></h1>
              <p className="mt-5 max-w-xl text-sm leading-7 text-[#a9bccd]">{catalog.description || "Descubre equipos, accesorios y novedades elegidos para acompañar tu día."}</p>
              <a href="#productos" className="mt-7 inline-flex min-h-12 items-center gap-3 rounded-md bg-[#56e0c0] px-5 text-sm font-bold text-[#071421] transition hover:bg-[#8af3d8]">Explorar dispositivos <span aria-hidden="true">↘</span></a>
            </div>
            <div aria-hidden="true" className="relative mx-auto grid aspect-square w-full max-w-[24rem] place-items-center overflow-hidden rounded-[2rem] border border-white/10 bg-[#0e2030]/80 shadow-[0_30px_100px_rgba(0,0,0,0.38)]">
              <div className="absolute inset-0 bg-[linear-gradient(rgba(122,194,207,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(122,194,207,0.06)_1px,transparent_1px)] bg-[size:28px_28px]" />
              <div className="absolute left-5 top-5 rounded border border-[#56e0c0]/25 px-2 py-1 text-[9px] font-bold tracking-[0.16em] text-[#56e0c0]">SERIES 01 / {catalog.slug.toUpperCase()}</div>
              <div className="relative grid size-52 place-items-center rounded-full border border-[#56e0c0]/20 bg-[radial-gradient(circle,rgba(86,224,192,0.22),rgba(86,224,192,0.03)_60%,transparent_62%)] sm:size-64">
                <div className="grid size-36 place-items-center rounded-full border border-[#56e0c0]/50 bg-[#0b1a28] shadow-[0_0_50px_rgba(86,224,192,0.2)] sm:size-44"><span className="font-mono text-6xl font-light tracking-[-0.1em] text-[#d7fff4]">{catalog.name.slice(0, 2).toUpperCase()}</span></div>
              </div>
              <div className="absolute bottom-5 left-5 right-5 flex items-center justify-between border-t border-white/10 pt-3 text-[9px] font-semibold uppercase tracking-[0.14em] text-[#a9bccd]"><span>Selección curada</span><span className="text-[#56e0c0]">{String(totalProducts).padStart(2, "0")} productos</span></div>
            </div>
          </div>
        </div>
      </header>
      <PublicCategoryFilter categories={categories} selectedId={selectedCategory} variant="tech" onSelect={onSelectCategory} publicId={catalog.publicId} cartCount={cartCount} cartTotal={cartTotal} />
      <section id="productos" className="mx-auto max-w-7xl scroll-mt-16 px-5 py-8 sm:px-8 sm:py-12">
        <div className="mb-5 flex items-end justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#56e0c0]">Hardware seleccionado</p><h2 className="mt-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl">Explora el catálogo</h2></div><span className="hidden font-mono text-xs text-[#7890a4] sm:block">TECH / {String(totalProducts).padStart(2, "0")}</span></div>
        <PublicProductToolbar searchQuery={searchQuery} sortOrder={sortOrder} totalProducts={totalProducts} onSearchChange={onSearchChange} onSortChange={onSortChange} />
        {products.length === 0 ? <p className="border-b border-[#26394a] py-16 text-center text-sm text-[#a9bccd]">{searchQuery ? `No encontramos productos para “${searchQuery}”. Prueba otra búsqueda.` : "Pronto habrá novedades en esta selección."}</p> : <div className="grid grid-cols-2 gap-3 pt-5 sm:gap-4 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">{products.map((product) => <PublicProductCard key={product.id} catalogPublicId={catalog.publicId} product={product} quantity={quantities[product.id] ?? 0} layout="tech" onAdd={onAdd} />)}</div>}
        <PublicProductPagination page={page} pageCount={pageCount} totalProducts={totalProducts} onPageChange={onPageChange} variant="tech" />
      </section>
      <PublicCatalogContact catalog={catalog} />
    </div>
  );
}
