"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { catalogThemeChoices, isCatalogThemeCompatible } from "@/lib/catalog-theme-choice";
import type { StoredCatalogTemplate } from "@/lib/catalogTemplates";

type Props = {
  logoUrl: string | null;
  logoFile: File | null;
  template: StoredCatalogTemplate;
  value: string | null;
  persistedValue: string | null;
  disabled: boolean;
  onUse: (preset: string) => void;
  onChoose: () => void;
};
type Result = { source: File | string; template: StoredCatalogTemplate; value: string | null; request: number; id: string; colors: readonly string[] };

export default function CatalogLogoPaletteSuggestion({ logoUrl, logoFile, template, value, persistedValue, disabled, onUse, onChoose }: Props) {
  const [request, setRequest] = useState(0);
  const [result, setResult] = useState<Result>();
  const consumedRequest = useRef(0);
  const source = logoUrl ? logoFile ?? logoUrl : null;
  useEffect(() => {
    const manual = request > consumedRequest.current;
    consumedRequest.current = request;
    if (!source || disabled || (!manual && (persistedValue !== null || value !== null))) return;
    const controller = new AbortController();
    let current = true;
    const timeout = setTimeout(() => controller.abort(), 8000);
    Promise.all([import("@/lib/logo-palette-analysis"), import("@/lib/catalog-theme")]).then(async ([analysis, palettes]) => {
      const pixels = await analysis.readLogoPixels(source, controller.signal);
      const id = pixels && analysis.suggestLogoPalette(pixels, template, palettes.catalogThemeSwatches);
      const colors = palettes.catalogThemeSwatches.find(item => item.id === id)?.colors;
      if (current && !controller.signal.aborted) setResult(id && colors ? { source, template, value, request, id, colors } : undefined);
    }).catch(() => { if (current) setResult(undefined); });
    return () => { current = false; clearTimeout(timeout); controller.abort(); };
  }, [source, template, value, persistedValue, request, disabled]);

  const suggestion = !disabled && result?.source === source && result.template === template && result.value === value && result.request === request && isCatalogThemeCompatible(template, result.id) ? result : undefined;
  const name = catalogThemeChoices.find(item => item.id === suggestion?.id)?.name;
  return <div className="mt-4 space-y-3" data-logo-palette>
    <Button variant="outline" type="button" disabled={disabled || !source} onClick={() => { setResult(undefined); setRequest(current => current + 1); }}>Recalcular paleta según el logo</Button>
    {suggestion && <section aria-label="Paleta sugerida según tu logo" className="space-y-3 rounded-xl border border-[#cbd5cd] bg-[#f4f7f2] p-4 text-[#202b27]" data-logo-suggestion>
      <h4 className="text-sm font-semibold">Paleta sugerida según tu logo</h4>
      <p className="text-sm font-semibold">{name}</p>
      <div aria-hidden="true" className="flex gap-2">{suggestion.colors.map((color, index) => <span key={index} className="h-8 w-10 rounded border border-black/20" style={{ backgroundColor: color }} />)}</div>
      <p className="text-sm leading-6">El color principal de tu logo se parece al de esta paleta.</p>
      <p className="text-xs leading-5">Solo se publicará cuando pulses Guardar cambios.</p>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" type="button" onClick={() => { onUse(suggestion.id); setResult(undefined); }}>Usar esta paleta</Button>
        <Button variant="outline" type="button" onClick={() => { setResult(undefined); onChoose(); }}>Elegir otra</Button>
      </div>
    </section>}
  </div>;
}
