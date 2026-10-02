import { Prisma } from "@prisma/client";

import {
  createProduct,
  findProductsByCatalog,
  findProductById,
  updateProduct,
  deleteProduct,
  findCatalogOwner,
  findCategoryInCatalog,
} from "../repositories/product.repository";
import { validateProductPromotion } from "./product-pricing";

type PromotionInput = {
  salePrice?: number | null;
  saleStartsAt?: string | null;
  saleEndsAt?: string | null;
};

function dateOrNull(value: string | null | undefined) {
  return value ? new Date(value) : null;
}

export async function createProductService(data: {
  catalogId: string;
  categoryId?: string;
  name: string;
  slug: string;
  description?: string;
  brand?: string;
  model?: string;
  sku?: string;
  price: number;
  salePrice?: number | null;
  saleStartsAt?: string | null;
  saleEndsAt?: string | null;
  stock?: number;
  specs?: Prisma.InputJsonValue;
  userId: string;
}) {
  const promotion = {
    price: data.price,
    salePrice: data.salePrice ?? null,
    saleStartsAt: dateOrNull(data.saleStartsAt),
    saleEndsAt: dateOrNull(data.saleEndsAt),
  };
  validateProductPromotion(promotion);

  const catalog = await findCatalogOwner(
    data.catalogId,
    data.userId
  );

  if (!catalog) {
    throw new Error("CATALOG_NOT_FOUND");
  }

  if (data.categoryId) {
    const category = await findCategoryInCatalog(
      data.categoryId,
      data.catalogId
    );

    if (!category) {
      throw new Error("CATEGORY_NOT_IN_CATALOG");
    }
  }

  return createProduct({
    catalogId: data.catalogId,
    categoryId: data.categoryId,
    name: data.name,
    slug: data.slug,
    description: data.description,
    brand: data.brand,
    model: data.model,
    sku: data.sku,
    ...promotion,
    stock: data.stock,
    specs: data.specs,
  });
}

export async function getProductsService(
  catalogId: string,
  userId: string
) {
  return findProductsByCatalog(catalogId, userId);
}

export async function getProductService(
  id: string,
  userId: string
) {
  return findProductById(id, userId);
}

export async function updateProductService(
  id: string,
  userId: string,
  data: {
    categoryId?: string;
    name?: string;
    slug?: string;
    description?: string;
    brand?: string;
    model?: string;
    sku?: string;
    price?: number;
    salePrice?: number | null;
    saleStartsAt?: string | null;
    saleEndsAt?: string | null;
    stock?: number;
    active?: boolean;
    specs?: Prisma.InputJsonValue;
  }
) {
  const product = await findProductById(id, userId);

  if (!product) {
    throw new Error("PRODUCT_NOT_FOUND");
  }

  const promotion: PromotionInput = {
    salePrice: data.salePrice === undefined ? product.salePrice : data.salePrice,
    saleStartsAt: data.saleStartsAt === undefined ? product.saleStartsAt?.toISOString() ?? null : data.saleStartsAt,
    saleEndsAt: data.saleEndsAt === undefined ? product.saleEndsAt?.toISOString() ?? null : data.saleEndsAt,
  };
  validateProductPromotion({
    price: data.price ?? product.price,
    salePrice: promotion.salePrice ?? null,
    saleStartsAt: dateOrNull(promotion.saleStartsAt),
    saleEndsAt: dateOrNull(promotion.saleEndsAt),
  });

  if (data.categoryId) {
    const category = await findCategoryInCatalog(
      data.categoryId,
      product.catalogId
    );

    if (!category) {
      throw new Error("CATEGORY_NOT_IN_CATALOG");
    }
  }

  return updateProduct(id, userId, {
    ...data,
    saleStartsAt: data.saleStartsAt === undefined ? undefined : dateOrNull(data.saleStartsAt),
    saleEndsAt: data.saleEndsAt === undefined ? undefined : dateOrNull(data.saleEndsAt),
  });
}

export async function deleteProductService(
  id: string,
  userId: string
) {
  return deleteProduct(id, userId);
}