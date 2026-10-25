import { z } from "zod";

const integerQuery = (max: number) => z.string().regex(/^[1-9]\d*$/).transform(Number).pipe(z.number().int().max(max));
export const productCatalogParams = z.object({ catalogId: z.string().uuid() });
export const productListQuery = z.object({
  q: z.string().trim().max(150).default(""),
  category: z.union([z.literal("all"), z.literal("none"), z.string().uuid()]).default("all"),
  status: z.enum(["all", "active", "inactive"]).default("all"),
  stock: z.enum(["all", "in", "out"]).default("all"),
  sort: z.enum(["createdAt", "name", "price", "stock", "category"]).default("createdAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
  page: integerQuery(1_000_000).default(1),
  pageSize: z.enum(["24", "48", "96"]).transform(Number).default(24),
}).strict();
export const productSuggestionQuery = z.object({ q: z.string().trim().min(2).max(150) }).strict();
export type ProductListQuery = z.infer<typeof productListQuery>;
