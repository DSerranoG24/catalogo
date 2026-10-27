"use client";

import Image from "next/image";
import Link from "next/link";
import type { PublicProduct } from "@/lib/api";
import styles from "./PublicProductCard.module.css";

export default function PublicProductCard({
  catalogPublicId,
  product,
  quantity,
  layout,
  onAdd,
  imageSizes = "(max-width: 640px) 48vw, (max-width: 1280px) 30vw, 20vw",
}: {
  catalogPublicId: string;
  product: PublicProduct;
  quantity: number;
  layout: "editorial" | "grid" | "boutique" | "tech" | "fashion" | "beauty";
  onAdd: (product: PublicProduct) => void;
  imageSizes?: string;
}) {
  const image = product.images[0];
  const detailHref = `/c/${encodeURIComponent(catalogPublicId)}/producto/${encodeURIComponent(product.slug)}`;
  const isOnSale = product.regularPrice !== null && product.discountPercent !== null;
  const secondary = product.category?.name || product.brand;
  const priceGroups = product.price.toLocaleString("es-CO").split(".");

  return (
    <article data-product-card data-layout={layout} className={styles.card}>
      <Link href={detailHref} className={styles.detailLink} aria-label={`Ver detalles de ${product.name}`}>
        <div data-product-image className={styles.media}>
          {image ? <Image src={image.url} alt={image.alt || product.name} fill unoptimized sizes={imageSizes} className={styles.image} /> :
            <div className={styles.placeholder}><span>{product.name}</span><span>Fotografía por añadir</span></div>}
          {isOnSale && <span className={styles.promotion}>-{product.discountPercent}%</span>}
        </div>
        <div className={styles.body}>
          <p data-product-meta className={styles.meta}>{secondary || <span aria-hidden="true">&nbsp;</span>}</p>
          <h3 className={styles.name}>{product.name}</h3>
        </div>
      </Link>
      <div className={styles.footer}>
        <div className={styles.prices}>
          <p data-product-price data-on-sale={isOnSale || undefined} className={styles.price}>{priceGroups.map((group, index) => <span key={index}><span className={styles.priceGroup}>{index === 0 ? "$" : ""}{group}{index < priceGroups.length - 1 ? "." : ""}</span>{index < priceGroups.length - 1 && <wbr />}</span>)}</p>
          {isOnSale && <p className={styles.previousPrice}>${product.regularPrice?.toLocaleString("es-CO")}</p>}
        </div>
        <button type="button" onClick={() => onAdd(product)} aria-label={`Añadir ${product.name} a la orden`} className={styles.add}>
          {quantity > 0 ? `Agregar · ${quantity}` : "Agregar"}
        </button>
      </div>
    </article>
  );
}
