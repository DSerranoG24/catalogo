export type SelectedProduct = { id: string; name: string; updatedAt: string };

export class ProductBulkSelection {
  constructor(readonly catalogId = "") {}
  private items: readonly SelectedProduct[] = [];
  private listeners = new Set<() => void>();
  readonly subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  readonly getSnapshot = () => this.items;
  private replace(items: readonly SelectedProduct[]) { this.items = items; for (const listener of this.listeners) listener(); }
  clear() { this.replace([]); }
  toggle(product: SelectedProduct) {
    if (this.items.some(item => item.id === product.id)) this.replace(this.items.filter(item => item.id !== product.id));
    else {
      if (this.items.length === 96) throw new Error("Puedes seleccionar como máximo 96 productos.");
      if (!product.updatedAt || !Number.isFinite(Date.parse(product.updatedAt))) throw new Error("Actualiza el listado antes de seleccionar este producto.");
      this.replace([...this.items, { id: product.id, name: product.name, updatedAt: product.updatedAt }]);
    }
  }
  togglePage(products: readonly SelectedProduct[]) {
    const ids = new Set(this.items.map(item => item.id));
    if (products.every(product => ids.has(product.id))) { const page = new Set(products.map(product => product.id)); this.replace(this.items.filter(item => !page.has(item.id))); return; }
    const added = products.filter(product => !ids.has(product.id));
    if (this.items.length + added.length > 96) throw new Error("La página completa superaría 96 seleccionados. Selecciona productos individualmente o quita otros.");
    if (added.some(product => !product.updatedAt || !Number.isFinite(Date.parse(product.updatedAt)))) throw new Error("Actualiza el listado antes de seleccionar esta página.");
    this.replace([...this.items, ...added.map(({ id, name, updatedAt }) => ({ id, name, updatedAt }))]);
  }
}
