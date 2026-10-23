export const catalogTemplateOptions = [
  { id: "TECH", name: "Tecnología", description: "Estética oscura, detalles eléctricos y foco en especificaciones.", colors: ["#081421", "#56e0c0", "#e5f2ff"], category: "SMART / AUDIO / GAMING" },
  { id: "FASHION", name: "Ropa", description: "Editorial de moda con tonos cálidos y fotografía protagonista.", colors: ["#f5eee7", "#9a554b", "#322c29"], category: "NUEVA TEMPORADA" },
  { id: "BEAUTY", name: "Maquillaje", description: "Paleta suave y luminosa para destacar color y textura.", colors: ["#fff1ee", "#b55271", "#552e48"], category: "BEAUTY / SKIN / COLOR" },
  { id: "GLAMOUR", name: "Glamour", description: "Fucsia, vino y detalles botánicos para una tienda con personalidad.", colors: ["#fff4f7", "#c12868", "#45182f"], category: "GLAMOUR / COLOR / CUIDADO" },
] as const;

export type CatalogTemplateId = (typeof catalogTemplateOptions)[number]["id"];
export type StoredCatalogTemplate = CatalogTemplateId | "EDITORIAL" | "GRID" | "BOUTIQUE";

/** Convert legacy database identifiers to the current public design IDs. */
export function normalizeCatalogTemplate(template: StoredCatalogTemplate): CatalogTemplateId {
  if (template === "GRID") return "TECH";
  if (template === "BOUTIQUE") return "BEAUTY";
  if (template === "EDITORIAL") return "FASHION";
  return template;
}
