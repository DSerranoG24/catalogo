import { PublicCatalog } from "@/lib/api";

export default function PublicCatalogContact({ catalog, compact = false }: { catalog: PublicCatalog; compact?: boolean }) {
  const contactLinks = [
    catalog.phone && {
      label: catalog.phone,
      href: `tel:${catalog.phone.replace(/[^+\d]/g, "")}`,
    },
    catalog.email && {
      label: catalog.email,
      href: `mailto:${catalog.email}`,
    },
    catalog.instagramUrl && { label: "Instagram", href: catalog.instagramUrl, external: true },
    catalog.facebookUrl && { label: "Facebook", href: catalog.facebookUrl, external: true },
    catalog.tiktokUrl && { label: "TikTok", href: catalog.tiktokUrl, external: true },
    catalog.mapUrl && { label: "Ver ubicación", href: catalog.mapUrl, external: true },
  ].filter((link): link is { label: string; href: string; external?: boolean } => Boolean(link));

  if (!contactLinks.length && !catalog.address && !catalog.businessHours) return null;

  if (compact) return (
    <section aria-label="Resumen de contacto">
      <h2 className="text-sm font-semibold">Contacto</h2>
      <ul className="mt-3 space-y-2 text-sm">
        {contactLinks.slice(0, 2).map(link => <li key={link.href}><a href={link.href} target={link.external ? "_blank" : undefined} rel={link.external ? "noreferrer" : undefined} className="underline underline-offset-4">{link.label}</a></li>)}
      </ul>
      <a href="#contacto" className="mt-3 inline-flex min-h-11 items-center text-sm underline underline-offset-4">Información del negocio</a>
    </section>
  );

  return (
    <section id="contacto" aria-label="Información del negocio" className="border-t border-current/15 px-5 py-7 sm:px-8 sm:py-9">
      <div className="mx-auto grid max-w-7xl gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide opacity-[var(--catalog-muted-opacity,0.7)]">Contacto</p>
          <h2 className="mt-1 text-lg font-semibold">{catalog.name}</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {contactLinks.map((link) => (
              <li key={link.href}>
                <a
                  href={link.href}
                  target={link.external ? "_blank" : undefined}
                  rel={link.external ? "noreferrer" : undefined}
                  className="underline decoration-current/30 underline-offset-4 hover:decoration-current"
                >
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </div>
        {catalog.address && (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide opacity-[var(--catalog-muted-opacity,0.7)]">Dirección</p>
            <p className="mt-2 whitespace-pre-line text-sm leading-6">{catalog.address}</p>
          </div>
        )}
        {catalog.businessHours && (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide opacity-[var(--catalog-muted-opacity,0.7)]">Horario de atención</p>
            <p className="mt-2 whitespace-pre-line text-sm leading-6">{catalog.businessHours}</p>
          </div>
        )}
      </div>
    </section>
  );
}
