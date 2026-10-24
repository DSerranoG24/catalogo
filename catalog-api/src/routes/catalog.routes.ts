import { Router } from "express";
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

router.post("/", createCatalogController);
router.get("/", getCatalogsController);
router.get("/:id", getCatalogController);
router.post("/:id/logo", upload.single("image"), validateImageContent, uploadCatalogLogoController);
router.delete("/:id/logo", deleteCatalogLogoController);
router.put("/:id", updateCatalogController);
router.post("/:id/archive", archiveCatalogController);
router.post("/:id/archive", archiveCatalogController);
router.post("/:id/reactivate", reactivateCatalogController);
router.get("/:id/order-count", getCatalogOrderCountController);
router.delete("/:id", deleteCatalogController);

export default router;
