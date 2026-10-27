import Image from "next/image";
import type { PublicCatalog } from "@/lib/api";
import { normalizeCatalogTemplate } from "@/lib/catalogTemplates";
import styles from "./PublicCatalogExtras.module.css";

export default function PublicCatalogIdentity({ catalog }: { catalog: PublicCatalog }) {
  const hours = catalog.businessHours?.trim();
  return <div data-catalog-identity data-template={normalizeCatalogTemplate(catalog.template)} className={`${styles.scope} ${styles.identity}`}>
    <div className={styles.brand}>
      {catalog.logoUrl && <span data-catalog-logo className={styles.logo}><Image src={catalog.logoUrl} alt="" fill unoptimized sizes="160px" /></span>}
      <p className={styles.name} data-without-logo={!catalog.logoUrl || undefined}>{catalog.name}</p>
    </div>
    {(catalog.phone || hours) && <div className={styles.contact}>
      {catalog.phone && <a href={`tel:${catalog.phone.replace(/[^+\d]/g, "")}`}>{catalog.phone}</a>}
      {hours && (hours.length > 80 || hours.includes("\n") ? <a href="#contacto">Ver horario y contacto</a> : <span>Horario: {hours}</span>)}
    </div>}
  </div>;
}
