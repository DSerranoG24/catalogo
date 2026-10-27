import Link from "next/link";
import { ShoppingCart } from "lucide-react";
import type { CatalogTemplateId } from "@/lib/catalogTemplates";
import styles from "./PublicCatalogCartLink.module.css";

export default function PublicCatalogCartLink({ publicId, template, cartCount, cartTotal }: {
  publicId: string;
  template: CatalogTemplateId;
  cartCount: number;
  cartTotal: number;
}) {
  const quantity = `${cartCount} ${cartCount === 1 ? "unidad" : "unidades"}`;
  return (
    <div className={styles.bar} data-catalog-cart-bar data-template={template}>
      <div className={styles.inner}>
        <Link href={`/c/${encodeURIComponent(publicId)}/carrito`} prefetch={false} className={styles.link} data-catalog-cart-link aria-label={`Abrir carrito, ${quantity}`}>
          <ShoppingCart aria-hidden="true" size={22} />
          <span>Carrito</span>
          <span className={styles.count} data-catalog-cart-count aria-hidden="true">{cartCount > 99 ? "99+" : cartCount}</span>
          <span className={styles.total} aria-hidden="true">${cartTotal.toLocaleString("es-CO")}</span>
        </Link>
        <span className={styles.announcement} aria-live="polite" aria-atomic="true" data-catalog-cart-announcement>Carrito: {quantity}</span>
      </div>
    </div>
  );
}
