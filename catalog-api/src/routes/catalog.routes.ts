import { Router } from "express";
import { authenticate } from "../middlewares/auth.middleware";
import {
  createCatalogController,
  getCatalogsController,
  getCatalogController,
  updateCatalogController,
  deleteCatalogController,
} from "../controllers/catalog.controller";

const router = Router();

router.use(authenticate);

router.post("/", createCatalogController);
router.get("/", getCatalogsController);
router.get("/:id", getCatalogController);
router.put("/:id", updateCatalogController);
router.delete("/:id", deleteCatalogController);

export default router;