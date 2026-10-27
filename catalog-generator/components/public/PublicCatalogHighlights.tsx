import Image from "next/image";
import type { PublicCatalog, PublicProduct } from "@/lib/api";
import { normalizeCatalogTemplate } from "@/lib/catalogTemplates";
import { publicCategoryHref } from "@/lib/public-category";
import PublicProductCard from "./PublicProductCard";
import PublicHorizontalRail from "./PublicHorizontalRail";
import styles from "./PublicCatalogExtras.module.css";

export default function PublicCatalogHighlights({ catalog, quantities, onAdd, onSelectCategory }: {
  catalog: PublicCatalog; quantities: Record<string, number>; onAdd: (product: PublicProduct) => void;
  onSelectCategory: (id: string) => void;
}) {
  const banners = catalog.banners ?? [], featured = catalog.featuredProducts ?? [];
  if (!banners.length && featured.length < 3) return null;
  const template = normalizeCatalogTemplate(catalog.template);
  const layout = template === "TECH" ? "tech" : template === "FASHION" ? "fashion" : "beauty";
  return <div data-catalog-highlights data-template={template} className={styles.scope}>
    {banners.length > 0 && <PublicHorizontalRail title="Anuncios destacados" variant="banner" singleStatic={banners.length === 1} items={banners.map((banner, index) => {
      const product = banner.linkType === "PRODUCT" ? catalog.products.find(item => item.id === banner.linkValue) : null;
      const href = banner.linkType === "PRODUCT" && product ? `/c/${encodeURIComponent(catalog.publicId)}/producto/${encodeURIComponent(product.slug)}`
        : banner.linkType === "CATEGORY" ? publicCategoryHref(catalog.publicId, banner.linkValue) : banner.linkValue;
      return <a key={banner.id} href={href} className={styles.bannerLink} onClick={event => {
        if (banner.linkType === "CATEGORY" && !event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { event.preventDefault(); onSelectCategory(banner.linkValue); }
      }}>
        <div className={styles.image}><Image src={banner.imageUrl} alt="" fill unoptimized sizes="(max-width: 640px) 85vw, 544px" loading={index === 0 ? "eager" : "lazy"} /></div>
        <div data-banner-panel className={styles.panel}><h3>{banner.title}</h3>{banner.subtitle && <p>{banner.subtitle}</p>}</div>
      </a>;
    })} />}
    {featured.length >= 3 && <PublicHorizontalRail title="Destacados" variant="product" items={featured.map(product => <PublicProductCard key={product.id} catalogPublicId={catalog.publicId} product={product} quantity={quantities[product.id] ?? 0} layout={layout} onAdd={onAdd} imageSizes="(max-width: 320px) 80vw, 240px" />)} />}
  </div>;
}
