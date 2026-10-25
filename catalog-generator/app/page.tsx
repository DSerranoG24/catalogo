import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Check, FileSpreadsheet, FileText, Link2, MessageCircle, Package, Store } from "lucide-react";
import BrandLogo from "@/components/brand/BrandLogo";

const title = "Vitrinaya | Tu vitrina digital, lista para compartir.";
const description = "Crea tu catálogo, compártelo con un enlace y recibe pedidos por WhatsApp. Sin página web propia, sin complicaciones.";

export const metadata: Metadata = {
  title,
  description,
  robots: { index: true, follow: true },
  alternates: { canonical: "/" },
  openGraph: { title, description, url: "/", siteName: "Vitrinaya", type: "website", locale: "es_CO" },
  twitter: { card: "summary", title, description },
};

const container = "mx-auto w-full max-w-6xl px-5 sm:px-8";
const focus = "focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--brand-emerald)]";
const primary = `inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[var(--brand-emerald)] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[var(--brand-emerald-hover)] ${focus}`;
const secondary = `inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[var(--brand-emerald)] px-5 py-3 text-sm font-semibold text-[var(--brand-emerald)] transition hover:bg-[var(--brand-emerald-soft)] ${focus}`;

const features = [
  { icon: Store, title: "Catálogo con enlace propio", body: "Una dirección única para tu negocio. Elige entre varios diseños según tu estilo." },
  { icon: MessageCircle, title: "Pedidos por WhatsApp", body: "Tus clientes envían su pedido y tú lo recibes con los datos completos." },
  { icon: FileText, title: "Cotización en PDF", body: "Cuando se emite la cotización, obtienes un documento PDF con tus datos y condiciones. El pedido se conserva aunque la emisión falle." },
  { icon: FileSpreadsheet, title: "Importar desde Excel", body: "Sube tus productos desde Excel y actualízalos cuando quieras. Hasta 500 filas por archivo." },
];

