"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { catalogThemeChoices, isCatalogThemeCompatible } from "@/lib/catalog-theme-choice";
import { catalogTemplateOptions, normalizeCatalogTemplate, type StoredCatalogTemplate } from "@/lib/catalogTemplates";
import styles from "./catalog-palette-selector.module.css";

type PaletteModule = typeof import("@/lib/catalog-theme");

export default function CatalogPaletteSelector({ template, value, persistedValue, onChange, disabled }: {
  template: StoredCatalogTemplate;
  value: string | null;
  persistedValue: string | null;
  onChange: (value: string | null) => void;
  disabled: boolean;
}) {
  const [palettes, setPalettes] = useState<PaletteModule>();
  const [loadError, setLoadError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    import("@/lib/catalog-theme").then(module => {
      if (active) { setPalettes(module); setLoadError(false); }
    }).catch(() => { if (active) setLoadError(true); });
    return () => { active = false; };
  }, [attempt]);

  const templateId = normalizeCatalogTemplate(template);
  const original = catalogTemplateOptions.find(option => option.id === templateId) ?? catalogTemplateOptions[0];
  // Null emits no overrides; these chips describe the existing design itself.
  const defaultColors = {
    TECH: ["#081421", "#101e2d", "#56e0c0", "#79f0d0"],
    FASHION: ["#f7f2ec", "#fffdfa", "#322c29", "#9a554b"],
    BEAUTY: ["#fff8f6", "#fffaf9", "#b55271", "#a04e6e"],
    GLAMOUR: ["#fff4f7", "#fffaf9", "#c12868", "#8e174d"],
  }[original.id];
  const compatible = isCatalogThemeCompatible(template, value);
  const options = [{ id: null, name: "Predeterminado" }, ...catalogThemeChoices];

  return <section className={styles.section}>
    <fieldset role="radiogroup" aria-labelledby="catalog-palette-title" aria-describedby={!compatible ? "catalog-palette-warning" : undefined} disabled={disabled}>
      <legend id="catalog-palette-title" className={styles.title}>Colores de tu catálogo</legend>
      <p className={styles.description}>Elige una paleta para tu marca. Los cambios se publican al guardar.</p>
      {!compatible && <p id="catalog-palette-warning" role="alert" className={styles.warning}>La paleta seleccionada no es compatible con este diseño. Elige una opción compatible o Predeterminado antes de guardar. Tu selección se conserva hasta que decidas.</p>}
      {!palettes && !loadError && <p role="status" className={styles.description}>Cargando vistas previas…</p>}
      {loadError && <div role="alert" className={styles.warning}>No se pudieron cargar las vistas previas. <Button variant="outline" size="sm" onClick={() => { setLoadError(false); setAttempt(current => current + 1); }}>Reintentar vistas previas</Button></div>}
      <div className={styles.choices}>
        {options.map(option => {
          const available = isCatalogThemeCompatible(template, option.id);
          const selected = value === option.id;
          const colors = palettes?.catalogThemeSwatches.find(palette => palette.id === option.id)?.colors ?? defaultColors;
          const theme = palettes?.resolveCatalogTheme(template, option.id);
          const id = `catalog-palette-${option.id ?? "default"}`;
          return <label key={id} className={styles.choice} data-selected={selected || undefined} data-unavailable={!available || undefined}>
            <span className={styles.heading}>
              <input type="radio" name="themePreset" value={option.id ?? ""} checked={selected} aria-checked={selected} disabled={!available || !palettes} aria-labelledby={`${id}-name`} aria-describedby={!available ? `${id}-reason` : undefined} onChange={() => onChange(option.id)} />
              <span id={`${id}-name`}>{option.name}</span>
            </span>
            <span className={styles.swatches} aria-hidden="true">{colors.map((color, index) => <span key={index} style={{ backgroundColor: color }} />)}</span>
            <span aria-hidden="true" className={styles.preview} style={{ ...theme, backgroundColor: theme ? "var(--catalog-background)" : defaultColors[0], color: theme ? "var(--catalog-text)" : original.colors[2] }}>
              <span className={styles.previewTitle} style={{ backgroundColor: theme ? "var(--catalog-text)" : original.colors[2] }} />
              <span className={styles.previewCards}>{[0, 1, 2].map(index => <span key={index} style={{ backgroundColor: theme ? "var(--catalog-surface)" : defaultColors[1] }}><span style={{ backgroundColor: theme ? "var(--catalog-soft)" : defaultColors[0] }} /><span style={{ backgroundColor: theme ? "var(--catalog-primary)" : defaultColors[2] }} /></span>)}</span>
            </span>
            <span className={styles.status}>{selected ? "Seleccionada" : available ? "Disponible" : "No disponible"}</span>
            {!available && <span id={`${id}-reason`} className={styles.reason}>Esta paleta todavía no está disponible para el diseño Tecnología</span>}
          </label>;
        })}
      </div>
    </fieldset>
    <Button variant="outline" type="button" disabled={disabled || value === persistedValue} onClick={() => onChange(persistedValue)}>Restablecer colores</Button>
  </section>;
}
