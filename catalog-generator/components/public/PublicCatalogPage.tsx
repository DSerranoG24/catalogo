"use client";

import { startTransition, useDeferredValue, useEffect, useState } from "react";
import { publicApiRequest, PublicCatalog, PublicProduct } from "@/lib/api";
import EditorialTemplate from "@/components/public/EditorialTemplate";
import GridTemplate from "@/components/public/GridTemplate";
import BoutiqueTemplate from "@/components/public/BoutiqueTemplate";
import { ProductSortOrder } from "@/components/public/PublicProductToolbar";

export default function PublicCatalogPage({ publicId }: { publicId: string }) {
  const [catalog, setCatalog] = useState<PublicCatalog | null>(null);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [cartReady, setCartReady] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortOrder, setSortOrder] = useState<ProductSortOrder>("store");
  const deferredSearchQuery = useDeferredValue(searchQuery.trim().toLocaleLowerCase("es"));
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const cartStorageKey = `catalogo-cart-${publicId}`;

  useEffect(() => {
    if (!catalog) return;
    try {
      const storedCart = sessionStorage.getItem(cartStorageKey);
      if (storedCart) {
        const parsed: unknown = JSON.parse(storedCart);
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
          const restored = Object.fromEntries(
            Object.entries(parsed).filter((entry): entry is [string, number] =>
              typeof entry[1] === "number" && Number.isInteger(entry[1]) && entry[1] > 0 && entry[1] <= 99
            )
          );
          startTransition(() => {
            setQuantities(restored);
            setCartReady(true);
          });
        } else {
          startTransition(() => setCartReady(true));
        }
      } else {
        startTransition(() => setCartReady(true));
      }
    } catch {
      sessionStorage.removeItem(cartStorageKey);
      startTransition(() => setCartReady(true));
    } finally {
      if (!sessionStorage.getItem(cartStorageKey)) {
        startTransition(() => setCartReady(true));
      }
    }
  }, [cartStorageKey, catalog]);

  useEffect(() => {
    if (cartReady) sessionStorage.setItem(cartStorageKey, JSON.stringify(quantities));
  }, [cartReady, cartStorageKey, quantities]);

  useEffect(() => {
    let active = true;
    publicApiRequest<{ catalog: PublicCatalog }>(`/public/catalogs/${encodeURIComponent(publicId)}`)
      .then((result) => {
        if (active) setCatalog(result.catalog);
      })
      .catch((requestError) => {
        if (active) setError(requestError instanceof Error ? requestError.message : "No se pudo encontrar este catálogo.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [publicId]);

  const filteredProducts = [...(catalog?.products ?? [])]
    .filter((product) => {
      if (selectedCategory && product.categoryId !== selectedCategory) return false;
      if (!deferredSearchQuery) return true;
      const searchableText = [product.name, product.brand, product.model, product.description, product.category?.name]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase("es");
      return searchableText.includes(deferredSearchQuery);
    })
    .sort((left, right) => {
      if (sortOrder === "price-asc") return left.price - right.price;
      if (sortOrder === "price-desc") return right.price - left.price;
      if (sortOrder === "name-asc") return left.name.localeCompare(right.name, "es");
      return 0;
    });
  const pageSize = 12;
  const pageCount = Math.max(1, Math.ceil(filteredProducts.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageProducts = filteredProducts.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const cartCount = Object.values(quantities).reduce((sum, quantity) => sum + quantity, 0);
  const cartTotal = catalog?.products.reduce((sum, product) => sum + product.price * (quantities[product.id] ?? 0), 0) ?? 0;

  function changeQuantity(product: PublicProduct, delta: number) {
    setQuantities((current) => {
      const nextQuantity = Math.max(0, Math.min(99, (current[product.id] ?? 0) + delta));
      const next = { ...current };
      if (nextQuantity === 0) delete next[product.id];
      else next[product.id] = nextQuantity;
      return next;
    });
  }

  if (loading) {
    return <main className="grid min-h-screen place-items-center bg-[#f2f5ef] px-5 text-sm text-[#68756e]">Cargando catálogo...</main>;
  }

  if (!catalog) {
    return <main className="grid min-h-screen place-items-center bg-[#f2f5ef] px-5"><div className="max-w-md text-center"><p className="text-xs font-semibold uppercase text-[#c65c3d]">Catálogo no disponible</p><h1 className="mt-2 text-2xl font-semibold text-[#202b27]">No encontramos este enlace.</h1><p className="mt-2 text-sm text-[#68756e]">{error || "Puede estar inactivo o haber cambiado."}</p></div></main>;
  }

  const templateProps = {
    catalog,
    products: pageProducts,
    totalProducts: filteredProducts.length,
    searchQuery,
    sortOrder,
    onSearchChange: (value: string) => {
      setSearchQuery(value);
      setPage(1);
    },
    onSortChange: (value: ProductSortOrder) => {
      setSortOrder(value);
      setPage(1);
    },
    page: currentPage,
    pageCount,
    onPageChange: setPage,
    quantities,
    categories: catalog.categories,
    selectedCategory,
    onSelectCategory: (categoryId: string) => {
      setSelectedCategory(categoryId);
      setPage(1);
    },
    onAdd: (product: PublicProduct) => changeQuantity(product, 1),
    cartCount,
    cartTotal,
  };
  const Template = catalog.template === "GRID"
    ? GridTemplate
    : catalog.template === "BOUTIQUE"
      ? BoutiqueTemplate
      : EditorialTemplate;

  return (
    <main className="min-h-screen pb-12">
      <Template {...templateProps} />
      <footer className="border-t border-[#dce4dc] px-5 py-5 text-center text-xs text-[#849087]">Catálogo compartido por su vendedor</footer>
    </main>
  );
}
