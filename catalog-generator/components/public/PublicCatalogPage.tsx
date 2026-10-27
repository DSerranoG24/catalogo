"use client";

import PublicCatalogCartLink from "./PublicCatalogCartLink";

import { startTransition, useDeferredValue, useEffect, useState, type ComponentType } from "react";
import { PublicCatalog, PublicProduct, rememberPublicCatalogTemplate } from "@/lib/api";
import EditorialTemplate from "@/components/public/EditorialTemplate";
import { ProductSortOrder } from "@/components/public/PublicProductToolbar";
import FloatingWhatsAppButton from "@/components/public/FloatingWhatsAppButton";
import TechnologyTemplate from "@/components/public/TechnologyTemplate";
import FashionTemplate from "@/components/public/FashionTemplate";
import BeautyTemplate from "@/components/public/BeautyTemplate";
import GlamourTemplate from "@/components/public/GlamourTemplate";
import { CatalogTemplateId, normalizeCatalogTemplate } from "@/lib/catalogTemplates";
import { PublicCatalogTemplateProps } from "@/components/public/PublicCatalogTemplateProps";
import type { CatalogThemeStyle } from "@/lib/catalog-theme";
import themeStyles from "./catalog-theme.module.css";
import { validPublicCategory } from "@/lib/public-category";

const templateComponents: Record<CatalogTemplateId, ComponentType<PublicCatalogTemplateProps>> = {
  TECH: TechnologyTemplate,
  FASHION: FashionTemplate,
  BEAUTY: BeautyTemplate,
  GLAMOUR: GlamourTemplate,
};

export default function PublicCatalogPage({ publicId, initialCatalog: catalog, themeStyle, initialCategory = "" }: { publicId: string; initialCatalog: PublicCatalog; themeStyle?: CatalogThemeStyle; initialCategory?: string }) {
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [cartReady, setCartReady] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState(() => validPublicCategory(catalog.categories, initialCategory));
  const [searchQuery, setSearchQuery] = useState("");
  const [sortOrder, setSortOrder] = useState<ProductSortOrder>("store");
  const deferredSearchQuery = useDeferredValue(searchQuery.trim().toLocaleLowerCase("es"));
  const [page, setPage] = useState(1);
  const cartStorageKey = `catalogo-cart-${publicId}`;

  useEffect(() => {
    const restore = () => {
      const values = new URLSearchParams(window.location.search).getAll("category");
      setSelectedCategory(validPublicCategory(catalog.categories, values.length === 1 ? values[0] : null));
      setPage(1);
    };
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, [catalog.categories]);

  function selectCategory(categoryId: string) {
    const category = validPublicCategory(catalog.categories, categoryId);
    setSelectedCategory(category); setPage(1);
    const url = new URL(window.location.href);
    if (category) url.searchParams.set("category", category); else url.searchParams.delete("category");
    url.hash = "productos";
    window.history.pushState(null, "", url);
    document.getElementById("productos")?.scrollIntoView({ behavior: "auto" });
  }

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
    rememberPublicCatalogTemplate(publicId, catalog.template);
  }, [publicId, catalog.template]);

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
  const pageSize = 20;
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
    onSelectCategory: selectCategory,
    onAdd: (product: PublicProduct) => changeQuantity(product, 1),
  };
  const templateId = normalizeCatalogTemplate(catalog.template);
  const Template = templateComponents[templateId] ?? EditorialTemplate;

  return (
    <main style={themeStyle} data-catalog-themed={themeStyle ? "true" : undefined} className={`${themeStyles.root} min-h-screen pb-12 bg-[var(--catalog-background)] text-[var(--catalog-text)]`}>
      <PublicCatalogCartLink publicId={publicId} template={templateId} cartCount={cartCount} cartTotal={cartTotal} />
      <Template {...templateProps} />
      <footer className="border-t border-[var(--catalog-border-subtle,#dce4dc)] px-5 py-5 text-center text-xs text-[var(--catalog-text-muted,#849087)]">Catálogo compartido por su vendedor</footer>
      <FloatingWhatsAppButton catalog={catalog} />
    </main>
  );
}
