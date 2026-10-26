import PublicProductCard from "@/components/public/PublicProductCard";
import PublicCategoryFilter from "@/components/public/PublicCategoryFilter";
import PublicProductPagination from "@/components/public/PublicProductPagination";
import { PublicCatalogTemplateProps } from "@/components/public/PublicCatalogTemplateProps";
import PublicProductToolbar from "@/components/public/PublicProductToolbar";
import PublicCatalogContact from "@/components/public/PublicCatalogContact";

export default function FashionTemplate({ catalog, products, totalProducts, searchQuery, sortOrder, onSearchChange, onSortChange, page, pageCount, onPageChange, quantities, categories, selectedCategory, onSelectCategory, onAdd, cartCount, cartTotal }: PublicCatalogTemplateProps) {
  return (
    <div className="min-h-screen bg-[var(--catalog-background,#f7f2ec)] text-[var(--catalog-text,#322c29)]">
      <header className="border-b border-[var(--catalog-border-subtle,#e5d9d0)] bg-[image:var(--catalog-hero-background,radial-gradient(ellipse_at_82%_15%,rgba(205,161,147,0.22),transparent_34%),#f7f2ec)]">
        <div className="mx-auto max-w-7xl px-5 pb-9 pt-5 sm:px-8 sm:pb-14 sm:pt-7">
          <div className="flex items-center justify-between border-y border-[var(--catalog-border-subtle,#d8c9bf)] py-3 text-[10px] font-semibold uppercase tracking-[0.19em] text-[var(--catalog-text-muted,#766b64)]"><span className="flex items-center gap-2">{catalog.logoUrl && <img src={catalog.logoUrl} alt="" className="size-9 rounded-full bg-[var(--catalog-surface,#ffffff)] object-contain" />}<span>{catalog.name}</span></span><span className="hidden sm:block">Est. · Colección independiente</span></div>
          <div className="grid items-center gap-8 py-10 sm:py-14 lg:grid-cols-[1fr_0.78fr]">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[var(--catalog-primary,#9a554b)]">Vestir también es expresarse</p>
              <h1 className="mt-4 max-w-3xl text-balance font-serif text-5xl leading-[0.98] tracking-[-0.035em] sm:text-7xl">Piezas para <em className="font-normal text-[var(--catalog-primary,#9a554b)]">ser tú.</em></h1>
              <p className="mt-5 max-w-lg text-sm leading-7 text-[var(--catalog-text-muted,#756b64)]">{catalog.description || "Siluetas versátiles, materiales que se sienten bien y detalles que cuentan historias."}</p>
              <a href="#productos" className="mt-7 inline-flex min-h-11 items-center gap-3 border-b border-[var(--catalog-border-subtle,#322c29)] text-sm font-semibold">Descubrir la colección <span aria-hidden="true">↗</span></a>
            </div>
            <div aria-hidden="true" className="relative min-h-64 overflow-hidden rounded-[45%_45%_8px_8px] border border-[var(--catalog-border-subtle,#e5d9d0)] bg-[image:var(--catalog-art-background,linear-gradient(155deg,#e7cfc1,#d6b2a2_55%,#bd8f81))] sm:min-h-80">
              <div className="absolute inset-x-[17%] bottom-0 top-[12%] rounded-t-[48%] bg-[image:var(--catalog-art-background,linear-gradient(125deg,rgba(255,250,246,0.6),rgba(122,76,66,0.26)))]" />
              <div className="absolute inset-x-[30%] bottom-0 top-[27%] rounded-t-[45%] border-x border-[var(--catalog-border-subtle-alpha-35,color-mix(in_oklab,var(--color-white)_35%,transparent))] bg-[image:var(--catalog-art-background,linear-gradient(110deg,#f4e7dd,#b47f71_72%))] shadow-[var(--catalog-shadow,0_15px_45px_rgba(70,44,39,0.15))]" />
              <div className="absolute bottom-5 left-5 rounded-full bg-[var(--catalog-surface-alpha-85,color-mix(in_oklab,#fffaf6_85%,transparent))] px-4 py-2 text-[9px] font-bold uppercase tracking-[0.18em] text-[var(--catalog-text-muted,#734e45)] backdrop-blur">Editorial · {catalog.name}</div>
              <span className="absolute right-5 top-5 font-serif text-6xl italic text-[var(--catalog-text-alpha-70,color-mix(in_oklab,var(--color-white)_70%,transparent))]">01</span>
            </div>
          </div>
          <div className="flex items-center justify-between border-t border-[var(--catalog-border-subtle,#d8c9bf)] pt-4 text-[10px] font-semibold uppercase tracking-[0.17em] text-[var(--catalog-text-muted,#8b7b71)]"><span>Nueva temporada</span><span>{String(totalProducts).padStart(2, "0")} piezas</span></div>
        </div>
      </header>
      <PublicCategoryFilter categories={categories} selectedId={selectedCategory} variant="fashion" onSelect={onSelectCategory} publicId={catalog.publicId} cartCount={cartCount} cartTotal={cartTotal} />
      <section id="productos" className="mx-auto max-w-7xl scroll-mt-16 px-5 py-8 sm:px-8 sm:py-12">
        <div className="mb-5 flex items-end justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--catalog-primary,#9a554b)]">El guardarropa</p><h2 className="mt-2 font-serif text-3xl">La colección</h2></div><p className="hidden text-xs text-[var(--catalog-text-muted,#766b64)] sm:block">Hecho para acompañarte</p></div>
        <PublicProductToolbar searchQuery={searchQuery} sortOrder={sortOrder} totalProducts={totalProducts} onSearchChange={onSearchChange} onSortChange={onSortChange} />
        {products.length === 0 ? <p className="border-b border-[var(--catalog-border-subtle,#e5d9d0)] py-16 text-center text-sm text-[var(--catalog-text-muted,#766b64)]">{searchQuery ? `No encontramos productos para “${searchQuery}”. Prueba otra búsqueda.` : "Pronto habrá piezas nuevas en esta colección."}</p> : <div className="grid grid-cols-2 gap-3 pt-5 sm:gap-4 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">{products.map((product) => <PublicProductCard key={product.id} catalogPublicId={catalog.publicId} product={product} quantity={quantities[product.id] ?? 0} layout="fashion" onAdd={onAdd} />)}</div>}
        <PublicProductPagination page={page} pageCount={pageCount} totalProducts={totalProducts} onPageChange={onPageChange} variant="fashion" />
      </section>
      <PublicCatalogContact catalog={catalog} />
    </div>
  );
}
