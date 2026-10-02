import { PublicCatalog, PublicProduct } from "@/lib/api";
import { ProductSortOrder } from "@/components/public/PublicProductToolbar";

export type PublicCatalogTemplateProps = {
  catalog: PublicCatalog;
  products: PublicProduct[];
  totalProducts: number;
  searchQuery: string;
  sortOrder: ProductSortOrder;
  onSearchChange: (value: string) => void;
  onSortChange: (value: ProductSortOrder) => void;
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  quantities: Record<string, number>;
  categories: PublicCatalog["categories"];
  selectedCategory: string;
  onSelectCategory: (categoryId: string) => void;
  onAdd: (product: PublicProduct) => void;
  cartCount: number;
  cartTotal: number;
};