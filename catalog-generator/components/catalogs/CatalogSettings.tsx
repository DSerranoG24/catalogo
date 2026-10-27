"use client";

import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Input";
import uiStyles from "@/components/ui/ui.module.css";

import { FormEvent, useRef, useState } from "react";
import Image from "next/image";
import { apiRequest, Catalog, type Category } from "@/lib/api";
import CatalogBannersPanel from "./CatalogBannersPanel";
import { catalogTemplateOptions } from "@/lib/catalogTemplates";
import CatalogPaletteSelector from "./CatalogPaletteSelector";
import { isCatalogThemeCompatible } from "@/lib/catalog-theme-choice";

type Template = Catalog["template"];

function initialTemplate(value: Template): Template {
  if (value === "GRID") return "TECH";
  if (value === "BOUTIQUE") return "BEAUTY";
  if (value === "EDITORIAL") return "FASHION";
  return value;
}

function TemplatePreview({ template, colors }: { template: Template; colors: readonly string[] }) {
  const tech = template === "TECH";
  const beauty = template === "BEAUTY";
  const glamour = template === "GLAMOUR";
  return (
    <div className="overflow-hidden rounded-lg border border-black/10 bg-white shadow-sm" aria-hidden="true">
      <div className="flex h-5 items-center gap-1.5 border-b border-black/5 bg-white px-2">
        <i className="size-1.5 rounded-full bg-[#e6b7a8]" /><i className="size-1.5 rounded-full bg-[#e9d79c]" /><i className="size-1.5 rounded-full bg-[#b8d1bd]" />
        <span className="ml-1 h-2 w-1/2 rounded-full bg-[#edf0eb]" />
      </div>
      <div className="px-3 pb-3 pt-2" style={{ backgroundColor: colors[0], color: colors[2] }}>
        <div className="flex items-center justify-between border-y border-white/15 py-1 text-[5px] font-bold uppercase tracking-[0.12em]"><span>Tu marca</span><span>{tech ? "Tech store" : beauty || glamour ? "Beauty studio" : "Atelier"}</span></div>
        <div className={`py-3 ${tech ? "" : "text-center"}`}>
          <p className="text-[5px] font-bold uppercase tracking-[0.16em]" style={{ color: colors[1] }}>{tech ? "Tecnología para ti" : beauty || glamour ? (glamour ? "Esencia y glamour" : "Ritual de belleza") : "Nueva temporada"}</p>
          <div className={`mt-1 h-3 rounded-sm ${tech ? "w-3/4" : "mx-auto w-2/3"}`} style={{ backgroundColor: colors[2], opacity: 0.88 }} />
          <div className={`mt-1 h-1.5 rounded-sm ${tech ? "w-1/2" : "mx-auto w-1/3"}`} style={{ backgroundColor: colors[2], opacity: 0.2 }} />
        </div>
        <div className={`grid gap-1.5 ${tech ? "grid-cols-4" : "grid-cols-3"}`}>
          {Array.from({ length: tech ? 4 : 3 }, (_, index) => <div key={index} className="min-w-0"><div className={`aspect-[1.15] ${beauty || glamour ? (glamour ? "rounded-xl" : "rounded-full") : "rounded-sm"}`} style={{ backgroundColor: index % 2 ? colors[1] : colors[2], opacity: index % 2 ? 0.72 : 0.16 }} /><div className="mt-1 h-1 w-3/4 rounded-full" style={{ backgroundColor: colors[2], opacity: 0.3 }} /><div className="mt-0.5 h-1 w-1/2 rounded-full" style={{ backgroundColor: colors[2], opacity: 0.18 }} /></div>)}
        </div>
      </div>
    </div>
  );
}

