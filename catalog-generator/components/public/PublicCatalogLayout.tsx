import type { ReactNode } from "react";
import type { PublicCatalog } from "@/lib/api";
import { normalizeCatalogLayout } from "@/lib/catalog-layout";
import PublicCatalogContact from "./PublicCatalogContact";
import styles from "./PublicCatalogLayout.module.css";

type Props = {
  catalog: PublicCatalog;
  categories: ReactNode;
  heading: ReactNode;
  toolbar: ReactNode;
  children: ReactNode;
  pagination: ReactNode;
};

const sectionClass = "mx-auto max-w-7xl scroll-mt-16 px-5 py-8 sm:px-8 sm:py-12";

export default function PublicCatalogLayout({ catalog, categories, heading, toolbar, children, pagination }: Props) {
  const layout = normalizeCatalogLayout(catalog.layoutPreset);
  if (!layout) return <>{categories}<section id="productos" className={sectionClass}>{heading}{toolbar}{children}{pagination}</section></>;

  const full = layout === "sidebar";
  return (
    <div className={`${styles.layout} ${full ? "" : styles.compact} ${catalog.template === "TECH" || catalog.template === "GRID" ? styles.tech : ""}`} data-catalog-layout={layout}>
      <aside aria-label="Navegación del catálogo" className={styles.sidebar}>
        {categories}
        {full && <div className={styles.sideToolbar}>{toolbar}</div>}
        {full && <div className={styles.contact}><PublicCatalogContact catalog={catalog} compact /></div>}
      </aside>
      <section id="productos" className={`${sectionClass} ${styles.main}`}>
        {heading}
        {!full && toolbar}
        <div className={styles.products}>{children}</div>
        {pagination}
      </section>
    </div>
  );
}
