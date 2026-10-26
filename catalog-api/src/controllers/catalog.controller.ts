import { Response } from "express";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { CatalogThemeError } from "../schemas/catalog-theme";
import { signCatalogLogo, uploadCatalogLogoService, deleteCatalogLogoService } from "../services/catalog.service";
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
  archiveCatalogService,
  reactivateCatalogService,
  getCatalogOrderCountService,
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
    if (error instanceof CatalogThemeError) return res.status(400).json({ success: false, message: error.message });
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
      catalogs: await Promise.all(catalogs.map(signCatalogLogo)),
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
      catalog: await signCatalogLogo(catalog),
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      success: false,
      message: "No se pudo obtener el catálogo",
    });
  }
}

export async function uploadCatalogLogoController(req: AuthenticatedRequest, res: Response) {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: "Selecciona una imagen para el logo." });
    const logoUrl = await uploadCatalogLogoService(req.params.id as string, req.user!.id, { buffer: req.file.buffer, mimetype: req.file.mimetype });
    return res.status(201).json({ success: true, logoUrl });
  } catch (error) {
    if (error instanceof Error && error.message === "CATALOG_NOT_FOUND") return res.status(404).json({ success: false, message: "Catálogo no encontrado" });
    console.error(error);
    return res.status(500).json({ success: false, message: "No se pudo subir el logo." });
  }
}

export async function deleteCatalogLogoController(req: AuthenticatedRequest, res: Response) {
  try {
    await deleteCatalogLogoService(req.params.id as string, req.user!.id);
    return res.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message === "CATALOG_NOT_FOUND") return res.status(404).json({ success: false, message: "Catálogo no encontrado" });
    console.error(error);
    return res.status(500).json({ success: false, message: "No se pudo eliminar el logo." });
  }
}

export function makeUpdateCatalogController(update = updateCatalogService) {
return async function updateCatalogController(
  req: AuthenticatedRequest,
  res: Response
) {
  try {
    const data = updateCatalogSchema.parse(req.body);

    const result = await update(
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
    if (error instanceof ZodError) {
      return res.status(400).json({
        success: false,
        message: "Revisa los datos del catálogo.",
        issues: error.issues.map(({ path, message }) => ({ field: path.join("."), message })),
      });
    }
    if (error instanceof CatalogThemeError) return res.status(400).json({ success: false, message: error.message });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return res.status(409).json({ success: false, message: "Ya existe un catálogo con ese nombre o dirección." });
    }
    console.error("No se pudo actualizar el catálogo:", error);

    return res.status(500).json({
      success: false,
      message: "No se pudo actualizar el catálogo. Inténtalo de nuevo.",
    });
  }
}
}

export const updateCatalogController = makeUpdateCatalogController();

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
      return res.status(404).json({ success: false, message: "Catálogo no encontrado" });
    }
    return res.json({ success: true, message: "Catálogo eliminado" });
  } catch (error) {
    if (error instanceof Error && error.message === "CATALOG_HAS_ORDERS") {
      return res.status(409).json({
        success: false,
        message: "Este catálogo tiene pedidos registrados. Archívalo para ocultarlo sin perder el historial.",
      });
    }
    if (error instanceof Error && error.message === "CATALOG_NOT_FOUND") {
      return res.status(404).json({ success: false, message: "Catálogo no encontrado" });
    }
    console.error(error);
    return res.status(500).json({ success: false, message: "No se pudo eliminar el catálogo" });
  }
}

export async function archiveCatalogController(
  req: AuthenticatedRequest,
  res: Response
) {
  try {
    const result = await archiveCatalogService(
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
      message: "Catálogo archivado",
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      success: false,
      message: "No se pudo archivar el catálogo",
    });
  }
}

export async function reactivateCatalogController(
  req: AuthenticatedRequest,
  res: Response
) {
  try {
    const result = await reactivateCatalogService(
      req.params.id as string,
      req.user!.id
    );
    if (result.count === 0) {
      return res.status(404).json({ success: false, message: "Catálogo no encontrado" });
    }
    return res.json({ success: true, message: "Catálogo reactivado" });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: "No se pudo reactivar el catálogo" });
  }
}

export async function getCatalogOrderCountController(
  req: AuthenticatedRequest,
  res: Response
) {
  try {
    const orders = await getCatalogOrderCountService(
      req.params.id as string,
      req.user!.id
    );
    return res.json({ success: true, orders });
  } catch (error) {
    if (error instanceof Error && error.message === "CATALOG_NOT_FOUND") {
      return res.status(404).json({ success: false, message: "Catálogo no encontrado" });
    }
    console.error(error);
    return res.status(500).json({ success: false, message: "No se pudo contar los pedidos" });
  }
}
