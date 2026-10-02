import { Response } from "express";
import { AuthenticatedRequest } from "../types/auth.types";
import {
  createCatalogSchema,
  updateCatalogSchema,
} from "../schemas/catalog.schema";
import {
  createCatalogService,
  getCatalogsService,
  getCatalogService,
  updateCatalogService,
  deleteCatalogService,
} from "../services/catalog.service";

export async function createCatalogController(
  req: AuthenticatedRequest,
  res: Response
) {
  try {
    const data = createCatalogSchema.parse(req.body);

    const catalog = await createCatalogService({
      ...data,
      userId: req.user!.id,
    });

    return res.status(201).json({
      success: true,
      catalog,
    });
  } catch (error) {
    console.error(error);

    return res.status(400).json({
      success: false,
      message: "No se pudo crear el catálogo",
    });
  }
}

export async function getCatalogsController(
  req: AuthenticatedRequest,
  res: Response
) {
  try {
    const catalogs = await getCatalogsService(req.user!.id);

    return res.json({
      success: true,
      catalogs,
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      success: false,
      message: "No se pudieron obtener los catálogos",
    });
  }
}

export async function getCatalogController(
  req: AuthenticatedRequest,
  res: Response
) {
  try {
    const catalog = await getCatalogService(
      req.params.id as string,
      req.user!.id
    );

    if (!catalog) {
      return res.status(404).json({
        success: false,
        message: "Catálogo no encontrado",
      });
    }

    return res.json({
      success: true,
      catalog,
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      success: false,
      message: "No se pudo obtener el catálogo",
    });
  }
}

export async function updateCatalogController(
  req: AuthenticatedRequest,
  res: Response
) {
  try {
    const data = updateCatalogSchema.parse(req.body);

    const result = await updateCatalogService(
      req.params.id as string,
      req.user!.id,
      data
    );

    if (result.count === 0) {
      return res.status(404).json({
        success: false,
        message: "Catálogo no encontrado",
      });
    }

    return res.json({
      success: true,
      message: "Catálogo actualizado",
    });
  } catch (error) {
    console.error(error);

    return res.status(400).json({
      success: false,
      message: "No se pudo actualizar el catálogo",
    });
  }
}

export async function deleteCatalogController(
  req: AuthenticatedRequest,
  res: Response
) {
  try {
    const result = await deleteCatalogService(
      req.params.id as string,
      req.user!.id
    );

    if (result.count === 0) {
      return res.status(404).json({
        success: false,
        message: "Catálogo no encontrado",
      });
    }

    return res.json({
      success: true,
      message: "Catálogo eliminado",
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      success: false,
      message: "No se pudo eliminar el catálogo",
    });
  }
}