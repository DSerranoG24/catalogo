import { z } from "zod";

export const themePresetSchema = z.enum([
  "forest", "ocean", "terracotta", "rose", "violet", "graphite", "night-mint", "night-amber",
]).nullable().optional();

export class CatalogThemeError extends Error {}

export function assertCatalogThemeCompatibility(template: string, preset: unknown) {
  if (preset === null || preset === undefined) return;
  const parsed = themePresetSchema.safeParse(preset);
  if (!parsed.success) throw new CatalogThemeError("La paleta no es válida. Elige una paleta disponible o Predeterminado.");
  if ((template === "TECH" || template === "GRID") && preset !== "night-mint" && preset !== "night-amber") {
    throw new CatalogThemeError("Esta paleta todavía no está disponible para el diseño Tecnología. Elige otra paleta o Predeterminado.");
  }
}
