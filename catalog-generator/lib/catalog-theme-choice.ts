import { normalizeCatalogTemplate, type StoredCatalogTemplate } from "./catalogTemplates";

export const catalogThemeChoices = [
  { id: "forest", name: "Bosque" },
  { id: "ocean", name: "Océano" },
  { id: "terracotta", name: "Terracota" },
  { id: "rose", name: "Rosa" },
  { id: "violet", name: "Violeta" },
  { id: "graphite", name: "Grafito" },
  { id: "night-mint", name: "Menta noche" },
  { id: "night-amber", name: "Ámbar noche" },
] as const;

export function isCatalogThemeCompatible(template: StoredCatalogTemplate, preset: string | null) {
  if (preset === null) return true;
  if (!catalogThemeChoices.some(choice => choice.id === preset)) return false;
  return normalizeCatalogTemplate(template) !== "TECH" || preset === "night-mint" || preset === "night-amber";
}
