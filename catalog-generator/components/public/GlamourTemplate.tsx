import PublicProductCard from "@/components/public/PublicProductCard";
import PublicCategoryFilter from "@/components/public/PublicCategoryFilter";
import PublicProductPagination from "@/components/public/PublicProductPagination";
import { PublicCatalogTemplateProps } from "@/components/public/PublicCatalogTemplateProps";
import PublicProductToolbar from "@/components/public/PublicProductToolbar";
import PublicCatalogContact from "@/components/public/PublicCatalogContact";

export default function GlamourTemplate({ catalog, products, totalProducts, searchQuery, sortOrder, onSearchChange, onSortChange, page, pageCount, onPageChange, quantities, categories, selectedCategory, onSelectCategory, onAdd, cartCount, cartTotal }: PublicCatalogTemplateProps) {
  return (
    <div className="min-h-screen bg-[#fff4f7] text-[#45182f]">
      <header className="overflow-hidden border-b border-[#efd0dc] bg-[radial-gradient(ellipse_at_12%_20%,rgba(244,192,204,0.45),transparent_34%),radial-gradient(ellipse_at_88%_70%,rgba(223,201,235,0.55),transparent_38%),#fff4f7]">
        <div className="mx-auto max-w-7xl px-5 pb-9 pt-5 sm:px-8 sm:pb-14 sm:pt-7">
          <div className="flex items-center justify-between border-y border-[#e3b8c9] py-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#7f425b]"><span className="flex items-center gap-2">{catalog.logoUrl && <img src={catalog.logoUrl} alt="" className="size-9 rounded-full bg-white object-contain" />}<span>{catalog.name}</span></span><span className="hidden sm:block">Glamour · Color · Cuidado</span></div>
          <div className="grid items-center gap-8 py-10 sm:py-14 lg:grid-cols-[1fr_0.78fr]">
            <div>
              <span className="inline-flex rounded-full border border-[#e6c4d0] bg-white/70 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-[#8e174d]">Tu momento de belleza</span>
              <h1 className="mt-5 max-w-3xl text-balance font-serif text-5xl leading-[1.02] tracking-[-0.035em] sm:text-7xl">La magia del <em className="font-normal text-[#c12868]">color.</em></h1>
              <p className="mt-5 max-w-lg text-sm leading-7 text-[#806575]">{catalog.description || "Encuentra tus nuevos esenciales de maquillaje, cuidado y belleza."}</p>
              <a href="#productos" className="mt-7 inline-flex min-h-11 items-center gap-3 rounded-full bg-[#c12868] px-5 text-sm font-semibold text-white transition hover:bg-[#98425f]">Ver productos <span aria-hidden="true">↗</span></a>
            </div>
            <div aria-hidden="true" className="relative mx-auto grid aspect-[1.18] w-full max-w-[27rem] place-items-center overflow-hidden rounded-[2rem] border border-white/70 bg-[linear-gradient(135deg,#f7d3df,#ead6e1_52%,#f6d8e2)] shadow-[0_22px_60px_rgba(145,79,108,0.12)]">
              <div className="absolute -left-7 top-8 size-32 rounded-full bg-[#df70a0]/45 blur-sm" />
              <div className="absolute -right-4 bottom-4 size-40 rounded-full bg-[#b65f87]/45 blur-sm" />
              <div className="relative grid size-44 place-items-center rounded-full border border-white/80 bg-[radial-gradient(circle_at_35%_30%,#fff9f5,#efb9ca_54%,#d183a2)] shadow-[0_16px_40px_rgba(128,64,92,0.2)] sm:size-52"><div className="grid size-28 place-items-center rounded-full border border-white/60 bg-[linear-gradient(145deg,#e8b9c6,#8e174d)] shadow-inner sm:size-36"><span className="font-serif text-3xl italic text-white/90">Miley</span></div></div>
              <span className="absolute bottom-4 left-5 text-[9px] font-bold uppercase tracking-[0.18em] text-[#713550]">Color · Cuidado · Esencia</span>
              <span className="absolute right-5 top-5 rounded-full bg-white/75 px-3 py-1.5 text-[9px] font-bold uppercase tracking-[0.15em] text-[#a04e6e]">Glamour edit</span>
            </div>
          </div>
          <div className="flex items-center justify-between border-t border-[#e3b8c9] pt-4 text-[10px] font-semibold uppercase tracking-[0.17em] text-[#9c6680]"><span>Encuentra tus favoritos</span><span>{String(totalProducts).padStart(2, "0")} esenciales</span></div>
        </div>
      </header>
      <PublicCategoryFilter categories={categories} selectedId={selectedCategory} variant="beauty" onSelect={onSelectCategory} publicId={catalog.publicId} cartCount={cartCount} cartTotal={cartTotal} />
      <section id="productos" className="mx-auto max-w-7xl scroll-mt-16 px-5 py-8 sm:px-8 sm:py-12">
        <div className="mb-5 flex items-end justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#c12868]">La colección</p><h2 className="mt-2 font-serif text-3xl">Favoritos para ti</h2></div><span className="hidden rounded-full bg-[#f7e8ed] px-3 py-1.5 text-xs font-semibold text-[#9b5570] sm:block">Un ritual para ti</span></div>
        <PublicProductToolbar searchQuery={searchQuery} sortOrder={sortOrder} totalProducts={totalProducts} onSearchChange={onSearchChange} onSortChange={onSortChange} />
        {products.length === 0 ? <p className="border-b border-[#efd0dc] py-16 text-center text-sm text-[#806575]">{searchQuery ? `No encontramos productos para “${searchQuery}”. Prueba otra búsqueda.` : "Estamos preparando nuevos favoritos para ti."}</p> : <div className="grid grid-cols-2 gap-3 pt-5 sm:gap-4 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">{products.map((product) => <PublicProductCard key={product.id} catalogPublicId={catalog.publicId} product={product} quantity={quantities[product.id] ?? 0} layout="beauty" onAdd={onAdd} />)}</div>}
        <PublicProductPagination page={page} pageCount={pageCount} totalProducts={totalProducts} onPageChange={onPageChange} variant="beauty" />
      </section>
      <PublicCatalogContact catalog={catalog} />
    </div>
  );
}
