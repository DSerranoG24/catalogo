"use client";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Input";
import { apiRequest, type Category } from "@/lib/api";
import { readSuggestions, safeExternalUrl, type CatalogBanner } from "@/lib/catalog-highlights";
import { compressProductPhoto } from "@/lib/compress-product-photo";

export default function CatalogBannerEditor({ catalogId, banner, categories, disabled, onSave, onCancel }: {
  catalogId: string; banner: CatalogBanner | null; categories: Category[]; disabled: boolean;
  onSave: (data: FormData, id?: string) => Promise<boolean>; onCancel: () => void;
}) {
  const prefix = useId();
  const [title, setTitle] = useState(banner?.title ?? "");
  const [subtitle, setSubtitle] = useState(banner?.subtitle ?? "");
  const [linkType, setLinkType] = useState<CatalogBanner["linkType"]>(banner?.linkType ?? "EXTERNAL");
  const [linkValue, setLinkValue] = useState(banner?.linkValue ?? "");
  const [active, setActive] = useState(banner?.active ?? true);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState(banner?.imageUrl ?? "");
  const [preparing, setPreparing] = useState(false);
  const [query, setQuery] = useState("");
  const [chosenName, setChosenName] = useState(banner?.linkType === "PRODUCT" ? "Producto vinculado actualmente" : "");
  const [suggestions, setSuggestions] = useState<{ id: string; name: string }[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const objectUrl = useRef<string | null>(null);
  const mounted = useRef(false);
  const titleRef = useRef<HTMLInputElement>(null);
  useEffect(() => { mounted.current = true; titleRef.current?.focus(); return () => { mounted.current = false; if (objectUrl.current) URL.revokeObjectURL(objectUrl.current); }; }, []);
  useEffect(() => {
    if (linkType !== "PRODUCT" || query.trim().length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setSearching(true);
      try { const rows = readSuggestions(await apiRequest<unknown>(`/products/catalog/${catalogId}/suggestions?q=${encodeURIComponent(query.trim())}`, { signal: controller.signal })); if (!controller.signal.aborted) setSuggestions(rows); }
      catch (failure) { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "No se pudo buscar el producto."); }
      finally { if (!controller.signal.aborted) setSearching(false); }
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [catalogId, linkType, query]);
  async function prepare(image?: File) {
    if (!image || preparing || disabled) return;
    setPreparing(true); setError("");
    try {
      const prepared = await compressProductPhoto(image, { maxDimension: 2400 });
      if (!mounted.current) return;
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
      objectUrl.current = URL.createObjectURL(prepared); setPreview(objectUrl.current); setFile(prepared);
    } catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : "No se pudo preparar la imagen."); }
    finally { if (mounted.current) setPreparing(false); }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (disabled || preparing) return; setError("");
    const changedDestination = !banner || banner.linkType !== linkType || banner.linkValue !== linkValue;
    if ((!banner && !file) || !title.trim()) { setError("Añade una imagen y un título."); return; }
    if (changedDestination && (!linkValue || (linkType === "EXTERNAL" && !safeExternalUrl(linkValue)))) { setError("Selecciona un destino válido; las URL externas deben usar http o https."); return; }
    const data = new FormData(); data.set("title", title.trim()); data.set("subtitle", subtitle.trim()); data.set("active", String(active));
    if (changedDestination) { data.set("linkType", linkType); data.set("linkValue", linkValue.trim()); }
    if (file) data.set("image", file);
    await onSave(data, banner?.id);
  }
  return <form onSubmit={submit} aria-label={banner ? "Editar anuncio" : "Nuevo anuncio"} className="mt-5 space-y-4 rounded-xl border border-[#cbd5e1] p-4">
    <h3 className="font-semibold">{banner ? "Editar anuncio" : "Nuevo anuncio"}</h3>
    <fieldset disabled={disabled || preparing} className="min-w-0 space-y-4">
      <label className="block text-sm" htmlFor={`${prefix}-title`}>Título<Input ref={titleRef} id={`${prefix}-title`} name="title" required maxLength={150} value={title} onChange={event => setTitle(event.target.value)} className="mt-1 w-full" /></label>
      <label className="block text-sm" htmlFor={`${prefix}-subtitle`}>Subtítulo (opcional)<Textarea id={`${prefix}-subtitle`} name="subtitle" maxLength={300} value={subtitle} onChange={event => setSubtitle(event.target.value)} className="mt-1 w-full" /></label>
      <label className="block text-sm" htmlFor={`${prefix}-image`}>Imagen del anuncio<input id={`${prefix}-image`} name="image" type="file" accept="image/jpeg,image/png,image/webp" className="mt-2 block w-full text-sm focus-visible:outline-2 focus-visible:outline-offset-2" onChange={event => { void prepare(event.target.files?.[0]); event.target.value = ""; }} /></label>
      <p className="text-xs">JPG, PNG o WebP. Preparada hasta 2400 px; vista previa 16:9 con recorte centrado.</p>
      {preview && <div data-banner-preview className="relative aspect-video w-full overflow-hidden rounded-lg bg-[#e2e8f0]"><Image src={preview} alt="Vista previa del anuncio, recorte centrado 16:9" fill unoptimized sizes="(max-width: 640px) 90vw, 600px" className="object-cover object-center" /></div>}
      <label className="block text-sm" htmlFor={`${prefix}-link-type`}>Tipo de enlace<select id={`${prefix}-link-type`} name="linkType" value={linkType} onChange={event => { const value = event.target.value; if (value !== "PRODUCT" && value !== "CATEGORY" && value !== "EXTERNAL") return; setLinkType(value); setLinkValue(""); setChosenName(""); setQuery(""); setSuggestions([]); }} className="mt-1 min-h-11 w-full rounded-lg border border-[#64748b] bg-white p-2 focus-visible:outline-2 focus-visible:outline-offset-2"><option value="EXTERNAL">URL externa</option><option value="PRODUCT">Producto</option><option value="CATEGORY">Categoría</option></select></label>
      {linkType === "EXTERNAL" && <label className="block text-sm">URL externa<Input name="linkValue" type="url" required value={linkValue} onChange={event => setLinkValue(event.target.value)} maxLength={2048} className="mt-1 w-full" /></label>}
      {linkType === "CATEGORY" && <label className="block text-sm">Categoría destino<select name="linkValue" required value={linkValue} onChange={event => setLinkValue(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-[#64748b] bg-white p-2 focus-visible:outline-2 focus-visible:outline-offset-2"><option value="">Selecciona una categoría</option>{linkValue && !categories.some(category => category.id === linkValue) && <option value={linkValue}>Destino actual no disponible</option>}{categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>}
      {linkType === "PRODUCT" && <div className="space-y-2"><label className="block text-sm">Buscar producto<Input name="productSearch" value={query} onChange={event => { setQuery(event.target.value); setSuggestions([]); }} placeholder="Escribe al menos 2 caracteres" className="mt-1 w-full" /></label><p className="text-sm" role="status">{chosenName || "Selecciona un producto de los resultados."}{searching ? " Buscando…" : ""}</p>{suggestions.length > 0 && <ul aria-label="Resultados de productos" className="space-y-2">{suggestions.map(product => <li key={product.id}><Button variant="outline" type="button" className="w-full" aria-pressed={linkValue === product.id} onClick={() => { setLinkValue(product.id); setChosenName(product.name); }}>{product.name}</Button></li>)}</ul>}</div>}
      <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" name="active" checked={active} onChange={event => setActive(event.target.checked)} />Anuncio activo</label>
    </fieldset>
    {preparing && <p role="status">Preparando imagen…</p>}
    {error && <p role="alert" className="text-sm text-[#9f1239]">{error}</p>}
    <div className="flex flex-wrap gap-2"><Button type="submit" disabled={disabled || preparing}>{disabled ? "Guardando…" : "Guardar anuncio"}</Button><Button type="button" variant="secondary" disabled={disabled || preparing} onClick={onCancel}>Cancelar anuncio</Button></div>
  </form>;
}
