import type { CSSProperties } from "react";
import { normalizeCatalogTemplate, type StoredCatalogTemplate } from "./catalogTemplates";

export type CatalogThemeStyle = CSSProperties & Record<`--${string}`, string>;

type Palette = {
  background: string; surface: string; text: string; textMuted: string;
  primary: string; onPrimary: string; border: string; accent: string;
  dark: boolean;
};
const light = {
  background: "#F8FAFC", surface: "#FFFFFF", text: "#0F172A", textMuted: "#475569",
  onPrimary: "#FFFFFF", border: "#64748B", dark: false,
};
const dark = {
  background: "#0F172A", surface: "#1E293B", text: "#F8FAFC", textMuted: "#CBD5E1",
  onPrimary: "#0F172A", border: "#94A3B8", dark: true,
};
const palettes = {
  forest: { ...light, primary: "#166534", accent: "#115E59" },
  ocean: { ...light, primary: "#1D4ED8", accent: "#075985" },
  terracotta: { ...light, primary: "#9A3412", accent: "#92400E" },
  rose: { ...light, primary: "#9D174D", accent: "#86198F" },
  violet: { ...light, primary: "#6D28D9", accent: "#5B21B6" },
  graphite: { ...light, primary: "#334155", accent: "#1E40AF" },
  "night-mint": { ...dark, primary: "#5EEAD4", accent: "#A5F3FC" },
  "night-amber": { ...dark, primary: "#FCD34D", accent: "#FDBA74" },
} satisfies Record<string, Palette>;

export const catalogThemeSwatches = Object.entries(palettes).map(([id, p]) => ({
  id, colors: [p.background, p.surface, p.primary, p.accent],
}));

/** An empty result intentionally leaves every legacy fallback in control. */
export function resolveCatalogTheme(template: StoredCatalogTemplate, themePreset: unknown): CatalogThemeStyle | undefined {
  if (typeof themePreset !== "string" || !Object.hasOwn(palettes, themePreset)) return undefined;
  const palette = Object.entries(palettes).find(([id]) => id === themePreset)?.[1];
  if (!palette || (normalizeCatalogTemplate(template) === "TECH" && !palette.dark)) return undefined;
  const p = palette;
  const soft = p.dark ? "#334155" : "#E2E8F0";
  const borderSubtle = p.dark ? "#475569" : "#CBD5E1";
  const danger = p.dark ? "#FDA4AF" : "#9F1239";
  const dangerSurface = p.dark ? "#4C0519" : "#FFF1F2";
  const dangerLabel = p.dark ? "#0F172A" : "#FFFFFF";
  // Keep hover opaque and prevalidated rather than reducing opacity/brightness.
  const hover = p.dark ? p.accent : p.text;
  const variables: CatalogThemeStyle = {
    colorScheme: p.dark ? "dark" : "light",
    "--catalog-background": p.background,
    "--catalog-surface": p.surface,
    "--catalog-text": p.text,
    "--catalog-text-muted": p.textMuted,
    "--catalog-primary": p.primary,
    "--catalog-on-primary": p.onPrimary,
    "--catalog-primary-hover": hover,
    "--catalog-border": p.border,
    "--catalog-border-subtle": borderSubtle,
    "--catalog-accent": p.accent,
    "--catalog-soft": soft,
    "--catalog-image-background": soft,
    "--catalog-focus": p.primary,
    "--catalog-danger": danger,
    "--catalog-danger-surface": dangerSurface,
    "--catalog-danger-label": dangerLabel,
    "--catalog-success": p.dark ? "#86EFAC" : "#166534",
    "--catalog-success-surface": p.dark ? "#052E16" : "#F0FDF4",
    "--catalog-hero-background": `linear-gradient(135deg,${p.surface},${p.background})`,
    "--catalog-art-background": `linear-gradient(135deg,${soft},${p.surface})`,
    "--catalog-shadow": p.dark ? "0 18px 38px -28px #000000" : "0 18px 38px -28px #64748B",
    "--catalog-muted-opacity": "1",
    "--catalog-hover-brightness": "1",
    "--catalog-surface-hover": soft,
    "--catalog-focus-ring": p.primary,
    "--product-card-background": p.surface,
    "--product-card-border": borderSubtle,
    "--product-card-image-background": soft,
    "--product-card-text": p.text,
    "--product-card-title": p.text,
    "--product-card-price": p.text,
    "--product-card-accent": p.primary,
    "--product-card-button": p.primary,
    "--product-card-button-hover": hover,
    "--product-card-button-text": p.onPrimary,
    "--product-card-focus": p.primary,
    "--product-card-placeholder": p.text,
    "--product-card-placeholder-label": p.textMuted,
    "--product-card-previous-price": p.textMuted,
    "--product-card-sale": danger,
    "--product-card-sale-label": dangerLabel,
    "--product-card-divider": borderSubtle,
    "--product-card-shadow": "var(--catalog-shadow)",
    "--cart-bg": p.background,
    "--cart-fg": p.text,
    "--cart-muted": p.textMuted,
    "--cart-border": borderSubtle,
    "--cart-surface": soft,
    "--cart-card": p.surface,
    "--cart-accent": p.primary,
    "--cart-accent-fg": p.onPrimary,
    "--cart-soft": soft,
    "--cart-danger": danger,
  };
  const translucent = {
    "border-subtle": { color: borderSubtle, steps: [5, 10, 20, 25, 30, 35, 50, 60, 70, 80] },
    primary: { color: p.primary, steps: [10, 40] },
    surface: { color: p.surface, steps: [30, 70, 75, 80, 85, 90, 95] },
    text: { color: p.text, steps: [70, 90] },
    soft: { color: soft, steps: [45] },
  };
  for (const [role, { color, steps }] of Object.entries(translucent)) {
    for (const alpha of steps) variables[`--catalog-${role}-alpha-${alpha}`] = `color-mix(in srgb,${color} ${alpha}%,transparent)`;
  }
  return variables;
}
