"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import {
  apiRequest,
  ApiError,
  Catalog,
  Category,
  clearSession,
  getSession,
  Product,
  ProductImage,
  slugify,
} from "@/lib/api";
import CatalogSettings from "@/components/catalogs/CatalogSettings";
import ReviewModerationPanel from "@/components/catalogs/ReviewModerationPanel";
import OrdersPanel from "@/components/catalogs/OrdersPanel";
import CatalogCategories from "@/components/catalogs/CatalogCategories";
import CatalogProductEditor, { ProductFormState } from "@/components/products/CatalogProductEditor";
import CatalogProductList from "@/components/products/CatalogProductList";
import ProductImportPanel from "@/components/products/ProductImportPanel";
import { ProductImportFlow, importBusy } from "@/lib/product-import-flow";
import { requestImportBatch } from "@/lib/product-import-api";
import { readProductImport } from "@/lib/product-import/reader";
import { toDateTimeLocalValue } from "@/lib/product-pricing";
import { ClipboardList, LayoutGrid, MessageSquareText, Settings2, Store } from "lucide-react";

const emptyProduct: ProductFormState = {
  name: "",
  brand: "",
  model: "",
  sku: "",
  price: "",
  saleEnabled: false,
  salePrice: "",
  saleStartsAt: "",
  saleEndsAt: "",
  stock: "0",
  categoryId: "",
  description: "",
};