export default function CatalogSettings({
  catalog,
  onUpdated,
  categories,
}: {
  catalog: Catalog;
  categories: Category[];
  onUpdated: (patch: Partial<Catalog>) => void;
}) {
  const [profile, setProfile] = useState({
    name: catalog.name,
    nit: catalog.nit ?? "",
    quotationTerms: catalog.quotationTerms ?? "",
    description: catalog.description ?? "",
    whatsappPhone: catalog.whatsappPhone ?? "",
    whatsappMessage: catalog.whatsappMessage ?? "",
    phone: catalog.phone ?? "",
    address: catalog.address ?? "",
    businessHours: catalog.businessHours ?? "",
    instagramUrl: catalog.instagramUrl ?? "",
    facebookUrl: catalog.facebookUrl ?? "",
    tiktokUrl: catalog.tiktokUrl ?? "",
    email: catalog.email ?? "",
    mapUrl: catalog.mapUrl ?? "",
  });
  const [template, setTemplate] = useState<Template>(initialTemplate(catalog.template));
  const [themePreset, setThemePreset] = useState<string | null>(catalog.themePreset ?? null);
  const [persistedThemePreset, setPersistedThemePreset] = useState<string | null>(catalog.themePreset ?? null);
  const themeCompatible = isCatalogThemeCompatible(template, themePreset);
  const [logoUrl, setLogoUrl] = useState(catalog.logoUrl);
  const [logoBusy, setLogoBusy] = useState(false);
  const logoInput = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const publicUrl = typeof window === "undefined"
    ? ""
    : `${window.location.origin}/c/${catalog.publicId}`;

  function updateProfileField(field: keyof typeof profile, value: string) {
    setProfile((current) => ({ ...current, [field]: value }));
  }

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    if (!themeCompatible) {
      setError("Elige una paleta compatible o Predeterminado antes de guardar.");
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const updatedProfile = {
        name: profile.name.trim(),
        nit: profile.nit.trim() || null,
        quotationTerms: profile.quotationTerms.trim() || null,
        description: profile.description.trim() || null,
        whatsappPhone: profile.whatsappPhone.trim() || null,
        whatsappMessage: profile.whatsappMessage.trim() || null,
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
        body: JSON.stringify({ ...updatedProfile, template, themePreset }),
      });
      setPersistedThemePreset(themePreset);
      onUpdated({ ...updatedProfile, template, themePreset });
      setMessage("Cambios guardados.");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "No se pudieron guardar los cambios.");
    } finally {
      setSaving(false);
    }
  }

  async function uploadLogo(file?: File) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setError("El logo supera el límite de 5 MB.");
      return;
    }
    setLogoBusy(true);
    setError("");
    setMessage("");
    try {
      const body = new FormData();
      body.append("image", file);
      const result = await apiRequest<{ logoUrl: string }>(`/catalogs/${catalog.id}/logo`, { method: "POST", body });
      setLogoUrl(result.logoUrl);
      onUpdated({ logoUrl: result.logoUrl });
      setMessage("Logo actualizado.");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "No se pudo subir el logo.");
    } finally {
      setLogoBusy(false);
      if (logoInput.current) logoInput.current.value = "";
    }
  }

  async function removeLogo() {
    setLogoBusy(true);
    setError("");
    try {
      await apiRequest(`/catalogs/${catalog.id}/logo`, { method: "DELETE" });
      setLogoUrl(null);
      onUpdated({ logoUrl: null });
      setMessage("Logo eliminado.");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "No se pudo eliminar el logo.");
    } finally {
      setLogoBusy(false);
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
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.72fr)]">
      <div className="min-w-0 space-y-6">
      <form onSubmit={saveSettings} className="space-y-7 rounded-3xl border border-[#e2e8e0] bg-white p-5 shadow-[0_18px_54px_-44px_rgba(36,63,47,0.4)] sm:p-7">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--brand-coral-text)]">Diseño de tu tienda</p>
          <h2 className="mt-1 text-xl font-semibold text-[#202b27]">Elige cómo verán tu catálogo</h2>
          <p className="mt-1 text-sm leading-6 text-[#68756e]">Selecciona una plantilla y guarda para actualizar tu página pública.</p>
        </div>

        <div role="radiogroup" aria-label="Plantilla del catálogo" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {catalogTemplateOptions.map((item) => (
            <Button variant="secondary" selected={template === item.id}
              key={item.id}
              type="button"
              role="radio"
              disabled={saving}
              aria-checked={template === item.id}
              onClick={() => setTemplate(item.id)}
              className={uiStyles.templateChoice}
            >
              <TemplatePreview template={item.id} colors={item.colors} />
              <span className="flex items-start justify-between gap-2 px-1 pb-1 pt-3">
                <span className="min-w-0">
                <span className="block text-sm font-semibold text-[#202b27]">{item.name}</span>
                <span className="mt-0.5 block text-xs leading-5 text-[#68756e]">{item.description}</span>
                <span className="mt-2 inline-flex rounded-full px-2 py-1 text-[8px] font-bold tracking-[0.1em]" style={{ backgroundColor: `${item.colors[1]}20`, color: item.id === "TECH" ? "#176d61" : item.colors[1] }}>{item.category}</span>
                </span>
              <span className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border ${template === item.id ? "border-[var(--brand-emerald)] bg-[var(--brand-emerald)] text-white" : "border-[#b7c2b8] text-transparent"}`}>
                <svg viewBox="0 0 16 16" fill="none" className="size-3" aria-hidden="true"><path d="m3 8 3 3 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </span>
              </span>
            </Button>
          ))}
        </div>

        {publicUrl && <a href={publicUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[#d6dfd7] px-4 text-sm font-semibold text-[#315e4f] transition hover:bg-[#f4f7f2]">Ver catálogo público <span aria-hidden="true">↗</span></a>}

        <CatalogPaletteSelector template={template} value={themePreset} persistedValue={persistedThemePreset} onChange={setThemePreset} disabled={saving} />

        <section className="space-y-4 border-t border-[#e2e8e1] pt-6">
          <div>
            <h3 className="text-sm font-semibold text-[#202b27]">Información del negocio</h3>
            <p className="mt-1 text-xs text-[#68756e]">Los campos vacíos no aparecerán en el catálogo público.</p>
          </div>
          <div className="rounded-2xl border border-[#e2e8e1] bg-[#fafbf9] p-4">
            <div className="flex flex-wrap items-center gap-4">
              <div className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-lg border border-[#d6dfd7] bg-white">
                {logoUrl ? <Image src={logoUrl} alt="Logo del negocio" width={64} height={64} unoptimized className="size-full object-contain" /> : <span className="text-xs font-semibold text-[#849087]">Logo</span>}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-[#202b27]">Logo de la empresa</p>
                <p className="mt-1 text-xs leading-5 text-[#68756e]">Se mostrará en la cabecera del catálogo. PNG, JPG o WebP, máximo 5 MB.</p>
              </div>
              <div className="flex gap-2">
                <input ref={logoInput} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(event) => void uploadLogo(event.target.files?.[0])} />
                <Button variant="outline" type="button" disabled={logoBusy} onClick={() => logoInput.current?.click()} >{logoBusy ? "Subiendo..." : logoUrl ? "Cambiar logo" : "Subir logo"}</Button>
                {logoUrl && <Button variant="destructive-ghost" type="button" disabled={logoBusy} onClick={() => void removeLogo()} >Quitar</Button>}
              </div>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm font-medium text-[#37443d]">
              Nombre comercial
              <Input required maxLength={100} value={profile.name} onChange={(event) => updateProfileField("name", event.target.value)} className="mt-2" />
            </label>
            <label className="block text-sm font-medium text-[#37443d]">
              NIT <span className="font-normal text-[#849087]">(opcional)</span>
              <Input maxLength={30} pattern="[0-9][0-9. -]*" value={profile.nit} onChange={(event) => updateProfileField("nit", event.target.value)} className="mt-2" />
            </label>
            <label className="block text-sm font-medium text-[#37443d] sm:col-span-2">
              Condiciones de cotización <span className="font-normal text-[#849087]">(opcional)</span>
              <Textarea rows={5} maxLength={4000} value={profile.quotationTerms} onChange={(event) => updateProfileField("quotationTerms", event.target.value)} placeholder="Condiciones de entrega, formas de pago, garantía..." className="mt-2" />
              <span className="mt-1.5 block text-xs font-normal text-[#849087]">Se guardan en cada nueva cotización. Los cambios no modifican las condiciones ya emitidas.</span>
            </label>
            <label className="block text-sm font-medium text-[#37443d] sm:col-span-2">
              Asunto o mensaje personalizado de WhatsApp <span className="font-normal text-[#849087]">(opcional)</span>
              <Textarea rows={2} maxLength={500} value={profile.whatsappMessage} onChange={(event) => updateProfileField("whatsappMessage", event.target.value)} placeholder="Hola, quisiera más información sobre sus productos." className="mt-2" />
              <span className="mt-1.5 block text-xs font-normal text-[#849087]">Se abrirá como mensaje sugerido; el cliente podrá editarlo antes de enviarlo.</span>
            </label>
            <label className="block text-sm font-medium text-[#37443d]">
              Teléfono
              <Input type="tel" autoComplete="tel" inputMode="tel" maxLength={30} value={profile.phone} onChange={(event) => updateProfileField("phone", event.target.value)} placeholder="+57 300 123 4567" className="mt-2" />
            </label>
            <label className="block text-sm font-medium text-[#37443d] sm:col-span-2">
              Descripción del negocio
              <Textarea rows={3} maxLength={500} value={profile.description} onChange={(event) => updateProfileField("description", event.target.value)} className="mt-2" />
            </label>
            <label className="block text-sm font-medium text-[#37443d]">
              WhatsApp
              <Input type="tel" autoComplete="tel" inputMode="tel" pattern="\+[1-9][0-9]{7,14}" value={profile.whatsappPhone} onChange={(event) => updateProfileField("whatsappPhone", event.target.value)} placeholder="+573001234567" className="mt-2" />
              <span className="mt-1.5 block text-xs font-normal text-[#849087]">Formato internacional: +, código de país y número.</span>
            </label>
            <label className="block text-sm font-medium text-[#37443d]">
              Correo de contacto
              <Input type="email" autoComplete="email" maxLength={254} value={profile.email} onChange={(event) => updateProfileField("email", event.target.value)} placeholder="hola@mitienda.com" className="mt-2" />
            </label>
            <label className="block text-sm font-medium text-[#37443d] sm:col-span-2">
              Dirección
              <Input maxLength={250} value={profile.address} onChange={(event) => updateProfileField("address", event.target.value)} className="mt-2" />
            </label>
            <label className="block text-sm font-medium text-[#37443d] sm:col-span-2">
              Horario de atención
              <Textarea rows={2} maxLength={500} value={profile.businessHours} onChange={(event) => updateProfileField("businessHours", event.target.value)} placeholder="Lunes a viernes, 9:00 a 18:00" className="mt-2" />
            </label>
            <label className="block text-sm font-medium text-[#37443d]">
              Instagram
              <Input type="url" maxLength={2048} value={profile.instagramUrl} onChange={(event) => updateProfileField("instagramUrl", event.target.value)} placeholder="https://instagram.com/mitienda" className="mt-2" />
            </label>
            <label className="block text-sm font-medium text-[#37443d]">
              Facebook
              <Input type="url" maxLength={2048} value={profile.facebookUrl} onChange={(event) => updateProfileField("facebookUrl", event.target.value)} placeholder="https://facebook.com/mitienda" className="mt-2" />
            </label>
            <label className="block text-sm font-medium text-[#37443d]">
              TikTok
              <Input type="url" maxLength={2048} value={profile.tiktokUrl} onChange={(event) => updateProfileField("tiktokUrl", event.target.value)} placeholder="https://tiktok.com/@mitienda" className="mt-2" />
            </label>
            <label className="block text-sm font-medium text-[#37443d]">
              Enlace de ubicación
              <Input type="url" maxLength={2048} value={profile.mapUrl} onChange={(event) => updateProfileField("mapUrl", event.target.value)} placeholder="https://maps.google.com/..." className="mt-2" />
            </label>
          </div>
        </section>

        {error && <p role="alert" className="rounded-md bg-[#fff1ec] px-3 py-2 text-sm text-[#a5432a]">{error}</p>}
        {message && <p role="status" className="text-sm text-[#17665c]">{message}</p>}
        <Button variant="primary" size="lg" type="submit" disabled={saving || !themeCompatible} >
          {saving ? "Guardando..." : "Guardar cambios"}
        </Button>
      </form>
      <CatalogBannersPanel catalogId={catalog.id} categories={categories} archived={Boolean(catalog.archivedAt)} />
      </div>

      <aside className="rounded-3xl border border-[#dce4dc] bg-[#e8eee5] p-5 sm:sticky sm:top-6 sm:p-6">
        <p className="text-xs font-semibold uppercase text-[var(--brand-coral-text)]">Enlace personal</p>
        <h2 className="mt-1 text-lg font-semibold text-[#202b27]">Listo para compartir</h2>
        <p className="mt-2 text-sm leading-6 text-[#68756e]">Cualquier persona con este enlace puede ver los productos activos y preparar una orden.</p>
        <div className="mt-5 break-all rounded-xl border border-[#d4ded2] bg-white px-3 py-3 text-xs text-[#435047]">{publicUrl}</div>
        <Button variant="primary" type="button" onClick={() => void copyLink()} className="mt-3 w-full">Copiar enlace</Button>
        <p className="mt-3 text-xs leading-5 text-[#68756e]">El identificador público es aleatorio. No incluye correo ni datos privados del vendedor.</p>
      </aside>
    </div>
  );
}
