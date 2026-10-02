"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
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
import { toDateTimeLocalValue } from "@/lib/product-pricing";

const emptyProduct: ProductFormState = {
  name: "",
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

  useEffect(() => {
    let active = true;

    async function loadWorkspace() {
      const session = getSession();
      if (!session) {
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
  }, [catalogId, reloadKey, router]);

  function resetProductForm() {
    setForm(emptyProduct);
    setEditingProduct(null);
    setImageFile(null);
  }

  async function saveProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
    setEditingProduct(product);
    setForm({
      name: product.name,
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
    return <main className="mx-auto w-full max-w-6xl px-5 py-16 text-sm text-[#68756e] sm:px-8">Cargando catálogo...</main>;
  }

  if (!catalog) {
    return (
      <main className="mx-auto w-full max-w-6xl px-5 py-12 sm:px-8">
        <p role="alert" className="rounded-md bg-[#fff1ec] px-4 py-3 text-sm text-[#a5432a]">{error || "No se encontró el catálogo."}</p>
        <Link href="/" className="mt-5 inline-block text-sm font-semibold text-[#17665c]">Volver a catálogos</Link>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-8 sm:py-12">
      <Link href="/" className="text-sm font-medium text-[#17665c] hover:text-[#10554c]">← Catálogos</Link>
      <div className="mt-5 flex flex-col justify-between gap-4 border-b border-[#dce4dc] pb-6 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-semibold uppercase text-[#c65c3d]">/{catalog.slug}</p>
          <h1 className="mt-2 text-3xl font-semibold text-[#202b27]">{catalog.name}</h1>
          {catalog.description && <p className="mt-2 max-w-2xl text-sm leading-6 text-[#68756e]">{catalog.description}</p>}
        </div>
        <div className="text-sm text-[#68756e]">{products.length} {products.length === 1 ? "producto" : "productos"}</div>
      </div>

      {error && <p role="alert" className="mt-6 rounded-md border border-[#f0c8b9] bg-[#fff4ef] px-4 py-3 text-sm text-[#a5432a]">{error}</p>}

      <nav aria-label="Secciones del catálogo" className="mt-6 flex gap-1 border-b border-[#dce4dc]">
        {([
          ["products", "Productos"],
          ["orders", "Órdenes"],
          ["reviews", "Reseñas"],
          ["settings", "Enlace y diseño"],
        ] as const).map(([tab, label]) => (
          <button key={tab} type="button" onClick={() => setActiveTab(tab)} aria-current={activeTab === tab ? "page" : undefined} className={`border-b-2 px-4 py-3 text-sm font-semibold transition ${activeTab === tab ? "border-[#17665c] text-[#17665c]" : "border-transparent text-[#68756e] hover:text-[#202b27]"}`}>
            {label}
          </button>
        ))}
      </nav>

      {activeTab === "products" && <div className="mt-8 grid items-start gap-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="space-y-5">
          <CatalogProductEditor
            value={form}
            categories={categories}
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

          <CatalogCategories catalogId={catalogId} categories={categories} onCreated={() => setReloadKey((key) => key + 1)} />
        </div>

        <CatalogProductList products={products} loading={loading} onEdit={editProduct} onDelete={removeProduct} />
      </div>}
      {activeTab === "orders" && <div className="mt-8"><OrdersPanel catalogId={catalogId} /></div>}
      {activeTab === "reviews" && <div className="mt-8"><ReviewModerationPanel catalogId={catalogId} /></div>}
      {activeTab === "settings" && <div className="mt-8"><CatalogSettings catalog={catalog} onUpdated={(patch) => setCatalog((current) => current ? { ...current, ...patch } : current)} /></div>}
    </main>
  );
}