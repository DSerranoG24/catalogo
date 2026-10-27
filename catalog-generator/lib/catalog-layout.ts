export const catalogLayouts = [
  { id: null, name: "Clásica", description: "Categorías horizontales y catálogo a todo el ancho." },
  { id: "sidebar", name: "Lateral", description: "Categorías, búsqueda y contacto a la izquierda." },
  { id: "sidebar-compact", name: "Lateral compacta", description: "Columna estrecha de categorías y más espacio para productos." },
] as const;

export type CatalogLayout = typeof catalogLayouts[number]["id"];

export function normalizeCatalogLayout(value: unknown): CatalogLayout {
  return value === "sidebar" || value === "sidebar-compact" ? value : null;
}
