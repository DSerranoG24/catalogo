import { Response } from "express";
import { AuthenticatedRequest } from "../types/auth.types";
import {
  uploadProductImageService,
  getProductImagesService,
  getProductImageService,
  deleteProductImageService,
} from "../services/product-image.service";

export async function uploadProductImageController(
  req: AuthenticatedRequest,
  res: Response
) {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No se recibió ninguna imagen",
      });
    }

    const image = await uploadProductImageService(
      req.params.id as string,
      req.user!.id,
      {
        buffer: req.file.buffer,
        mimetype: req.file.mimetype,
      },
      req.body.position
        ? Number(req.body.position)
        : 0,
      req.body.alt
    );

    return res.status(201).json({
      success: true,
      image,
    });
  } catch (error) {
    console.error(error);

    if (
      error instanceof Error &&
      error.message === "PRODUCT_NOT_FOUND"
    ) {
      return res.status(404).json({
        success: false,
        message: "Producto no encontrado",
      });
    }

    return res.status(500).json({
      success: false,
      message: "No se pudo subir la imagen",
    });
  }
}

export async function getProductImagesController(
  req: AuthenticatedRequest,
  res: Response
) {
  try {
    const images = await getProductImagesService(
      req.params.id as string,
      req.user!.id
    );

    return res.json({
      success: true,
      images,
    });
  } catch (error) {
    console.error(error);

    if (
      error instanceof Error &&
      error.message === "PRODUCT_NOT_FOUND"
    ) {
      return res.status(404).json({
        success: false,
        message: "Producto no encontrado",
      });
    }

    return res.status(500).json({
      success: false,
      message: "No se pudieron obtener las imágenes",
    });
  }
}

export async function getProductImageController(
  req: AuthenticatedRequest,
  res: Response
) {
  try {
    const image = await getProductImageService(
      req.params.imageId as string,
      req.user!.id
    );

    if (!image) {
      return res.status(404).json({
        success: false,
        message: "Imagen no encontrada",
      });
    }

    return res.json({
      success: true,
      image,
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      success: false,
      message: "No se pudo obtener la imagen",
    });
  }
}

export async function deleteProductImageController(
  req: AuthenticatedRequest,
  res: Response
) {
  try {
    const result = await deleteProductImageService(
      req.params.imageId as string,
      req.user!.id
    );

    if (result.count === 0) {
      return res.status(404).json({
        success: false,
        message: "Imagen no encontrada",
      });
    }

    return res.json({
      success: true,
      message: "Imagen eliminada",
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      success: false,
      message: "No se pudo eliminar la imagen",
    });
  }
}