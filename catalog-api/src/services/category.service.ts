import {
  createCategory,
  findCategoriesByCatalog,
  findCategoryById,
  updateCategory,
  deleteCategory,
  catalogBelongsToUser,
} from "../repositories/category.repository";
import { randomUUID } from "node:crypto";
import { uploadProductImage, createProductImageSignedUrl, deleteProductImageFile } from "./storage.service";

export async function createCategoryService(data: {
  catalogId: string;
  name: string;
  slug: string;
  position?: number;
  userId: string;
}) {
  const catalog = await catalogBelongsToUser(data.catalogId, data.userId);
  if (!catalog) throw new Error("CATALOG_NOT_FOUND");
  return createCategory({
    catalogId: data.catalogId,
    name: data.name,
    slug: data.slug,
    position: data.position,
  });
}

export async function getCategoriesService(
  catalogId: string,
  userId: string
) {
  return findCategoriesByCatalog(catalogId, userId);
}

export async function getCategoryService(
  id: string,
  userId: string
) {
  return findCategoryById(id, userId);
}

export async function updateCategoryService(
  id: string,
  userId: string,
  data: {
    name?: string;
    slug?: string;
    position?: number;
    active?: boolean;
  }
) {
  return updateCategory(id, userId, data);
}

export async function deleteCategoryService(
  id: string,
  userId: string
) {
  return deleteCategory(id, userId);
}

export async function uploadCategoryImageService(
  categoryId: string,
  userId: string,
  file: { buffer: Buffer; mimetype: string }
) {
  const category = await findCategoryById(categoryId, userId);
  if (!category) throw new Error("CATEGORY_NOT_FOUND");

  const extension = file.mimetype === "image/jpeg" ? "jpg" : file.mimetype.split("/")[1];
  const imagePath = `${category.catalogId}/categories/${categoryId}/${randomUUID()}.${extension}`;
  const uploadedFile = await uploadProductImage(file.buffer, imagePath, file.mimetype);
  const result = await updateCategory(categoryId, userId, { imageUrl: uploadedFile.path });
  if (result.count === 0) {
    await deleteProductImageFile(uploadedFile.path);
    throw new Error("CATEGORY_NOT_FOUND");
  }
  if (category.imageUrl) await deleteProductImageFile(category.imageUrl);
  return createProductImageSignedUrl(uploadedFile.path);
}

export async function deleteCategoryImageService(categoryId: string, userId: string) {
  const category = await findCategoryById(categoryId, userId);
  if (!category) throw new Error("CATEGORY_NOT_FOUND");
  if (!category.imageUrl) return;

  const result = await updateCategory(categoryId, userId, { imageUrl: null });
  if (result.count === 0) throw new Error("CATEGORY_NOT_FOUND");
  await deleteProductImageFile(category.imageUrl);
}

export async function signCategoryImage<T extends { imageUrl: string | null }>(category: T) {
  return {
    ...category,
    imageUrl: category.imageUrl ? await createProductImageSignedUrl(category.imageUrl) : null,
  };
}