export default function LandingPage() {
  return (
    <>
      <a href="#contenido" className={`sr-only focus:not-sr-only focus:absolute focus:left-5 focus:top-3 focus:z-10 rounded-lg bg-white px-4 py-3 ${focus}`}>Saltar al contenido</a>
      <header className="border-b border-[var(--brand-emerald)]/15 bg-white">
        <div className={`${container} flex flex-wrap items-center justify-between gap-3 py-4`}>
          <Link href="/" aria-label="Vitrinaya, inicio" className={focus}><BrandLogo variant="horizontal" theme="claro" iconSize={36} nameRatio={0.5} gapSize={8} /></Link>
          <nav aria-label="Navegación principal" className="flex flex-wrap items-center gap-2 sm:gap-5">
            <a href="#funciones" className={`hidden min-h-11 items-center text-sm text-[var(--brand-forest)] sm:inline-flex ${focus}`}>Funciones</a>
            <a href="#precios" className={`hidden min-h-11 items-center text-sm text-[var(--brand-forest)] sm:inline-flex ${focus}`}>Precios</a>
            <Link href="/login" className={`inline-flex min-h-11 items-center text-sm font-semibold text-[var(--brand-emerald)] ${focus}`}>Iniciar sesión</Link>
          </nav>
        </div>
      </header>

      <main id="contenido">
        <section className={`${container} grid items-center gap-12 py-14 sm:py-20 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:gap-16`} aria-labelledby="hero-title">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-widest text-[var(--brand-coral-text)]">Tu negocio ya tiene qué mostrar</p>
            <h1 id="hero-title" className="mt-4 text-4xl font-semibold leading-tight tracking-tight text-[var(--brand-forest)] sm:text-5xl lg:text-6xl">Tu vitrina digital, <span className="text-[var(--brand-emerald)]">lista para compartir.</span></h1>
            <p className="mt-6 max-w-xl text-base leading-7 text-[var(--foreground)]">{description}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/login" className={primary}>Crear mi catálogo <ArrowRight size={17} aria-hidden="true" /></Link>
              <button type="button" disabled aria-describedby="example-coming-soon" className={`${secondary} cursor-not-allowed`}>Ver un ejemplo</button>
            </div>
            <p id="example-coming-soon" className="mt-4 text-sm text-[var(--brand-forest)]">El enlace a un catálogo de ejemplo estará disponible próximamente.</p>
          </div>

          <div id="ejemplo" className="min-w-0 scroll-mt-6 rounded-3xl border border-[var(--brand-emerald)]/20 bg-white p-5 shadow-sm sm:p-7" role="region" aria-label="Ejemplo ilustrativo de catálogo">
            <div className="flex items-center gap-3 border-b border-[var(--brand-emerald)]/15 pb-5">
              <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-[var(--brand-emerald-soft)] text-[var(--brand-emerald)]"><Store aria-hidden="true" size={24} /></span>
              <div><p className="font-semibold text-[var(--brand-forest)]">Tu tienda, a un enlace</p><p className="mt-1 text-xs text-[var(--brand-coral-text)]">Ejemplo ilustrativo · productos ficticios</p></div>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-3">
              {[{ name: "Bolso de mano", price: "Precio de ejemplo", icon: Store }, { name: "Set de regalo", price: "Precio de ejemplo", icon: Package }].map(item => <div key={item.name} className="min-w-0 rounded-2xl border border-[var(--brand-emerald)]/15 p-3">
                <div className="grid aspect-square place-items-center rounded-xl bg-[var(--brand-emerald-soft)] text-[var(--brand-emerald)]"><item.icon size={42} aria-hidden="true" strokeWidth={1.25} /></div>
                <p className="mt-3 text-sm font-medium text-[var(--brand-forest)]">{item.name}</p><p className="mt-1 text-sm font-semibold text-[var(--brand-emerald)]">{item.price}</p>
              </div>)}
            </div>
            <p className="mt-5 flex items-center gap-2 rounded-xl bg-[var(--brand-forest)] px-4 py-3 text-sm text-white"><MessageCircle size={18} aria-hidden="true" className="shrink-0" /> Elige aquí. Conversemos por WhatsApp.</p>
            <p className="mt-3 text-xs leading-5 text-[var(--brand-forest)]">Así puedes presentar tus productos. Esta muestra no recibe pedidos ni representa una tienda real.</p>
          </div>
        </section>

        <section aria-labelledby="como-title" className="border-y border-[var(--brand-emerald)]/15 bg-white py-12 sm:py-16">
          <div className={container}>
            <h2 id="como-title" className="text-3xl font-semibold tracking-tight text-[var(--brand-forest)]">Cómo funciona</h2>
            <ol className="mt-8 grid gap-7 md:grid-cols-3">
              {[{ title: "Sube tus productos.", body: "Añádelos uno a uno o importa tu inventario desde un Excel." }, { title: "Comparte tu enlace.", body: "Cada catálogo tiene su propia dirección. Pégala en WhatsApp, Instagram o donde quieras." }, { title: "Recibe pedidos.", body: "Tus clientes arman su pedido y pueden enviarte el mensaje con todo listo para confirmar." }].map((step, index) => <li key={step.title}>
                <span aria-hidden="true" className="inline-flex size-10 items-center justify-center rounded-full bg-[var(--brand-emerald-soft)] font-semibold text-[var(--brand-emerald)]">{index + 1}</span>
                <h3 className="mt-4 text-lg font-semibold text-[var(--brand-forest)]">{step.title}</h3><p className="mt-2 text-sm leading-6">{step.body}</p>
              </li>)}
            </ol>
          </div>
        </section>

        <section id="funciones" aria-labelledby="funciones-title" className={`${container} py-14 sm:py-20`}>
          <p className="text-xs font-bold uppercase tracking-widest text-[var(--brand-coral-text)]">Disponible hoy</p>
          <h2 id="funciones-title" className="mt-3 text-3xl font-semibold tracking-tight text-[var(--brand-forest)]">Menos mensajes sueltos. Más claridad.</h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            {features.map(feature => <article key={feature.title} className="rounded-2xl border border-[var(--brand-emerald)]/15 bg-white p-6">
              <feature.icon size={25} aria-hidden="true" className="text-[var(--brand-emerald)]" /><h3 className="mt-4 text-lg font-semibold text-[var(--brand-forest)]">{feature.title}</h3><p className="mt-2 text-sm leading-6">{feature.body}</p>
            </article>)}
          </div>
          <p className="mt-5 text-sm leading-6">El mensaje de WhatsApp se envía cuando el cliente abre WhatsApp y confirma su envío. La cotización es una solicitud sujeta a confirmación, no una factura.</p>
        </section>

        <section aria-labelledby="proximo-title" className="bg-[var(--brand-forest)] py-12 text-white sm:py-16">
          <div className={container}>
            <p className="text-xs font-semibold uppercase tracking-widest">Próximamente · aún no disponible</p>
            <h2 id="proximo-title" className="mt-3 text-3xl font-semibold tracking-tight">Inventario y control de gastos.</h2>
            <p className="mt-5 max-w-2xl text-sm leading-6">Estamos trabajando para que también puedas llevar el control completo de tu negocio desde Vitrinaya.</p>
            <p className="mt-3 max-w-2xl text-sm leading-6">Hoy el stock es informativo: los pedidos no reservan ni descuentan inventario. El control de gastos todavía no está disponible.</p>
          </div>
        </section>

        <section id="precios" aria-labelledby="precios-title" className={`${container} py-14 sm:py-20`}>
          <div className="grid gap-8 rounded-3xl border border-[var(--brand-emerald)]/20 bg-white p-6 sm:p-10 md:grid-cols-2 md:items-center">
            <div><p className="text-xs font-bold uppercase tracking-widest text-[var(--brand-coral-text)]">Precios</p><h2 id="precios-title" className="mt-3 text-4xl font-semibold tracking-tight text-[var(--brand-forest)]">Gratis por ahora.</h2><p className="mt-4 text-sm leading-6">Crea tus catálogos, compártelos y recibe pedidos sin coste mientras seguimos construyendo.</p><Link href="/login" className={`${primary} mt-6`}>Crear mi catálogo <ArrowRight size={17} aria-hidden="true" /></Link></div>
            <ul className="space-y-4 text-sm">{["Catálogo con enlace propio", "Pedidos y conversación por WhatsApp", "Cotización PDF sujeta a confirmación", "Carga de productos con plantilla Excel"].map(item => <li key={item} className="flex items-start gap-3"><Check aria-hidden="true" size={18} className="shrink-0 text-[var(--brand-emerald)]" />{item}</li>)}</ul>
          </div>
        </section>
      </main>

      <footer className="border-t border-[var(--brand-emerald)]/15 bg-white py-8">
        <div className={container}>
          <div className="flex flex-wrap items-center justify-between gap-5">
            <BrandLogo variant="horizontal" theme="claro" iconSize={32} nameRatio={0.5} />
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
              <nav aria-label="Contacto y enlaces legales pendientes" aria-describedby="footer-coming-soon" className="flex flex-wrap gap-x-5 gap-y-2 text-sm">{["Contacto", "Privacidad", "Términos"].map(label => <span key={label} role="link" aria-disabled="true" className="inline-flex min-h-11 cursor-not-allowed items-center">{label}</span>)}</nav>
              <nav aria-label="Redes sociales de Vitrinaya" className="flex items-center gap-2">
                <a href="https://www.instagram.com/vitrinaya.app/" target="_blank" rel="noopener noreferrer" aria-label="Instagram de Vitrinaya" aria-describedby="footer-social-new-tab" className={`inline-flex size-11 items-center justify-center rounded-xl text-[var(--brand-emerald)] transition hover:bg-[var(--brand-emerald-soft)] ${focus}`}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" focusable="false"><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" /></svg>
                </a>
                <a href="https://www.facebook.com/profile.php?id=61595710178606" target="_blank" rel="noopener noreferrer" aria-label="Facebook de Vitrinaya" aria-describedby="footer-social-new-tab" className={`inline-flex size-11 items-center justify-center rounded-xl text-[var(--brand-emerald)] transition hover:bg-[var(--brand-emerald-soft)] ${focus}`}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M14 22v-9h3l.5-4H14V7c0-1.2.3-2 2-2h2V1.5C17.2 1.2 16.4 1 15.5 1 11.8 1 10 3.2 10 7v2H7v4h3v9z" /></svg>
                </a>
              </nav>
              <span id="footer-social-new-tab" className="sr-only">Se abre en una pestaña nueva.</span>
            </div>
          </div>
          <p id="footer-coming-soon" className="mt-4 text-xs leading-6">Contacto, Privacidad y Términos: próximamente.</p>
          <p className="mt-6 flex items-center gap-2 text-xs"><Link2 size={14} aria-hidden="true" />Vitrinaya — Tu vitrina digital</p>
        </div>
      </footer>
    </>
  );
}
