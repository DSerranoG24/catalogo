import { Router } from "express";
import { authenticate } from "../middlewares/auth.middleware";
import { upload } from "../middlewares/upload.middleware";
import {
  createCategoryController,
  getCategoriesController,
  getCategoryController,
  updateCategoryController,
  deleteCategoryController,
  uploadCategoryImageController,
  deleteCategoryImageController,
} from "../controllers/category.controller";

const router = Router();

router.use(authenticate);

router.post("/catalog/:catalogId", createCategoryController);
router.get("/catalog/:catalogId", getCategoriesController);
router.post("/:id/image", upload.single("image"), uploadCategoryImageController);
router.delete("/:id/image", deleteCategoryImageController);

router.get("/:id", getCategoryController);
router.put("/:id", updateCategoryController);
router.delete("/:id", deleteCategoryController);

export default router;