export default function CatalogWorkspace({ catalogId }: { catalogId: string }) {
  const router = useRouter();
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [error, setError] = useState("");
  const [form, setForm] = useState<ProductFormState>(emptyProduct);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [savingProduct, setSavingProduct] = useState(false);
  const [activeTab, setActiveTab] = useState<"products" | "orders" | "reviews" | "settings">("products");
  const importButtonRef = useRef<HTMLButtonElement>(null);
  const refreshAfterImport = useCallback(() => setReloadKey(key => key + 1), []);
  const importFlow = useMemo(() => new ProductImportFlow(catalogId, { read: readProductImport, request: requestImportBatch, refresh: refreshAfterImport }), [catalogId, refreshAfterImport]);
  const importState = useSyncExternalStore(importFlow.subscribe, importFlow.getSnapshot, importFlow.getSnapshot);
  const importActive = importBusy(importState.phase);

  useEffect(() => { importFlow.activate(); return () => importFlow.dispose(); }, [importFlow]);
  useEffect(() => {
    if (!importActive) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [importActive]);

  useEffect(() => {
    let active = true;

    async function loadWorkspace() {
      const session = getSession();
      if (!session) {
        if (importFlow.getSnapshot().open) { importFlow.sessionExpired(); return; }
        router.replace("/login");
        return;
      }

      setLoading(true);
      setError("");
      try {
        const [catalogResult, categoryResult, productResult] = await Promise.all([
          apiRequest<{ catalog: Catalog }>(`/catalogs/${catalogId}`),
          apiRequest<{ categories: Category[] }>(`/categories/catalog/${catalogId}`),
          apiRequest<{ products: Product[] }>(`/products/catalog/${catalogId}`),
        ]);
        const productsWithSignedImages = await Promise.all(
          productResult.products.map(async (product) => {
            const imageResult = await apiRequest<{ images: ProductImage[] }>(
              `/product-images/product/${product.id}`,
              {}
            );
            return { ...product, images: imageResult.images };
          })
        );

        if (!active) return;
        setCatalog(catalogResult.catalog);
        setCategories(categoryResult.categories);
        setProducts(productsWithSignedImages);
      } catch (requestError) {
        if (!active) return;
        if (requestError instanceof ApiError && requestError.status === 401) {
          if (importFlow.getSnapshot().open) { importFlow.sessionExpired(); return; }
          clearSession();
          router.replace("/login");
          return;
        }
        setError(requestError instanceof Error ? requestError.message : "No se pudo cargar el catálogo.");
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadWorkspace();
    return () => {
      active = false;
    };
  }, [catalogId, reloadKey, router, importFlow]);

  function resetProductForm() {
    setForm(emptyProduct);
    setEditingProduct(null);
    setImageFile(null);
  }

  async function saveProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (importBusy(importFlow.getSnapshot().phase)) return;
    setError("");
    const session = getSession();
    if (!session) return router.replace("/login");

    const normalizedName = form.name.trim();
    const slug = slugify(normalizedName);
    const price = Number(form.price);
    const stock = Number(form.stock);
    if (!slug || !Number.isSafeInteger(price) || price < 0 || !Number.isSafeInteger(stock) || stock < 0) {
      setError("Revisa el nombre, el precio y el inventario. El precio y el inventario deben ser números enteros no negativos.");
      return;
    }

    const salePrice = form.saleEnabled ? Number(form.salePrice) : null;
    const saleStartsAt = form.saleEnabled ? new Date(form.saleStartsAt) : null;
    const saleEndsAt = form.saleEnabled ? new Date(form.saleEndsAt) : null;
    if (form.saleEnabled && (
      !Number.isSafeInteger(salePrice) ||
      salePrice! < 0 ||
      salePrice! >= price ||
      !form.saleStartsAt ||
      !form.saleEndsAt ||
      !saleStartsAt ||
      !saleEndsAt ||
      !Number.isFinite(saleStartsAt.getTime()) ||
      !Number.isFinite(saleEndsAt.getTime()) ||
      saleStartsAt >= saleEndsAt
    )) {
      setError("Revisa la oferta: el precio debe ser menor al normal y las fechas formar un periodo válido.");
      return;
    }

    const payload = {
      name: normalizedName,
      brand: form.brand.trim(),
      model: form.model.trim(),
      ...(form.sku.trim() ? { sku: form.sku.trim() } : {}),
      slug,
      price,
      salePrice,
      saleStartsAt: saleStartsAt?.toISOString() ?? null,
      saleEndsAt: saleEndsAt?.toISOString() ?? null,
      stock,
      ...(form.categoryId ? { categoryId: form.categoryId } : {}),
      ...(form.description.trim() ? { description: form.description.trim() } : {}),
    };

    setSavingProduct(true);
    let productId = editingProduct?.id;
    try {
      if (editingProduct) {
        await apiRequest(`/products/${editingProduct.id}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
      } else {
        const result = await apiRequest<{ product: Product }>(`/products/catalog/${catalogId}`, {
          method: "POST",
          body: JSON.stringify(payload),
        });
        productId = result.product.id;
      }

      let uploadError = "";
      if (imageFile && productId) {
        const imageForm = new FormData();
        imageForm.append("image", imageFile);
        try {
          await apiRequest(`/product-images/product/${productId}`, {
            method: "POST",
            body: imageForm,
          });
        } catch (requestError) {
          uploadError = requestError instanceof Error
            ? `El producto se guardó, pero no se pudo subir la imagen: ${requestError.message}`
            : "El producto se guardó, pero no se pudo subir la imagen.";
        }
      }

      resetProductForm();
      setError(uploadError);
      setReloadKey((key) => key + 1);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "No se pudo guardar el producto.");
    } finally {
      setSavingProduct(false);
    }
  }

  function editProduct(product: Product) {
    if (importBusy(importFlow.getSnapshot().phase)) return;
    setEditingProduct(product);
    setForm({
      name: product.name,
      brand: product.brand ?? "",
      model: product.model ?? "",
      sku: product.sku ?? "",
      price: String(product.price),
      saleEnabled: product.salePrice !== null,
      salePrice: product.salePrice === null ? "" : String(product.salePrice),
      saleStartsAt: toDateTimeLocalValue(product.saleStartsAt),
      saleEndsAt: toDateTimeLocalValue(product.saleEndsAt),
      stock: String(product.stock),
      categoryId: product.categoryId ?? "",
      description: product.description ?? "",
    });
    setImageFile(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function removeProduct(product: Product) {
    if (importBusy(importFlow.getSnapshot().phase)) return;
    if (!window.confirm(`¿Eliminar “${product.name}”?`)) return;
    try {
      await apiRequest(`/products/${product.id}`, { method: "DELETE" });
      if (editingProduct?.id === product.id) resetProductForm();
      setProducts((current) => current.filter((item) => item.id !== product.id));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "No se pudo eliminar el producto.");
    }
  }

  if (loading && !catalog) {
    return <main role="status" aria-label="Cargando catálogo" className="mx-auto w-full max-w-7xl animate-pulse px-5 py-10 sm:px-8 sm:py-12"><div className="h-3 w-36 rounded-full bg-[#dce5dc]" /><div className="mt-7 h-40 rounded-3xl border border-[#e2e8e0] bg-white" /><div className="mt-6 flex gap-2 rounded-2xl border border-[#e2e8e0] bg-white p-2">{[0, 1, 2, 3].map((item) => <div key={item} className="h-10 w-28 rounded-xl bg-[#e8eee5]" />)}</div><div className="mt-8 grid gap-8 lg:grid-cols-2"><div className="h-[34rem] rounded-3xl border border-[#e2e8e0] bg-white" /><div className="h-[34rem] rounded-3xl border border-[#e2e8e0] bg-white" /></div></main>;
  }

  if (!catalog) {
    return (
      <main className="mx-auto w-full max-w-6xl px-5 py-12 sm:px-8">
        <p role="alert" className="rounded-md bg-[#fff1ec] px-4 py-3 text-sm text-[#a5432a]">{error || "No se encontró el catálogo."}</p>
        <Link href="/" className="mt-5 inline-block text-sm font-semibold text-[var(--brand-emerald)]">Volver a catálogos</Link>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-7xl px-5 py-8 sm:px-8 sm:py-12">
      <div className="mb-6 flex items-center gap-2 text-xs font-medium text-[#7b8780]"><Link href="/" aria-disabled={importActive} tabIndex={importActive ? -1 : undefined} onClick={event => { if (importActive) event.preventDefault(); }} className="transition hover:text-[#315e4f]">Catálogos</Link><span className="text-[#c2cbc3]">/</span><span className="max-w-48 truncate text-[#35473d]">{catalog.name}</span></div>
      <section className="relative overflow-hidden rounded-3xl border border-[#e2e8e0] bg-white p-6 shadow-[0_18px_54px_-44px_rgba(36,63,47,0.45)] sm:p-8">
        <div className="pointer-events-none absolute -right-16 -top-24 size-64 rounded-full border border-[#eaf0e8]" /><div className="pointer-events-none absolute -right-3 -top-12 size-40 rounded-full border border-[#eaf0e8]" />
        <div className="relative flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
          <div className="min-w-0"><p className="inline-flex items-center gap-2 rounded-full bg-[var(--brand-emerald-soft)] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-[#52725e]"><Store className="size-3.5" aria-hidden="true" /> Panel de tienda <span className="text-[#a5b5a7]">·</span> /{catalog.slug}</p><h1 className="mt-3 truncate text-3xl font-semibold tracking-tight text-[#202b27] sm:text-4xl">{catalog.name}</h1>{catalog.description && <p className="mt-2 max-w-2xl text-sm leading-6 text-[#68756e]">{catalog.description}</p>}</div>
          <div className="flex items-center gap-3 self-start rounded-2xl border border-[#edf1ec] bg-[#fafbf9] px-4 py-3 sm:self-auto"><span className="grid size-9 place-items-center rounded-xl bg-white text-[#557a62]"><LayoutGrid className="size-4" aria-hidden="true" /></span><div><p className="text-lg font-semibold leading-none text-[#263b31]">{products.length}</p><p className="mt-1 text-[10px] uppercase tracking-[0.1em] text-[#849087]">{products.length === 1 ? "producto" : "productos"}</p></div></div>
        </div>
      </section>

      {error && <p role="alert" className="mt-6 rounded-md border border-[#f0c8b9] bg-[#fff4ef] px-4 py-3 text-sm text-[#a5432a]">{error}</p>}

      <nav aria-label="Secciones del catálogo" className="mt-6 flex gap-1 overflow-x-auto rounded-2xl border border-[#e2e8e0] bg-white/75 p-1.5 shadow-sm">
        {([
          ["products", "Productos", LayoutGrid],
          ["orders", "Órdenes", ClipboardList],
          ["reviews", "Reseñas", MessageSquareText],
          ["settings", "Tienda y diseño", Settings2],
        ] as const).map(([tab, label, Icon]) => (
          <button key={tab} type="button" disabled={importActive && activeTab !== tab} onClick={() => setActiveTab(tab)} aria-current={activeTab === tab ? "page" : undefined} className={`inline-flex min-h-10 shrink-0 items-center gap-2 rounded-xl px-3.5 text-xs font-semibold transition disabled:opacity-50 sm:px-4 sm:text-sm ${activeTab === tab ? "bg-[var(--brand-emerald)] text-white shadow-sm" : "text-[#68756e] hover:bg-[#f0f4ee] hover:text-[#202b27]"}`}>
            <Icon className="size-4" aria-hidden="true" /> {label}
          </button>
        ))}
      </nav>

      <div id="product-import-panel" hidden={!importState.open || activeTab !== "products"}>{importState.open && <ProductImportPanel flow={importFlow} state={importState} archived={Boolean(catalog.archivedAt)} onClose={() => { if (importFlow.close()) importButtonRef.current?.focus(); }} />}</div>

      {activeTab === "products" && <div className="mt-8 grid items-start gap-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <fieldset disabled={importActive} className="min-w-0 space-y-5"><legend className="sr-only">Edición manual de productos y categorías</legend>
          <CatalogProductEditor
            value={form}
            categories={categories}
            products={products}
            editing={Boolean(editingProduct)}
            imageFile={imageFile}
            saving={savingProduct}
            onChange={(field, value) => setForm((current) => ({ ...current, [field]: value }))}
            onImageChange={(file) => {
              if (file && file.size > 5 * 1024 * 1024) {
                setError("La imagen supera el límite de 5 MB.");
                setImageFile(null);
                return;
              }
              setImageFile(file);
            }}
            onSubmit={saveProduct}
            onCancel={resetProductForm}
          />

          <CatalogCategories catalogId={catalogId} categories={categories} onCreated={() => setReloadKey((key) => key + 1)} onDeleted={(categoryId) => {
            setForm(current => current.categoryId === categoryId ? { ...current, categoryId: "" } : current);
            setReloadKey(key => key + 1);
          }} />
        </fieldset>

        <CatalogProductList products={products} loading={loading} onEdit={editProduct} onDelete={removeProduct}
          importButtonRef={importButtonRef} importOpen={importState.open} importDisabled={Boolean(catalog.archivedAt) || savingProduct || importActive} mutationDisabled={importActive}
          onImport={() => { importFlow.open(); if (importState.open) document.getElementById("product-import-title")?.focus(); }} />
      </div>}
      {activeTab === "orders" && <div className="mt-8"><OrdersPanel catalogId={catalogId} /></div>}
      {activeTab === "reviews" && <div className="mt-8"><ReviewModerationPanel catalogId={catalogId} /></div>}
      {activeTab === "settings" && <div className="mt-8"><CatalogSettings key={catalog.id} catalog={catalog} onUpdated={(patch) => setCatalog((current) => current ? { ...current, ...patch } : current)} /></div>}
    </main>
  );
}
