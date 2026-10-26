import styles from "./landing.module.css";

export const exampleCatalogUrl = "https://catalogo-pink.vercel.app/c/fa0e2eed-b4e1-46d6-9d44-fd276c6536e9";

const products = [
  { name: "Bolso tejido", price: "$65.000", art: "bag", label: "Ilustración de bolso tejido" },
  { name: "Vela aromática", price: "$24.000", art: "candle", label: "Ilustración de vela aromática" },
  { name: "Taza artesanal", price: "$32.000", art: "mug", label: "Ilustración de taza artesanal" },
  { name: "Planta de escritorio", price: "$28.000", art: "plant", label: "Ilustración de planta de escritorio" },
] as const;

export default function CatalogMockup() {
  return <div className={styles.showcaseWrap}>
    <div id="ejemplo" className={styles.mockup} role="region" aria-label="Muestra estática de un catálogo">
      <div className={styles.mockupHeader}><span aria-hidden="true" className={styles.storeMark}>T</span><div><p>Tu tienda, a un enlace</p><p>Así se ve un catálogo</p></div></div>
      <div className={styles.productGrid}>{products.map(product => <div key={product.art} className={styles.mockProduct}>
        <div role="img" aria-label={product.label} className={`${styles.productArt} ${styles[product.art]}`}>
          <span className={styles.artDetail} aria-hidden="true" /><span className={styles.artBody} aria-hidden="true" /><span className={styles.artAccent} aria-hidden="true" />
        </div>
        <p>{product.name}</p><p>{product.price}</p>
      </div>)}</div>
      <p className={styles.mockupNote}>Muestra estática · precios de referencia en COP.</p>
      <a href={exampleCatalogUrl} target="_blank" rel="noopener noreferrer" className={styles.realCatalogLink}>Ver un catálogo real <span aria-hidden="true">↗</span><span className="sr-only"> (se abre en una pestaña nueva)</span></a>
    </div>
  </div>;
}
