import { PublicCatalog } from "@/lib/api";

export default function PublicCatalogContact({ catalog }: { catalog: PublicCatalog }) {
  const contactLinks = [
    catalog.phone && {
      label: catalog.phone,
      href: `tel:${catalog.phone.replace(/[^+\d]/g, "")}`,
    },
    catalog.whatsappPhone && {
      label: "Escribir por WhatsApp",
      href: `https://wa.me/${catalog.whatsappPhone.replace(/\D/g, "")}`,
      external: true,
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

  return (
    <section aria-label="Información del negocio" className="border-t border-current/15 px-5 py-7 sm:px-8 sm:py-9">
      <div className="mx-auto grid max-w-7xl gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide opacity-70">Contacto</p>
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
            <p className="text-[10px] font-semibold uppercase tracking-wide opacity-70">Dirección</p>
            <p className="mt-2 whitespace-pre-line text-sm leading-6">{catalog.address}</p>
          </div>
        )}
        {catalog.businessHours && (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide opacity-70">Horario de atención</p>
            <p className="mt-2 whitespace-pre-line text-sm leading-6">{catalog.businessHours}</p>
          </div>
        )}
      </div>
    </section>
  );
}