import { Router } from "express";
import { authenticate } from "../middlewares/auth.middleware";
import { upload } from "../middlewares/upload.middleware";

import {
  uploadProductImageController,
  getProductImagesController,
  getProductImageController,
  deleteProductImageController,
} from "../controllers/product-image.controller";

const router = Router();

router.use(authenticate);

router.post(
  "/product/:id",
  upload.single("image"),
  uploadProductImageController
);

router.get(
  "/product/:id",
  getProductImagesController
);

router.get(
  "/:imageId",
  getProductImageController
);

router.delete(
  "/:imageId",
  deleteProductImageController
);

export default router;