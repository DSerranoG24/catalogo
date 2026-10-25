import { randomUUID } from "node:crypto";
import { ImportAccess, ImportCategory, ImportProduct, ImportWrite, ProductImportStore } from "../repositories/product-import.repository";
import { importNameKey } from "./product-import-plan";

export const importCatalogA = "11111111-1111-4111-8111-111111111111";
export const importCatalogB = "22222222-2222-4222-8222-222222222222";
export const importTestSecret = "local-import-test-secret-with-more-than-32-bytes";
type Catalog = { owner: string; archived: boolean; products: ImportProduct[]; categories: ImportCategory[] };

export function createImportFixture() {
  const catalogs = new Map<string, Catalog>([
    [importCatalogA, { owner: "owner-a", archived: false, products: [], categories: [] }],
    [importCatalogB, { owner: "owner-b", archived: false, products: [], categories: [] }],
  ]);
  const queues = new Map<string, Promise<void>>();
  let writes = 0, failName = "";
  const catalog = (id: string) => { const value = catalogs.get(id); if (!value) throw new Error("CATALOG_NOT_FOUND"); return value; };
  const authorize = async (id: string, user: string) => {
    const value = catalog(id);
    if (value.owner !== user) throw new Error("CATALOG_NOT_FOUND");
    if (value.archived) throw new Error("CATALOG_ARCHIVED");
  };
  function product(id: string, data: Partial<ImportProduct> = {}): ImportProduct {
    return { id: randomUUID(), catalogId: id, name: "Producto", slug: randomUUID(), sku: null,
      price: 1000, stock: 3, description: null, brand: null, model: null, categoryId: null,
      salePrice: null, saleStartsAt: null, saleEndsAt: null, active: true, updatedAt: new Date("2026-10-24T12:00:00Z"), ...data };
  }
  function patch(p: ImportProduct, d: ImportWrite) {
    return { ...p, name: d.name, price: d.price ?? p.price, stock: d.stock ?? p.stock,
      sku: d.sku ?? p.sku, description: d.description ?? p.description, brand: d.brand ?? p.brand,
      model: d.model ?? p.model, categoryId: d.categoryId ?? p.categoryId,
      salePrice: d.salePrice === undefined ? p.salePrice : d.salePrice,
      saleStartsAt: d.saleStartsAt === undefined ? p.saleStartsAt : d.saleStartsAt,
      saleEndsAt: d.saleEndsAt === undefined ? p.saleEndsAt : d.saleEndsAt,
      updatedAt: new Date(p.updatedAt.getTime() + 1) };
  }
  function access(id: string, state: Catalog, onWrite: () => void): ImportAccess {
    return {
      products: async (name, sku) => {
        const skuMatches = sku ? state.products.filter(p => p.sku?.trim() === sku) : [];
        return structuredClone(skuMatches.length ? skuMatches : state.products.filter(p => importNameKey(p.name) === importNameKey(name)));
      },
      categories: async name => structuredClone(state.categories.filter(c => importNameKey(c.name) === importNameKey(name))),
      slugs: async base => state.products.filter(p => p.slug.startsWith(base)).map(p => p.slug),
      create: async data => {
        const created = product(id, patch(product(id), data));
        created.slug = data.slug;
        state.products.push(created); onWrite();
        if (data.name === failName) throw new Error("Synthetic storage failure; never log row contents");
        return created.id;
      },
      update: async (target, data) => {
        if ("active" in data || "slug" in data) throw new Error("Unexpected visibility/slug mutation");
        const index = state.products.findIndex(p => p.id === target);
        const old = state.products[index];
        if (!old) throw new Error("IMPORT_STATE_CHANGED");
        state.products[index] = patch(old, data); onWrite();
        if (data.name === failName) throw new Error("Synthetic row failure");
      },
    };
  }
  const store: ProductImportStore = {
    authorize,
    read: id => access(id, catalog(id), () => { throw new Error("Preview attempted to write"); }),
    async row<T>(id: string, user: string, work: (value: ImportAccess) => Promise<T>): Promise<T> {
      const previous = queues.get(id) ?? Promise.resolve();
      let release = () => {};
      queues.set(id, new Promise<void>(resolve => { release = resolve; }));
      await previous;
      try {
        await authorize(id, user);
        const staged = structuredClone(catalog(id));
        let stagedWrites = 0;
        const result = await work(access(id, staged, () => { stagedWrites++; }));
        catalogs.set(id, staged); writes += stagedWrites;
        return result;
      } finally { release(); }
    },
  };
  return { store, catalog, get writes() { return writes; },
    failRow(name: string) { failName = name; },
    seedProduct(id: string, data: Partial<ImportProduct> = {}) { const p = product(id, data); catalog(id).products.push(p); return p; },
    seedCategory(id: string, name: string) { const c = { id: randomUUID(), name, updatedAt: new Date() }; catalog(id).categories.push(c); return c; },
  };
}
