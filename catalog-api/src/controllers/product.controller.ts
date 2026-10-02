import { Response } from "express";
import { AuthenticatedRequest } from "../types/auth.types";
import {
  createProductSchema,
  updateProductSchema,
} from "../schemas/product.schema";
import {
  createProductService,
  getProductsService,
  getProductService,
  updateProductService,
  deleteProductService,
} from "../services/product.service";

export async function createProductController(
  req: AuthenticatedRequest,
  res: Response
) {
  try {
    const data = createProductSchema.parse(req.body);

    const product = await createProductService({
      ...data,
      catalogId: req.params.catalogId as string,
      userId: req.user!.id,
    });

    return res.status(201).json({
      success: true,
      product,
    });
  } catch (error) {
    console.error(error);

    if (error instanceof Error) {
      if (error.message === "CATALOG_NOT_FOUND") {
        return res.status(404).json({
          success: false,
          message: "Catálogo no encontrado",
        });
      }

      if (error.message === "CATEGORY_NOT_IN_CATALOG") {
        return res.status(400).json({
          success: false,
          message: "La categoría no pertenece a este catálogo",
        });
      }

      if (error.message === "INVALID_PRODUCT_PROMOTION") {
        return res.status(400).json({
          success: false,
          message: "El descuento debe ser menor al precio normal y tener fechas de inicio y fin válidas.",
        });
      }
    }

    return res.status(400).json({
      success: false,
      message: "No se pudo crear el producto",
    });
  }
}

export async function getProductsController(
  req: AuthenticatedRequest,
  res: Response
) {
  try {
    const products = await getProductsService(
      req.params.catalogId as string,
      req.user!.id
    );

    return res.json({
      success: true,
      products,
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      success: false,
      message: "No se pudieron obtener los productos",
    });
  }
}

export async function getProductController(
  req: AuthenticatedRequest,
  res: Response
) {
  try {
    const product = await getProductService(
      req.params.id as string,
      req.user!.id
    );

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Producto no encontrado",
      });
    }

    return res.json({
      success: true,
      product,
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      success: false,
      message: "No se pudo obtener el producto",
    });
  }
}

export async function updateProductController(
  req: AuthenticatedRequest,
  res: Response
) {
  try {
    const data = updateProductSchema.parse(req.body);

    const result = await updateProductService(
      req.params.id as string,
      req.user!.id,
      data
    );

    return res.json({
      success: true,
      message: "Producto actualizado",
      result,
    });
  } catch (error) {
    console.error(error);

    if (error instanceof Error) {
      if (error.message === "PRODUCT_NOT_FOUND") {
        return res.status(404).json({
          success: false,
          message: "Producto no encontrado",
        });
      }

      if (error.message === "CATEGORY_NOT_IN_CATALOG") {
        return res.status(400).json({
          success: false,
          message: "La categoría no pertenece a este catálogo",
        });
      }

      if (error.message === "INVALID_PRODUCT_PROMOTION") {
        return res.status(400).json({
          success: false,
          message: "El descuento debe ser menor al precio normal y tener fechas de inicio y fin válidas.",
        });
      }
    }

    return res.status(400).json({
      success: false,
      message: "No se pudo actualizar el producto",
    });
  }
}

export async function deleteProductController(
  req: AuthenticatedRequest,
  res: Response
) {
  try {
    const result = await deleteProductService(
      req.params.id as string,
      req.user!.id
    );

    if (result.count === 0) {
      return res.status(404).json({
        success: false,
        message: "Producto no encontrado",
      });
    }

    return res.json({
      success: true,
      message: "Producto eliminado",
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      success: false,
      message: "No se pudo eliminar el producto",
    });
  }
}