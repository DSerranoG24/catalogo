"use client";

import { FormEvent, useState } from "react";
import { apiRequest, Catalog } from "@/lib/api";

type Template = Catalog["template"];
const templates: { id: Template; name: string; description: string; colors: string[] }[] = [
  { id: "EDITORIAL", name: "Editorial", description: "Composición amplia, tipográfica y serena.", colors: ["#e9eee4", "#af7357", "#263b31"] },
  { id: "GRID", name: "Galería", description: "Cuadrícula compacta, ideal para muchas referencias.", colors: ["#f1ede4", "#4e6c74", "#d7a64c"] },
  { id: "BOUTIQUE", name: "Boutique", description: "Presentación cálida con énfasis en cada pieza.", colors: ["#f0e7dc", "#814d38", "#cad0bd"] },
];

export default function CatalogSettings({
  catalog,
  onUpdated,
}: {
  catalog: Catalog;
  onUpdated: (patch: Partial<Catalog>) => void;
}) {
  const [profile, setProfile] = useState({
    name: catalog.name,
    description: catalog.description ?? "",
    whatsappPhone: catalog.whatsappPhone ?? "",
    phone: catalog.phone ?? "",
    address: catalog.address ?? "",
    businessHours: catalog.businessHours ?? "",
    instagramUrl: catalog.instagramUrl ?? "",
    facebookUrl: catalog.facebookUrl ?? "",
    tiktokUrl: catalog.tiktokUrl ?? "",
    email: catalog.email ?? "",
    mapUrl: catalog.mapUrl ?? "",
  });
  const [template, setTemplate] = useState<Template>(catalog.template);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const publicUrl = typeof window === "undefined"
    ? ""
    : `${window.location.origin}/c/${catalog.publicId}`;
  const inputClass = "mt-2 w-full rounded-md border border-[#d6dfd7] px-3.5 py-3 outline-none focus:border-[#17665c] focus:ring-2 focus:ring-[#17665c]/15";

  function updateProfileField(field: keyof typeof profile, value: string) {
    setProfile((current) => ({ ...current, [field]: value }));
  }

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const updatedProfile = {
        name: profile.name.trim(),
        description: profile.description.trim() || null,
        whatsappPhone: profile.whatsappPhone.trim() || null,
        phone: profile.phone.trim() || null,
        address: profile.address.trim() || null,
        businessHours: profile.businessHours.trim() || null,
        instagramUrl: profile.instagramUrl.trim() || null,
        facebookUrl: profile.facebookUrl.trim() || null,
        tiktokUrl: profile.tiktokUrl.trim() || null,
        email: profile.email.trim() || null,
        mapUrl: profile.mapUrl.trim() || null,
      };
      await apiRequest(`/catalogs/${catalog.id}`, {
        method: "PUT",
        body: JSON.stringify({ ...updatedProfile, template }),
      });
      onUpdated({ ...updatedProfile, template });
      setMessage("Cambios guardados.");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "No se pudieron guardar los cambios.");
    } finally {
      setSaving(false);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(publicUrl);
      setMessage("Enlace copiado.");
      setError("");
    } catch {
      setError("El navegador no permitió copiar el enlace.");
    }
  }

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.8fr)]">
      <form onSubmit={saveSettings} className="space-y-7 rounded-lg border border-[#dce4dc] bg-white p-5 sm:p-7">
        <div>
          <p className="text-xs font-semibold uppercase text-[#c65c3d]">Presentación</p>
          <h2 className="mt-1 text-lg font-semibold text-[#202b27]">Elige una plantilla</h2>
          <p className="mt-1 text-sm text-[#68756e]">El cambio se aplica al enlace público de inmediato.</p>
        </div>

        <div role="radiogroup" aria-label="Plantilla del catálogo" className="space-y-2">
          {templates.map((item) => (
            <button
              key={item.id}
              type="button"
              role="radio"
              aria-checked={template === item.id}
              onClick={() => setTemplate(item.id)}
              className={`flex w-full items-center gap-4 rounded-md border p-3 text-left transition ${template === item.id ? "border-[#17665c] bg-[#f1f6f0] ring-1 ring-[#17665c]" : "border-[#e0e7df] hover:border-[#a8bcae]"}`}
            >
              <span className="flex h-12 w-16 shrink-0 overflow-hidden rounded-sm" aria-hidden="true">
                {item.colors.map((color) => <span key={color} className="flex-1" style={{ backgroundColor: color }} />)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-[#202b27]">{item.name}</span>
                <span className="mt-0.5 block text-xs leading-5 text-[#68756e]">{item.description}</span>
              </span>
              <span className={`grid size-4 shrink-0 place-items-center rounded-full border ${template === item.id ? "border-[#17665c]" : "border-[#b7c2b8]"}`}>
                {template === item.id && <span className="size-2 rounded-full bg-[#17665c]" />}
              </span>
            </button>
          ))}
        </div>

        <section className="space-y-4 border-t border-[#e2e8e1] pt-6">
          <div>
            <h3 className="text-sm font-semibold text-[#202b27]">Información del negocio</h3>
            <p className="mt-1 text-xs text-[#68756e]">Los campos vacíos no aparecerán en el catálogo público.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm font-medium text-[#37443d]">
              Nombre comercial
              <input required maxLength={100} value={profile.name} onChange={(event) => updateProfileField("name", event.target.value)} className={inputClass} />
            </label>
            <label className="block text-sm font-medium text-[#37443d]">
              Teléfono
              <input type="tel" autoComplete="tel" inputMode="tel" maxLength={30} value={profile.phone} onChange={(event) => updateProfileField("phone", event.target.value)} placeholder="+57 300 123 4567" className={inputClass} />
            </label>
            <label className="block text-sm font-medium text-[#37443d] sm:col-span-2">
              Descripción del negocio
              <textarea rows={3} maxLength={500} value={profile.description} onChange={(event) => updateProfileField("description", event.target.value)} className={inputClass} />
            </label>
            <label className="block text-sm font-medium text-[#37443d]">
              WhatsApp
              <input type="tel" autoComplete="tel" inputMode="tel" pattern="\+[1-9][0-9]{7,14}" value={profile.whatsappPhone} onChange={(event) => updateProfileField("whatsappPhone", event.target.value)} placeholder="+573001234567" className={inputClass} />
              <span className="mt-1.5 block text-xs font-normal text-[#849087]">Formato internacional: +, código de país y número.</span>
            </label>
            <label className="block text-sm font-medium text-[#37443d]">
              Correo de contacto
              <input type="email" autoComplete="email" maxLength={254} value={profile.email} onChange={(event) => updateProfileField("email", event.target.value)} placeholder="hola@mitienda.com" className={inputClass} />
            </label>
            <label className="block text-sm font-medium text-[#37443d] sm:col-span-2">
              Dirección
              <input maxLength={250} value={profile.address} onChange={(event) => updateProfileField("address", event.target.value)} className={inputClass} />
            </label>
            <label className="block text-sm font-medium text-[#37443d] sm:col-span-2">
              Horario de atención
              <textarea rows={2} maxLength={500} value={profile.businessHours} onChange={(event) => updateProfileField("businessHours", event.target.value)} placeholder="Lunes a viernes, 9:00 a 18:00" className={inputClass} />
            </label>
            <label className="block text-sm font-medium text-[#37443d]">
              Instagram
              <input type="url" maxLength={2048} value={profile.instagramUrl} onChange={(event) => updateProfileField("instagramUrl", event.target.value)} placeholder="https://instagram.com/mitienda" className={inputClass} />
            </label>
            <label className="block text-sm font-medium text-[#37443d]">
              Facebook
              <input type="url" maxLength={2048} value={profile.facebookUrl} onChange={(event) => updateProfileField("facebookUrl", event.target.value)} placeholder="https://facebook.com/mitienda" className={inputClass} />
            </label>
            <label className="block text-sm font-medium text-[#37443d]">
              TikTok
              <input type="url" maxLength={2048} value={profile.tiktokUrl} onChange={(event) => updateProfileField("tiktokUrl", event.target.value)} placeholder="https://tiktok.com/@mitienda" className={inputClass} />
            </label>
            <label className="block text-sm font-medium text-[#37443d]">
              Enlace de ubicación
              <input type="url" maxLength={2048} value={profile.mapUrl} onChange={(event) => updateProfileField("mapUrl", event.target.value)} placeholder="https://maps.google.com/..." className={inputClass} />
            </label>
          </div>
        </section>

        {error && <p role="alert" className="rounded-md bg-[#fff1ec] px-3 py-2 text-sm text-[#a5432a]">{error}</p>}
        {message && <p role="status" className="text-sm text-[#17665c]">{message}</p>}
        <button type="submit" disabled={saving} className="rounded-md bg-[#17665c] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#10554c] disabled:opacity-60">
          {saving ? "Guardando..." : "Guardar presentación"}
        </button>
      </form>

      <aside className="rounded-lg border border-[#dce4dc] bg-[#e8eee5] p-5 sm:p-6">
        <p className="text-xs font-semibold uppercase text-[#c65c3d]">Enlace personal</p>
        <h2 className="mt-1 text-lg font-semibold text-[#202b27]">Listo para compartir</h2>
        <p className="mt-2 text-sm leading-6 text-[#68756e]">Cualquier persona con este enlace puede ver los productos activos y preparar una orden.</p>
        <div className="mt-5 break-all rounded-md border border-[#d4ded2] bg-white px-3 py-3 text-xs text-[#435047]">{publicUrl}</div>
        <button type="button" onClick={() => void copyLink()} className="mt-3 w-full rounded-md bg-[#202b27] px-4 py-3 text-sm font-semibold text-white hover:bg-[#34423a]">Copiar enlace</button>
        <p className="mt-3 text-xs leading-5 text-[#68756e]">El identificador público es aleatorio. No incluye correo ni datos privados del vendedor.</p>
      </aside>
    </div>
  );
}
