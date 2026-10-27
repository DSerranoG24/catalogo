import { Router } from "express";
import { makeBannerRouter } from "./catalog-banner.routes";
import { makeBannerService } from "../services/catalog-banner.service";
import type { AuthenticatedRequest } from "../types/auth.types";
import { z } from "zod";
import { authenticate } from "../middlewares/auth.middleware";
import { upload, validateImageContent } from "../middlewares/upload.middleware";
import {
  createCatalogController,
  getCatalogsController,
  getCatalogController,
  updateCatalogController,
  archiveCatalogController,
  deleteCatalogController,
  uploadCatalogLogoController,
  deleteCatalogLogoController,
  reactivateCatalogController,
  getCatalogOrderCountController,
} from "../controllers/catalog.controller";

const router = Router();

router.use(authenticate);
const banners = makeBannerService();
router.use("/:id/banners", makeBannerRouter(banners));
router.get("/:id/featured", async (req: AuthenticatedRequest, res) => {
  if (!req.user) return res.status(401).json({ success: false, message: "Inicia sesión." });
  const id = z.string().uuid().safeParse(req.params.id);
  if (!id.success) return res.status(400).json({ success: false, message: "Identificador inválido." });
  try { return res.json({ success: true, ...await banners.featured(id.data, req.user.id) }); }
  catch (error) {
    return res.status(error instanceof Error && error.message === "CATALOG_NOT_FOUND" ? 404 : 500).json({ success: false, message: "No se pudieron cargar los destacados." });
  }
});

router.post("/", createCatalogController);
router.get("/", getCatalogsController);
router.get("/:id", getCatalogController);
router.post("/:id/logo", upload.single("image"), validateImageContent, uploadCatalogLogoController);
router.delete("/:id/logo", deleteCatalogLogoController);
router.put("/:id", updateCatalogController);
router.post("/:id/archive", archiveCatalogController);
router.post("/:id/reactivate", reactivateCatalogController);
router.get("/:id/order-count", getCatalogOrderCountController);
router.delete("/:id", deleteCatalogController);

export default router;
