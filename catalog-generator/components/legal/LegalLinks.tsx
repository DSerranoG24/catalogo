export default function LegalLinks() {
  return <nav aria-label="Contacto y páginas legales" className="flex flex-wrap justify-center gap-x-5 gap-y-2">
    {[['/contacto', 'Contacto'], ['/privacidad', 'Privacidad'], ['/terminos', 'Términos']].map(([href, label]) => <a key={href} href={href} className="inline-flex min-h-11 items-center underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2">{label}</a>)}
  </nav>;
}
