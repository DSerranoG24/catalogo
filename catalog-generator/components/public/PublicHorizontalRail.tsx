"use client";
import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import styles from "./PublicCatalogExtras.module.css";

const subscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;
export default function PublicHorizontalRail({ title, variant, items, singleStatic = false }: {
  title: string; variant: "banner" | "product"; items: ReactNode[]; singleStatic?: boolean;
}) {
  const id = useId(), rail = useRef<HTMLDivElement>(null);
  const hydrated = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
  const [edges, setEdges] = useState({ previous: false, next: true });
  useEffect(() => {
    const element = rail.current;
    if (!element) return;
    const update = () => {
      const next = { previous: element.scrollLeft > 1, next: element.scrollLeft + element.clientWidth < element.scrollWidth - 1 };
      setEdges(current => current.previous === next.previous && current.next === next.next ? current : next);
    };
    const observer = new ResizeObserver(update); observer.observe(element);
    element.addEventListener("scroll", update, { passive: true });
    return () => { observer.disconnect(); element.removeEventListener("scroll", update); };
  }, [items.length, singleStatic]);
  if (!items.length) return null;
  function move(direction: number) {
    const element = rail.current;
    if (!element) return;
    element.scrollBy({ left: element.clientWidth * .9 * direction, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }
  return <section data-public-section={variant} className={`${styles.section} ${variant === "banner" ? styles.banner : ""}`}>
    <div className={styles.heading} data-controls={!singleStatic || undefined}><h2 id={`${id}-heading`}>{title}</h2>
      {hydrated && !singleStatic && <div className={styles.controls} aria-label={`Navegación de ${title}`}>
        <button type="button" className={styles.control} aria-label={`Anterior en ${title}`} aria-controls={id} disabled={!edges.previous} onClick={() => move(-1)}>←</button>
        <button type="button" className={styles.control} aria-label={`Siguiente en ${title}`} aria-controls={id} disabled={!edges.next} onClick={() => move(1)}>→</button>
      </div>}
    </div>
    {singleStatic ? <div data-banner-static className={styles.static}>{items[0]}</div> : <div id={id} ref={rail} tabIndex={0} role="region" aria-labelledby={`${id}-heading`} data-public-rail={variant} className={styles.rail}>
      <ul className={styles.track}>{items.map((item, index) => <li key={index} className={styles.slide}>{item}</li>)}</ul>
    </div>}
  </section>;
}
