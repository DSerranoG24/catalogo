import PublicCatalogLayout from "./PublicCatalogLayout";
import PublicCatalogIdentity from "./PublicCatalogIdentity";
import PublicCatalogHighlights from "./PublicCatalogHighlights";
﻿import PublicProductCard from "@/components/public/PublicProductCard";
import PublicCategoryFilter from "@/components/public/PublicCategoryFilter";
import PublicProductPagination from "@/components/public/PublicProductPagination";
import { PublicCatalogTemplateProps } from "@/components/public/PublicCatalogTemplateProps";
import PublicProductToolbar from "@/components/public/PublicProductToolbar";
import PublicCatalogContact from "@/components/public/PublicCatalogContact";

export default function GlamourTemplate({ catalog, products, totalProducts, searchQuery, sortOrder, onSearchChange, onSortChange, page, pageCount, onPageChange, quantities, categories, selectedCategory, onSelectCategory, onAdd, cartCount, cartTotal }: PublicCatalogTemplateProps) {
  return (
    <div className="min-h-screen bg-[var(--catalog-background,#fff4f7)] text-[var(--catalog-text,#45182f)]">
      <header className="overflow-hidden border-b border-[var(--catalog-border-subtle,#efd0dc)] bg-[image:var(--catalog-hero-background,radial-gradient(ellipse_at_12%_20%,rgba(244,192,204,0.45),transparent_34%),radial-gradient(ellipse_at_88%_70%,rgba(223,201,235,0.55),transparent_38%),#fff4f7)]">
        <div className="mx-auto max-w-7xl px-5 pb-9 pt-5 sm:px-8 sm:pb-14 sm:pt-7">
          <PublicCatalogIdentity catalog={catalog} />
          <div className="grid items-center gap-8 py-10 sm:py-14 lg:grid-cols-[1fr_0.78fr]">
            <div>
              <span className="inline-flex rounded-full border border-[var(--catalog-border-subtle,#e6c4d0)] bg-[var(--catalog-surface-alpha-70,color-mix(in_oklab,var(--color-white)_70%,transparent))] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--catalog-primary,#8e174d)]">Tu momento de belleza</span>
              <h1 className="mt-5 max-w-3xl text-balance font-serif text-5xl leading-[1.02] tracking-[-0.035em] sm:text-7xl">La magia del <em className="font-normal text-[var(--catalog-primary,#c12868)]">color.</em></h1>
              <p className="mt-5 max-w-lg text-sm leading-7 text-[var(--catalog-text-muted,#806575)]">{catalog.description || "Encuentra tus nuevos esenciales de maquillaje, cuidado y belleza."}</p>
              <a href="#productos" className="mt-7 inline-flex min-h-11 items-center gap-3 rounded-full bg-[var(--catalog-primary,#c12868)] px-5 text-sm font-semibold text-[var(--catalog-on-primary,#ffffff)] transition hover:bg-[var(--catalog-primary-hover,#98425f)]">Ver productos <span aria-hidden="true">↗</span></a>
            </div>
            <div aria-hidden="true" className="relative mx-auto grid aspect-[1.18] w-full max-w-[27rem] place-items-center overflow-hidden rounded-[2rem] border border-[var(--catalog-border-subtle-alpha-70,color-mix(in_oklab,var(--color-white)_70%,transparent))] bg-[image:var(--catalog-art-background,linear-gradient(135deg,#f7d3df,#ead6e1_52%,#f6d8e2))] shadow-[var(--catalog-shadow,0_22px_60px_rgba(145,79,108,0.12))]">
              <div className="absolute -left-7 top-8 size-32 rounded-full bg-[var(--catalog-soft-alpha-45,color-mix(in_oklab,#df70a0_45%,transparent))] blur-sm" />
              <div className="absolute -right-4 bottom-4 size-40 rounded-full bg-[var(--catalog-soft-alpha-45,color-mix(in_oklab,#b65f87_45%,transparent))] blur-sm" />
              <div className="relative grid size-44 place-items-center rounded-full border border-[var(--catalog-border-subtle-alpha-80,color-mix(in_oklab,var(--color-white)_80%,transparent))] bg-[image:var(--catalog-art-background,radial-gradient(circle_at_35%_30%,#fff9f5,#efb9ca_54%,#d183a2))] shadow-[var(--catalog-shadow,0_16px_40px_rgba(128,64,92,0.2))] sm:size-52"><div className="grid size-28 place-items-center rounded-full border border-[var(--catalog-border-subtle-alpha-60,color-mix(in_oklab,var(--color-white)_60%,transparent))] bg-[image:var(--catalog-art-background,linear-gradient(145deg,#e8b9c6,#8e174d))] shadow-inner sm:size-36"><span className="font-serif text-3xl italic text-[var(--catalog-text-alpha-90,color-mix(in_oklab,var(--color-white)_90%,transparent))]">Miley</span></div></div>
              <span className="absolute bottom-4 left-5 text-[9px] font-bold uppercase tracking-[0.18em] text-[var(--catalog-text-muted,#713550)]">Color · Cuidado · Esencia</span>
              <span className="absolute right-5 top-5 rounded-full bg-[var(--catalog-surface-alpha-75,color-mix(in_oklab,var(--color-white)_75%,transparent))] px-3 py-1.5 text-[9px] font-bold uppercase tracking-[0.15em] text-[var(--catalog-primary,#a04e6e)]">Glamour edit</span>
            </div>
          </div>
          <div className="flex items-center justify-between border-t border-[var(--catalog-border-subtle,#e3b8c9)] pt-4 text-[10px] font-semibold uppercase tracking-[0.17em] text-[var(--catalog-text-muted,#9c6680)]"><span>Encuentra tus favoritos</span><span>{String(totalProducts).padStart(2, "0")} esenciales</span></div>
        </div>
      </header>
      <PublicCatalogHighlights catalog={catalog} quantities={quantities} onAdd={onAdd} onSelectCategory={onSelectCategory} />
      <PublicCatalogLayout catalog={catalog} categories={<PublicCategoryFilter categories={categories} selectedId={selectedCategory} variant="beauty" onSelect={onSelectCategory} publicId={catalog.publicId} cartCount={cartCount} cartTotal={cartTotal} />} heading={<div className="mb-5 flex items-end justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--catalog-primary,#c12868)]">La colección</p><h2 className="mt-2 font-serif text-3xl">Favoritos para ti</h2></div><span className="hidden rounded-full bg-[var(--catalog-soft,#f7e8ed)] px-3 py-1.5 text-xs font-semibold text-[var(--catalog-primary,#9b5570)] sm:block">Un ritual para ti</span></div>} toolbar={<PublicProductToolbar searchQuery={searchQuery} sortOrder={sortOrder} totalProducts={totalProducts} onSearchChange={onSearchChange} onSortChange={onSortChange} />} pagination={<PublicProductPagination page={page} pageCount={pageCount} totalProducts={totalProducts} onPageChange={onPageChange} variant="beauty" />}>
        {products.length === 0 ? <p className="border-b border-[var(--catalog-border-subtle,#efd0dc)] py-16 text-center text-sm text-[var(--catalog-text-muted,#806575)]">{searchQuery ? `No encontramos productos para “${searchQuery}”. Prueba otra búsqueda.` : "Estamos preparando nuevos favoritos para ti."}</p> : <div className="grid grid-cols-2 gap-3 pt-5 sm:gap-4 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">{products.map((product) => <PublicProductCard key={product.id} catalogPublicId={catalog.publicId} product={product} quantity={quantities[product.id] ?? 0} layout="beauty" onAdd={onAdd} />)}</div>}
      </PublicCatalogLayout>
      <PublicCatalogContact catalog={catalog} />
    </div>
  );
}
