export type ProductListQuery = {
  q: string;
  category: string;
  status: "all" | "active" | "inactive";
  stock: "all" | "in" | "out";
  sort: "createdAt" | "name" | "price" | "stock" | "category";
  order: "asc" | "desc";
  page: number;
  pageSize: number;
};
export const defaultProductQuery: ProductListQuery = { q: "", category: "all", status: "all", stock: "all", sort: "createdAt", order: "desc", page: 1, pageSize: 24 };
export const productQueryKeys = Object.keys(defaultProductQuery) as (keyof ProductListQuery)[];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseProductQuery(search: string): ProductListQuery {
  const params = new URLSearchParams(search);
  const category = params.get("category") ?? "all";
  const status = params.get("status");
  const stock = params.get("stock");
  const sort = params.get("sort");
  const page = params.get("page") ?? "1";
  const pageSize = Number(params.get("pageSize") ?? 24);
  return {
    q: (params.get("q") ?? "").trim().slice(0, 150),
    category: category === "none" || uuid.test(category) ? category : "all",
    status: status === "active" || status === "inactive" ? status : "all",
    stock: stock === "in" || stock === "out" ? stock : "all",
    sort: sort === "name" || sort === "price" || sort === "stock" || sort === "category" ? sort : "createdAt",
    order: params.get("order") === "asc" ? "asc" : "desc",
    page: /^[1-9]\d*$/.test(page) && Number(page) <= 1_000_000 ? Number(page) : 1,
    pageSize: [24, 48, 96].includes(pageSize) ? pageSize : 24,
  };
}

export function productQueryString(query: ProductListQuery): string {
  const params = new URLSearchParams();
  for (const key of productQueryKeys) if (query[key] !== defaultProductQuery[key]) params.set(key, String(query[key]));
  return params.toString();
}

export function productFiltersActive(query: ProductListQuery) {
  return Boolean(query.q || query.category !== "all" || query.status !== "all" || query.stock !== "all");
}
