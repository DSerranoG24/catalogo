import { CircleDollarSign, Home, Package, ShoppingCart, SlidersHorizontal, Tag, type LucideIcon } from "lucide-react";

export type PanelGroup = "Día a día" | "Productos" | "Dinero" | "Análisis";
export type PanelEntry = {
  id: "inicio" | "vender" | "inventario" | "catalogo" | "gastos" | "ajustes";
  label: string;
  href: string;
  icon: LucideIcon;
  /** null: shown above the groups (Inicio). */
  group: PanelGroup | null;
  /** Only routes that exist in main are enabled. Turning a module off is a change here, not in the layout. */
  enabled: boolean;
  /** Whether the entry stays in the mobile bottom bar; the rest go to «Más». */
  mobileBar: boolean;
};

export const PANEL_GROUPS: PanelGroup[] = ["Día a día", "Productos", "Dinero", "Análisis"];

export const PANEL_NAVIGATION: PanelEntry[] = [
  { id: "inicio", label: "Inicio", href: "/dashboard", icon: Home, group: null, enabled: true, mobileBar: true },
  { id: "vender", label: "Vender", href: "/dashboard/ventas", icon: ShoppingCart, group: "Día a día", enabled: true, mobileBar: true },
  { id: "inventario", label: "Inventario", href: "/dashboard/inventario", icon: Package, group: "Productos", enabled: true, mobileBar: true },
  { id: "catalogo", label: "Catálogo", href: "/dashboard/catalogos", icon: Tag, group: "Productos", enabled: true, mobileBar: false },
  // Gastos F1a (categories and one-off expenses).
  { id: "gastos", label: "Gastos", href: "/dashboard/gastos", icon: CircleDollarSign, group: "Dinero", enabled: true, mobileBar: false },
  // Ajustes points to the existing account page for now.
  { id: "ajustes", label: "Ajustes", href: "/dashboard/cuenta", icon: SlidersHorizontal, group: "Análisis", enabled: true, mobileBar: false },
];
// Servicio técnico, Cartera and Reportes have no route yet and are deliberately absent.

export const enabledEntries = () => PANEL_NAVIGATION.filter(entry => entry.enabled);
export const isEnabled = (id: PanelEntry["id"]) => PANEL_NAVIGATION.some(entry => entry.id === id && entry.enabled);

/** Inicio is active only on /dashboard; the rest also on their sub-routes. */
export function isActive(entry: PanelEntry, pathname: string) {
  return entry.href === "/dashboard" ? pathname === "/dashboard" : pathname === entry.href || pathname.startsWith(`${entry.href}/`);
}
