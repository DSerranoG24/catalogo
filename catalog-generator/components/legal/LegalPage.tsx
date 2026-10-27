import type { ReactNode } from "react";
import Link from "next/link";
import styles from "./legal.module.css";

import LegalLinks from "./LegalLinks";

export function PendingReview({ children }: { children: ReactNode }) {
  return <p className={styles.pending}><strong>[PENDIENTE DE REVISIÓN JURÍDICA]</strong> {children}</p>;
}

export default function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return <div className={styles.page}>
    <header><Link href="/" prefetch={false}>Vitrinaya — Inicio</Link></header>
    <main id="contenido"><h1>{title}</h1>{children}</main>
    <footer><LegalLinks /></footer>
  </div>;
}
