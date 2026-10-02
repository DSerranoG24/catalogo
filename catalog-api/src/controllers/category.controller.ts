import { Response } from "express";
import { AuthenticatedRequest } from "../types/auth.types";
import {
  createCategorySchema,
  updateCategorySchema,
} from "../schemas/category.schema";
import {
  createCategoryService,
  getCategoriesService,
  getCategoryService,
  updateCategoryService,
  deleteCategoryService,
  uploadCategoryImageService,
  deleteCategoryImageService,
  signCategoryImage,
} from "../services/category.service";

export async function createCategoryController(
  req: AuthenticatedRequest,
  res: Response
) {
  try {
    const data = createCategorySchema.parse(req.body);

    const category = await createCategoryService({
      ...data,
      catalogId: req.params.catalogId as string,
      userId: req.user!.id,
    });

    return res.status(201).json({
      success: true,
      category,
    });
  } catch (error) {
    console.error(error);

    if (error instanceof Error && error.message === "CATALOG_NOT_FOUND") {
      return res.status(404).json({
        success: false,
        message: "Catálogo no encontrado",
      });
    }

    return res.status(400).json({
      success: false,
      message: "No se pudo crear la categoría",
    });
  }
}

export async function getCategoriesController(
  req: AuthenticatedRequest,
  res: Response
) {
  try {
    const categories = await getCategoriesService(
      req.params.catalogId as string,
      req.user!.id
    );

    return res.json({
      success: true,
      categories: await Promise.all(categories.map(signCategoryImage)),
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      success: false,
      message: "No se pudieron obtener las categorías",
    });
  }
}

export async function getCategoryController(
  req: AuthenticatedRequest,
  res: Response
) {
  try {
    const category = await getCategoryService(
      req.params.id as string,
      req.user!.id
    );

    if (!category) {
      return res.status(404).json({
        success: false,
        message: "Categoría no encontrada",
      });
    }

    return res.json({
      success: true,
      category: await signCategoryImage(category),
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      success: false,
      message: "No se pudo obtener la categoría",
    });
  }
}

export async function uploadCategoryImageController(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: "No se recibió ninguna imagen" });
    const imageUrl = await uploadCategoryImageService(req.params.id as string, req.user!.id, {
      buffer: req.file.buffer,
      mimetype: req.file.mimetype,
    });
    return res.status(201).json({ success: true, imageUrl });
  } catch (error) {
    if (error instanceof Error && error.message === "CATEGORY_NOT_FOUND") {
      return res.status(404).json({ success: false, message: "Categoría no encontrada" });
    }
    return res.status(500).json({ success: false, message: "No se pudo subir la imagen de categoría" });
  }
}

export async function deleteCategoryImageController(req: AuthenticatedRequest, res: Response) {
  try {
    await deleteCategoryImageService(req.params.id as string, req.user!.id);
    return res.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message === "CATEGORY_NOT_FOUND") {
      return res.status(404).json({ success: false, message: "Categoría no encontrada" });
    }
    return res.status(500).json({ success: false, message: "No se pudo eliminar la imagen de categoría" });
  }
}

export async function updateCategoryController(
  req: AuthenticatedRequest,
  res: Response
) {
  try {
    const data = updateCategorySchema.parse(req.body);

    const result = await updateCategoryService(
      req.params.id as string,
      req.user!.id,
      data
    );

    if (result.count === 0) {
      return res.status(404).json({
        success: false,
        message: "Categoría no encontrada",
      });
    }

    return res.json({
      success: true,
      message: "Categoría actualizada",
    });
  } catch (error) {
    console.error(error);

    return res.status(400).json({
      success: false,
      message: "No se pudo actualizar la categoría",
    });
  }
}

export async function deleteCategoryController(
  req: AuthenticatedRequest,
  res: Response
) {
  try {
    const result = await deleteCategoryService(
      req.params.id as string,
      req.user!.id
    );

    if (result.count === 0) {
      return res.status(404).json({
        success: false,
        message: "Categoría no encontrada",
      });
    }

    return res.json({
      success: true,
      message: "Categoría eliminada",
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      success: false,
      message: "No se pudo eliminar la categoría",
    });
  }
}
